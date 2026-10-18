import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { _electron } from "playwright";

export async function desktopPreview(opts: { workspace: string; fileId: string; nodeId: string; temp: string; out: string }) {
  const require = createRequire(resolve("apps/desktop/package.json"));
  const env = { ...process.env, OPENCREASE_DESKTOP_TEST: "1", OPENCREASE_DESKTOP_USER_DATA: join(opts.temp, "desktop-data"), OPENCREASE_HOME: join(opts.temp, "desktop-home"), OPENCREASE_WORKSPACE: opts.workspace, OPENCREASE_PORT: "29912" };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.OPENCREASE_EDITOR_URL;
  const app = await _electron.launch({ executablePath: require("electron"), args: [resolve("apps/desktop")], env, cwd: process.cwd() });
  try {
    const editor = await app.firstWindow();
    await editor.locator(".of-titlebar").waitFor();
    await editor.goto(`http://127.0.0.1:29912/file/${opts.fileId}`);
    await editor.getByRole("button", { name: "Preview", exact: true }).waitFor();
    const next = app.waitForEvent("window");
    await editor.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = await next;
    await preview.waitForURL(`**/preview/${opts.fileId}/${opts.nodeId}`);
    await preview.frameLocator("iframe").getByText("Live edits arrive here.").waitFor();
    const call = editor.evaluate(async (fileId) => fetch("/api/tools/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "set_text_content", args: { fileId, id: "5Z-0", text: "Live edits in the desktop window." }, client: { name: "desktop-preview-review" } }) }).then((r) => r.json()), opts.fileId);
    await editor.getByRole("button", { name: "Allow", exact: true }).click();
    const result = await call;
    assert.ok(!result.isError, JSON.stringify(result));
    await preview.frameLocator("iframe").getByText("Live edits in the desktop window.").waitFor();
    const state = await app.evaluate(({ app, BrowserWindow }) => ({ dock: app.dock?.isVisible() ?? false, windows: BrowserWindow.getAllWindows().map((win) => ({ visible: win.isVisible(), focused: win.isFocused(), offscreen: win.webContents.isOffscreen(), url: win.webContents.getURL() })) }));
    assert.equal(state.windows.length, 2);
    assert.equal(state.dock, false);
    assert.ok(state.windows.every((win) => !win.visible && !win.focused && win.offscreen), JSON.stringify(state));
    const png = await (await app.browserWindow(preview)).evaluate(async (win) => (await win.webContents.capturePage()).toPNG().toString("base64"));
    await writeFile(join(opts.out, "desktop-preview.png"), Buffer.from(png, "base64"));
    await writeFile(join(opts.out, "desktop-check.json"), JSON.stringify(state, null, 2));
    console.log("Desktop Preview: two hidden offscreen windows, dock hidden, live text update passed.");
  } finally { await app.close(); }
}
