// Track 10 acceptance: real server, Vite proxy, browser, permission UI, plugins, history and CLI.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { startHeadless } from "../apps/server/src/headless";
import { launchChromium } from "../apps/server/src/render";
const require = createRequire(new URL("../apps/server/package.json", import.meta.url));
const { Client } = await import(require.resolve("@modelcontextprotocol/sdk/client/index.js"));
const { StdioClientTransport } = await import(require.resolve("@modelcontextprotocol/sdk/client/stdio.js"));
const temp = await mkdtemp(join(tmpdir(), "of-track10-"));
const home = join(temp, "home"), workspace = join(temp, "ws");
const output = resolve("test-results/track10");
await mkdir(output, { recursive: true });
const oldHome = process.env.OPENCREASE_HOME;
process.env.OPENCREASE_HOME = home;
const apiUrl = "http://127.0.0.1:29910", editorUrl = "http://localhost:5210";
const children: ChildProcess[] = [];
let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
const logs: string[] = [];
const run = (cmd: string, args: string[], env = process.env) => {
  const child = spawn(cmd, args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (b) => logs.push(String(b))); child.stderr?.on("data", (b) => logs.push(String(b)));
  children.push(child); return child;
};
const wait = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 200; i++) { if (await fn().catch(() => false)) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`Startup timed out: ${logs.slice(-10).join("")}`);
};
const bin = resolve("apps/server/bin/opencrease.mjs");
try {
  // Explicitly no visible opener; same configuration as pnpm dev on the track ports.
  run(process.execPath, [bin, workspace, "--no-open", "--port", "29910"], { ...process.env, OPENCREASE_EDITOR_URL: editorUrl });
  run("pnpm", ["--filter", "@opencrease/editor", "exec", "vite", "--host", "127.0.0.1", "--port", "5210", "--strictPort"], { ...process.env, OPENCREASE_PORT: "29910" });
  await wait(async () => (await fetch(`${apiUrl}/api/status`)).ok && (await fetch(editorUrl)).ok);
  await mkdir(join(home, "plugins"), { recursive: true });
  await writeFile(join(home, "plugins", "sandbox-probe.js"), `// @name Sandbox probe
export default async function(api) {
  const blocked=[];
  try { parent.document.body; } catch { blocked.push('parent DOM'); }
  try { localStorage.getItem('x'); } catch { blocked.push('storage'); }
  try { await fetch('https://evil.example/probe'); } catch { blocked.push('network'); }
  api.notify(blocked.join(', '));
}`);
  const token = (await readFile(join(home, "token"), "utf8")).trim();
  const request = async (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
    const r = await fetch(`${apiUrl}${path}`, { method, headers: { "x-opencrease-token": token, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.ok(r.ok, `${path}: ${r.status} ${await r.clone().text()}`); return r.json() as Promise<any>;
  };
  assert.equal((await fetch(`${apiUrl}/api/files`)).status, 401);
  assert.ok((await fetch(`${editorUrl}/api/files`, { headers: { origin: "http://localhost:5320" } })).status >= 400);
  const file = await request("/api/files", { name: "Track 10 platform" });
  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Search files").waitFor();
  await page.screenshot({ path: join(output, "home.png") });
  // No manual token input or cookie injection: Vite gets its token from OPENCREASE_HOME.
  assert.equal(await page.evaluate(async () => (await fetch("/api/session")).status), 200);
  const axeSource = await readFile(resolve("node_modules/axe-core/axe.min.js"), "utf8");
  const audit = async (name: string) => {
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(async () => (window as any).axe.run({ exclude: ["[data-of-content]", ".of-canvas"] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } }));
    await writeFile(join(output, `axe-${name}.json`), JSON.stringify(result.violations, null, 2));
    console.log(`axe ${name}: ${result.violations.map((v: any) => `${v.id} (${v.nodes.length})`).join(", ") || "no violations"}`);
    assert.equal(result.violations.length, 0, `Accessibility violations in ${name}: inspect axe-${name}.json`);
    return result.violations;
  };
  await audit("home");
  await page.goto(`${editorUrl}/file/${file.id}`, { waitUntil: "networkidle" });
  await wait(async () => (await request("/api/status")).editorConnected);
  const call = async (tool: string, args: Record<string, unknown> = {}) => request("/api/tools/call", { tool, args: { fileId: file.id, ...args }, client: { name: "track10-live" } });
  const pending = call("get_basic_info");
  const allow = page.getByRole("button", { name: "Allow", exact: true });
  await allow.waitFor();
  await page.screenshot({ path: join(output, "permission.png") });
  await allow.click();
  assert.ok(!(await pending).isError);
  const boardResult = await call("create_artboard", { name: "Field notes", styles: { width: 720, height: 500, backgroundColor: "#f4f1e8", padding: 40, display: "flex", gap: 24 } });
  const body = (r: any) => JSON.parse(r.content[1].text);
  const board = body(boardResult).id;
  assert.ok(board, JSON.stringify(boardResult));
  const blocked = await call("write_html", { targetNodeId: board, mode: "insert-children", html: "<div>Hello</div>" });
  assert.equal(blocked.isError, true);
  await call("oc_post_brief", { artboardId: board, mood: "Quiet field notebook", palette: "Cream, ink, burnt orange", type: "Geist 400/600, 16 and 48", direction: "One strong heading over generous space" });
  await call("create_tokens", { tokens: [{ type: "color", name: "--color-ink", value: "#252a24" }, { type: "spacing", name: "--spacing-section", value: "24px" }] });
  const imageResponse = await fetch(`${apiUrl}/api/files/${file.id}/assets`, { method: "POST", headers: { "x-opencrease-token": token, "content-type": "image/png" }, body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
  const asset = await imageResponse.json() as { hash: string };
  await call("write_html", { targetNodeId: board, mode: "insert-children", html: `<img layer-name="Local image" src="asset://${asset.hash}" width="16" height="16">` });
  const written = await call("write_html", { targetNodeId: board, mode: "insert-children", html: '<div layer-name="Heading" style="font-family:Geist Variable;font-size:48px;font-weight:600;color:#252a24">Field notes</div><div layer-name="Description" style="font-family:Geist Variable;font-size:18px;color:var(--color-ink)">A small record of things worth noticing.</div>' });
  assert.ok(!written.isError, JSON.stringify(written));
  assert.match(JSON.stringify(written), /var\(--color-ink\)/);
  const injection = await call("write_html", { targetNodeId: board, mode: "insert-children", html: '<svg layer-name="Safety check" width="1" height="1"><script>window.__opencreaseInjected=true</script><foreignObject><img src="https://evil.example/steal" onerror="window.__opencreaseInjected=true"/></foreignObject><animate attributeName="href" to="javascript:alert(1)"/><path onload="window.__opencreaseInjected=true" d="M0 0"/></svg>' });
  assert.ok(!injection.isError);
  assert.equal(await page.evaluate(() => (window as any).__opencreaseInjected), undefined);
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByRole("region", { name: "Design brief" }).waitFor();
  await page.screenshot({ path: join(output, "agent-brief.png") });
  await page.evaluate(() => window.dispatchEvent(new Event("opencrease:history")));
  await page.getByRole("textbox", { name: "Version name" }).fill("Before heading change");
  await page.getByRole("button", { name: "Save version", exact: true }).click();
  await page.getByRole("button", { name: /Before heading change/ }).waitFor();
  const versions = await request(`/api/files/${file.id}/versions`);
  const savedVersion = versions.versions.at(-1).version;
  await page.getByRole("button", { name: "Close version history" }).click();
  const heading = body(await call("get_children", { nodeId: board })).children.find((n: any) => n.name === "Heading");
  await call("set_text_content", { updates: [{ nodeId: heading.id, textContent: "A field companion" }] });
  const diff = body(await call("oc_get_diff", { sinceVersion: savedVersion }));
  assert.ok(diff.changed.some((n: any) => n.id === heading.id && n.text.to === "A field companion"));
  await page.evaluate(() => window.dispatchEvent(new Event("opencrease:history")));
  await page.getByRole("button", { name: /Before heading change/ }).click();
  await page.getByRole("button", { name: `Restore version ${savedVersion}`, exact: true }).waitFor();
  await page.frameLocator('iframe[title="Current design"]').locator("img").waitFor();
  await wait(() => page.frameLocator('iframe[title="Current design"]').locator("img").evaluate((img) => (img as HTMLImageElement).naturalWidth > 0));
  await page.screenshot({ path: join(output, "history-diff.png") });
  await page.getByRole("button", { name: `Restore version ${savedVersion}`, exact: true }).click();
  await wait(async () => (await request(`/api/files/${file.id}`)).nodes[heading.id].text === "Field notes");
  await page.getByRole("button", { name: "Close version history" }).click();
  // Select via the public state action to exercise a real plugin against the current selection.
  await page.evaluate(async ({ fileId, id }) => { const m = await import("/src/state/workspace.ts"); m.setSelection(fileId, [id]); }, { fileId: file.id, id: heading.id });
  await page.evaluate(() => window.dispatchEvent(new Event("opencrease:plugins")));
  await page.getByRole("region", { name: "Sandbox probe" }).getByRole("button", { name: "Run", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "parent DOM, storage, network" }).waitFor();
  await page.getByRole("button", { name: "Rename selection: Item 1, Item 2, ...", exact: true }).click();
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Renamed 1 layer." }).waitFor();
  await page.screenshot({ path: join(output, "plugins.png") });
  await page.getByRole("button", { name: "Close plugins" }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("opencrease:settings", { detail: { page: "agents" } })));
  await page.getByText("Agent access", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "settings-agents.png") });
  await audit("settings");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await audit("editor");
  // Stdio connects to the token-protected HTTP server automatically.
  const client = new Client({ name: "stdio-live", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin, "mcp", "--port", "29910"], env: { ...process.env, OPENCREASE_HOME: home } as Record<string, string> }));
  const listed = await client.listTools();
  assert.ok(listed.tools.find((t: any) => t.name === "oc_get_diff").annotations.readOnlyHint);
  const stdioPending = client.callTool({ name: "list_resources", arguments: {} });
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  assert.ok(!(await stdioPending).isError);
  await client.close();
  await writeFile(join(output, "browser-errors.json"), JSON.stringify(errors));
  assert.deepEqual(errors, []);
  await browser.close(); browser = undefined;
  // Built editor headless auth and an actual raster export, independent of the Vite token proxy.
  const saved = await request(`/api/files/${file.id}`);
  const entries = await request("/api/files");
  const filePath = entries.find((f: any) => f.id === file.id).path;
  const session = await startHeadless({ file: filePath, exportDir: join(output, "exports") });
  try {
    const r = await session.callTool("export", { fileId: saved.id, nodes: { [board]: [{ format: "png", scale: "1x" }] } });
    assert.ok(!r.isError, JSON.stringify(r)); assert.ok(body(r).exports.length);
  } finally { await session.close(); }
  console.log(`Platform acceptance passed. Screenshots: ${output}`);
} finally {
  await browser?.close().catch(() => {});
  for (const child of children.reverse()) {
    if (child.exitCode === null) { child.kill("SIGTERM"); await new Promise<void>((resolveExit) => { const t = setTimeout(() => { child.kill("SIGKILL"); resolveExit(); }, 3000); child.once("exit", () => { clearTimeout(t); resolveExit(); }); }); }
  }
  await writeFile(join(output, "server.log"), logs.join(""));
  if (oldHome === undefined) delete process.env.OPENCREASE_HOME; else process.env.OPENCREASE_HOME = oldHome;
  await rm(temp, { recursive: true, force: true });
}
