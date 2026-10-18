#!/usr/bin/env node
// Drives the desktop app with Playwright's Electron API and saves screenshots. Everything runs in a
// throwaway HOME, user data folder and workspace, so no real config is read or written.
//   node scripts/smoke.mjs [outDir] [--packaged <path to app binary>]
// Env: OPENCREASE_PORT (default 29908). Needs `pnpm --filter @opencrease/editor build` and `bundle` first.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const packagedAt = argv.indexOf("--packaged");
const packaged = packagedAt >= 0 ? argv[packagedAt + 1] : undefined;
const out = argv.find((a, i) => !a.startsWith("--") && (packagedAt < 0 || i !== packagedAt + 1)) ?? join(tmpdir(), "opencrease-desktop-smoke");
await mkdir(out, { recursive: true });
const sandbox = await mkdtemp(join(tmpdir(), "of-desktop-"));
const home = join(sandbox, "home");
await mkdir(home, { recursive: true });
const port = process.env.OPENCREASE_PORT || "29908";

const env = {
  ...process.env,
  HOME: home,
  OPENCREASE_DESKTOP_TEST: "1",
  CODEX_HOME: join(home, ".codex"),
  CLAUDE_CONFIG_DIR: join(home, ".claude"),
  XDG_CONFIG_HOME: join(home, ".config"),
  APPDATA: join(home, "AppData", "Roaming"),
  OPENCREASE_PORT: port,
  OPENCREASE_WORKSPACE: join(sandbox, "workspace"),
  OPENCREASE_DESKTOP_TEST_FOLDER: join(sandbox, "other-workspace"),
  OPENCREASE_DESKTOP_USER_DATA: join(sandbox, "user-data"),
  OPENCREASE_HOME: join(home, ".opencrease"),
};
delete env.OPENCREASE_EDITOR_URL;
// set when this runs from an Electron-based terminal; it would start the app as plain Node
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch(packaged ? { executablePath: packaged, args: [], env } : { args: [root], env, cwd: root });
const log = (...a) => console.log("[smoke]", ...a);
try {
  const win = await app.firstWindow();
  win.setDefaultTimeout(10_000);
  const errors = [];
  win.on("pageerror", (error) => errors.push(error.message));
  const hidden = async () => {
    const state = await app.evaluate(({ app, BrowserWindow }) => ({
      test: process.env.OPENCREASE_DESKTOP_TEST,
      dock: app.dock?.isVisible() ?? false,
      windows: BrowserWindow.getAllWindows().map((w) => ({
        visible: w.isVisible(), focused: w.isFocused(),
        offscreen: w.webContents.isOffscreen(),
      })),
    }));
    assert.equal(state.test, "1");
    assert.equal(state.dock, false);
    assert.ok(state.windows.every((w) => !w.visible && !w.focused && w.offscreen), JSON.stringify(state));
  };
  const capture = async (name) => {
    await hidden();
    const png = await app.evaluate(async ({ BrowserWindow }, id) => {
      const image = await BrowserWindow.fromId(id).webContents.capturePage();
      return image.toPNG().toString("base64");
    }, await (await app.browserWindow(win)).evaluate((w) => w.id));
    await writeFile(join(out, name), Buffer.from(png, "base64"));
  };
  await win.waitForLoadState("domcontentloaded");
  await win.waitForSelector(".of-titlebar");
  await win.waitForTimeout(800);

  const info = await win.evaluate(() => ({
    desktop: typeof window.opencreaseDesktop,
    keys: window.opencreaseDesktop ? Object.keys(window.opencreaseDesktop) : [],
    platform: document.documentElement.dataset.ofDesktop,
    padding: getComputedStyle(document.querySelector(".of-titlebar")).paddingLeft,
    region: getComputedStyle(document.querySelector(".of-titlebar")).getPropertyValue("-webkit-app-region") || getComputedStyle(document.querySelector(".of-titlebar")).getPropertyValue("app-region"),
    require: typeof window.require,
    process: typeof window.process,
  }));
  assert.equal(info.desktop, "object");
  assert.equal(info.require, "undefined");
  assert.equal(info.process, "undefined");
  assert.equal(info.padding, process.platform === "darwin" ? "80px" : "12px");
  log("bridge", JSON.stringify(info));
  await capture("01-home.png");

  const status = await win.evaluate(() => fetch("/api/status").then((r) => r.json()));
  log("status", JSON.stringify({ port: status.port, workspace: status.workspace }));

  const fonts = await win.evaluate(() => window.opencreaseDesktop.listSystemFonts());
  assert.ok(fonts.length > 0, "system fonts are available");
  log("system fonts", fonts.length, fonts.slice(0, 5).join(", "));

  // Menu: New file runs through the native menu item and the editor command.
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("new-file").click());
  await win.waitForURL(/\/file\//, { timeout: 10_000 });
  await win.waitForTimeout(1200);
  await capture("02-new-file.png");

  // Menu: Frame tool, then zoom in, through the replayed shortcuts.
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("tool-frame").click());
  await win.waitForTimeout(200);
  const tool = await win.evaluate(() => document.querySelector('[aria-pressed="true"][aria-label], .of-tool[data-active]')?.getAttribute("aria-label") ?? null);
  assert.equal(tool, "Frame");
  log("tool after menu", tool);

  // Second window
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("new-window").click());
  await win.waitForTimeout(800);
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  assert.equal(windows, 2);
  await hidden();
  log("windows", windows);

  // Deep link through the second-instance path
  const fileId = new URL(win.url()).pathname.split("/")[2];
  await app.evaluate(({ app }, link) => app.emit("second-instance", {}, ["OpenCrease", link], process.cwd()), `opencrease://file/${fileId}`);
  await app.evaluate(({ app }) => app.emit("second-instance", {}, ["OpenCrease", "opencrease://file/../../etc/passwd"], process.cwd()));
  await win.waitForTimeout(500);
  const urls = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()));
  assert.ok(urls.every((url) => url.includes(`/file/${fileId}`)));
  await hidden();
  log("after deep link", JSON.stringify(urls));
  // keep one editor, so agent tools target the window we drive
  await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const first = Math.min(...all.map((w) => w.id));
    all.filter((w) => w.id !== first).forEach((w) => w.destroy());
  });
  await win.waitForTimeout(500);

  // Connect dialog with "Add automatically" for Cursor; the write goes to the throwaway HOME.
  await win.evaluate(() => window.dispatchEvent(new CustomEvent("opencrease:connect-agent")));
  await win.waitForSelector(".of-agent-row");
  const rows = win.locator(".of-agent-row");
  const cursor = rows.filter({ hasText: "Cursor" });
  await mkdir(join(home, ".cursor"), { recursive: true });
  await writeFile(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { figma: { url: "http://127.0.0.1:3845/mcp" } } }, null, 2) + "\n");
  await cursor.getByRole("button", { name: "Set up" }).click();
  await capture("03-connect-open.png");
  await cursor.getByRole("button", { name: "Add automatically" }).click();
  await win.waitForSelector(".of-diff");
  await win.waitForTimeout(200);
  await capture("04-connect-preview.png");
  const beforeConfig = await readFile(join(home, ".cursor", "mcp.json"), "utf8");
  assert.equal(JSON.parse(beforeConfig).mcpServers.opencrease, undefined, "preview writes nothing");
  await cursor.getByRole("button", { name: "Write change" }).click();
  await win.waitForSelector(".of-auto-connect-ok");
  await capture("05-connect-done.png");
  const config = JSON.parse(await readFile(join(home, ".cursor", "mcp.json"), "utf8"));
  assert.equal(config.mcpServers.figma.url, "http://127.0.0.1:3845/mcp");
  assert.equal(config.mcpServers.opencrease.args.at(-1), port);
  const backups = (await readdir(join(home, ".cursor"))).filter((name) => name.includes(".opencrease-backup-"));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(join(home, ".cursor", backups[0]), "utf8"), beforeConfig);
  log("cursor config written in temporary HOME with unchanged backup");
  await win.keyboard.press("Escape");

  // Font picker lists local fonts: an agent writes a text layer, we select it and open the picker.
  const call = (tool, args) =>
    win.evaluate(([tool, args]) => fetch("/api/tools/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool, args, client: { name: "smoke" } }) }).then((r) => r.json()), [tool, args]);
  const permission = win.getByRole("button", { name: "Allow", exact: true }).waitFor().then(() => win.getByRole("button", { name: "Allow", exact: true }).click());
  const board = await call("create_artboard", { fileId, name: "Card", styles: { width: "480px", height: "320px", backgroundColor: "#FFFFFF", display: "flex", padding: "40px" } });
  await permission;
  const boardId = JSON.parse(board.content.at(-1).text).id ?? JSON.parse(board.content.at(-1).text).artboardId;
  await call("oc_post_brief", { fileId, artboardId: boardId, mood: "Quiet study", palette: "White and charcoal", type: "Helvetica Neue 600 at 40", direction: "A single heading with generous padding" });
  const written = await call("write_html", { fileId, targetNodeId: boardId, mode: "insert-children", html: '<div layer-name="Headline" style="font-size:40px;font-family:Helvetica Neue;font-weight:600">Local fonts</div>' });
  const textId = JSON.parse(written.content.find((c) => c.text?.includes("createdNodes")).text).createdNodes[0].id;
  await win.waitForTimeout(600);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("tool-move").click());
  await win.waitForTimeout(200);
  const expand = win.locator(`[data-layer-id="${boardId}"]`).getByRole("button", { name: "Expand", exact: true });
  if (await expand.count()) await expand.click();
  await win.locator(`[data-layer-id="${textId}"]`).click();
  await win.waitForTimeout(300);
  await capture("06-selected.png");
  const fontField = win.getByRole("button", { name: "Font family" });
  if (await fontField.count()) {
    await fontField.first().click();
    await win.getByText("On this computer", { exact: true }).waitFor();
    await win.locator(".of-popover .of-scroll").evaluate((el) => {
      const label = [...el.querySelectorAll(".of-menu-label")].find((l) => l.textContent === "On this computer");
      if (label) el.scrollTop = label.offsetTop - 40;
    });
    await win.waitForTimeout(300);
    await capture("07-font-picker.png");
    await win.keyboard.press("Escape");
  } else assert.fail("Font family field was not found");
  await hidden();
  assert.deepEqual(errors, []);
  // Workspace picker uses a test folder, never a native dialog. Settings must persist the switch.
  const switched = await win.evaluate(() => window.opencreaseDesktop.openFolder());
  assert.equal(switched, env.OPENCREASE_DESKTOP_TEST_FOLDER);
  await win.waitForURL(`http://127.0.0.1:${port}/`);
  await win.waitForSelector(".of-titlebar");
  const settings = JSON.parse(await readFile(join(env.OPENCREASE_DESKTOP_USER_DATA, "settings.json"), "utf8"));
  assert.equal(settings.workspace, switched);
  assert.equal((await win.evaluate(() => fetch("/api/status").then((r) => r.json()))).workspace, switched);
  await capture("08-workspace.png");
  log("workspace switch persisted", switched);
  log("sandbox", sandbox);
} finally {
  await app.close();
}
