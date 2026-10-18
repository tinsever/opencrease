// Headless REST replay and Preview integration check. No user workspace or visible windows.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DocStore, createDocument, serializeFold } from "../packages/model/src/index";
import { startHeadless } from "../apps/server/src/headless";

const out = resolve("test-results/ergonomics");
const temp = await mkdtemp(join(tmpdir(), "of-ergonomics-"));
const previousHome = process.env.OPENCREASE_HOME;
process.env.OPENCREASE_HOME = join(temp, "home");
await mkdir(out, { recursive: true });
const folder = join(temp, "Preview.fold");
await mkdir(folder);
const store = new DocStore(createDocument("Preview check", { clientId: "0" }));
const page = Object.values(store.doc.pages)[0];
const ids = store.transact("fixture", (tx) => tx.insertTrees(page.rootId, [
  { type: "Frame", name: "Studio", styles: { width: 960, height: 720, position: "absolute", left: 600, top: 400, display: "flex", flexDirection: "column", gap: 24, padding: 64, backgroundColor: "var(--paper)", color: "var(--ink)" }, children: [
    { type: "Text", text: "STUDIO / 01", styles: { fontFamily: "Geist Mono Variable", fontSize: 13, letterSpacing: "0.12em" } },
    { type: "Text", text: "A page of its own.", styles: { fontFamily: "Inter", fontSize: 64, fontWeight: 600, lineHeight: "68px" } },
    { type: "Text", text: "From the canvas to a real browser page.", styles: { fontSize: 22, lineHeight: "30px" } },
    { type: "Frame", styles: { display: "flex", gap: 12 }, children: Array.from({ length: 6 }, (_, i) => ({ type: "Text" as const, text: `0${i + 1}`, styles: { width: 80, padding: 16, backgroundColor: "#e4dcd0", fontFamily: "Geist Mono Variable" } })) },
  ] },
  { type: "Frame", name: "Second", styles: { width: 390, height: 500, position: "absolute", left: 1700, backgroundColor: "#203a43" }, children: [{ type: "Text", text: "Second artboard", styles: { color: "#ffffff", fontSize: 32 } }] },
]));
// Preserve the failed log's original target ids, without reading the user's document.
const fixture = structuredClone(store.doc);
const rename = (oldId: string, newId: string) => {
  const node = fixture.nodes[oldId];
  delete fixture.nodes[oldId]; node.id = newId; fixture.nodes[newId] = node;
  for (const n of Object.values(fixture.nodes)) { n.children = n.children.map((id) => id === oldId ? newId : id); if (n.parentId === oldId) n.parentId = newId; }
};
const artboard = ids[0], second = ids[1];
const description = fixture.nodes[artboard].children[2];
const slots = [...fixture.nodes[fixture.nodes[artboard].children[3]].children];
rename(description, "5Z-0");
slots.forEach((id, i) => rename(id, ["1N-0", "1Q-0", "1T-0", "1W-0", "1Z-0", "22-0"][i]));
const saved = serializeFold(fixture);
await writeFile(join(folder, "document.json"), saved.documentJson);
await writeFile(join(folder, "manifest.json"), JSON.stringify(saved.manifest));
let session: Awaited<ReturnType<typeof startHeadless>> | undefined;
try {
  session = await startHeadless({ file: folder, source: true, port: 29912, vitePort: 5212 });
  const { page: editor, server } = session;
  const errors: string[] = [];
  editor.on("pageerror", (e) => errors.push(e.message));
  const call = async (tool: string, args: Record<string, unknown>) => {
    const response = await fetch(`${server.url}/api/tools/call`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${server.token}` }, body: JSON.stringify({ tool, args, client: { name: "ergonomics-review" } }) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const success = async (tool: string, args: Record<string, unknown>) => { const result = await call(tool, args); assert.ok(!result.isError, JSON.stringify(result)); return result; };
  const logPath = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "/tmp/example-demo/log.jsonl";
  const failed = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line)).filter((row) => row.isError);
  const replay = [];
  for (const row of failed) {
    const args = JSON.parse(row.args);
    // Each logged create probe starts without the token a previously failing probe now creates.
    if (row.tool === "create_tokens" && args.tokens?.[0]?.type === "x") await success("set_tokens", { deletes: ["--probe"] });
    const result = await call(row.tool, args);
    const shouldFail = row.tool === "oc_post_brief" || row.tool === "create_artboard" || row.tool === "create_tokens" && (!args.tokens || args.tokens[0].type === "x");
    assert.equal(!!result.isError, shouldFail, `${row.tool}: ${JSON.stringify(result)}`);
    if (shouldFail) assert.match(result.content[0].text, /Expected shape \(example\):/);
    let retry;
    if (shouldFail) {
      const example = JSON.parse(result.content[0].text.split("Expected shape (example): ")[1]);
      example.fileId = fixture.id;
      if (row.tool === "create_tokens" && args.tokens) example.tokens = args.tokens.map((token: Record<string, unknown>) => ({ ...token, type: "color" }));
      const corrected = await call(row.tool, example);
      assert.ok(!corrected.isError, JSON.stringify(corrected));
      retry = { args: example, outcome: "success" };
    }
    replay.push({ tool: row.tool, args, outcome: result.isError ? "actionable error" : "success", ...(result.isError ? { message: result.content[0].text, retry } : {}) });
  }
  await writeFile(join(out, "replay.json"), JSON.stringify(replay, null, 2));
  console.log(`Replay: ${replay.filter((r) => r.outcome === "success").length}/${failed.length} succeed; remaining calls intentionally invalid with canonical examples.`);
  await success("create_tokens", { tokens: [{ name: "paper", value: "#f5f0e6" }, { name: "ink", value: "#203a43" }] });
  // Local asset, shared by an img and a CSS background.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const asset = await server.workspace.addAsset(fixture.id, png, "image/png", "pixel.png");
  const imageResult = await success("write_html", { parentId: artboard, mode: "insert-children", html: `<img layer-name="Local image" src="asset://${asset.hash}" style="width:64px;height:32px"><div style="width:64px;height:32px;background-image:url(asset://${asset.hash})"></div>` });
  assert.ok(imageResult.content.length);
  await editor.evaluate(async ({ fileId, selection }) => { const workspace = await import("/src/state/workspace.ts"); workspace.setSelection(fileId, selection); }, { fileId: fixture.id, selection: [fixture.nodes[artboard].children[1]] });
  await editor.screenshot({ path: join(out, "editor-preview-button.png") });
  const popup = editor.waitForEvent("popup");
  await editor.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = await popup;
  preview.on("pageerror", (e) => errors.push(e.message));
  await preview.waitForURL(`**/preview/${fixture.id}/${artboard}`);
  const frame = preview.frameLocator('iframe[title="Artboard preview"]');
  await frame.getByText("A page of its own.").waitFor();
  await preview.waitForFunction(() => { const img = document.querySelector("iframe")?.contentDocument?.querySelector("img"); return img?.complete && img.naturalWidth > 0; });
  const previewFrame = preview.frames().find((f) => f.parentFrame());
  assert.ok(previewFrame);
  await previewFrame.waitForFunction(() => [...document.fonts].some((font) => font.family.includes("Inter") && font.status === "loaded"), undefined, { timeout: 30_000 });
  await previewFrame.evaluate(() => document.fonts.ready);
  const fonts = await previewFrame.evaluate(() => ({ geist: document.fonts.check('13px "Geist Mono Variable"'), inter: document.fonts.check('600 64px "Inter"'), loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family), body: getComputedStyle(document.body.firstElementChild!).backgroundColor, rect: document.body.firstElementChild!.getBoundingClientRect().toJSON() }));
  assert.ok(fonts.geist && fonts.inter && fonts.loaded.some((f) => f.includes("Inter")), JSON.stringify(fonts));
  assert.equal(fonts.rect.x, 0); assert.equal(fonts.rect.y, 0);
  const backgrounds = await previewFrame.locator('[style*="background-image"]').evaluateAll((nodes) => nodes.map((n) => ({ inline: n.getAttribute("style"), resolved: getComputedStyle(n).backgroundImage })));
  assert.ok(backgrounds.some((b) => b.resolved.includes("/assets/")), JSON.stringify(backgrounds));
  await preview.screenshot({ path: join(out, "preview-before.png") });
  await success("set_text_content", { nodeId: "5Z-0", text: "Live edits arrive here." });
  await frame.getByText("Live edits arrive here.").waitFor();
  await success("set_tokens", { updates: { name: "paper", value: "#e8eddf" } });
  await preview.waitForFunction(() => getComputedStyle(document.querySelector("iframe")!.contentDocument!.body.firstElementChild!).backgroundColor === "rgb(232, 237, 223)");
  await preview.screenshot({ path: join(out, "preview-live.png") });
  // A preview is a viewer, not a second editor stealing the tool bridge.
  assert.equal(server.bridge.openFiles().length, 1);
  await preview.close();
  await editor.evaluate(async ({ fileId, selection }) => { const workspace = await import("/src/state/workspace.ts"); workspace.setSelection(fileId, selection); }, { fileId: fixture.id, selection: [second] });
  const byShortcut = editor.waitForEvent("popup");
  await editor.keyboard.press("Alt+p");
  const shortcut = await byShortcut;
  await shortcut.waitForURL(`**/preview/${fixture.id}/${second}`);
  await shortcut.frameLocator("iframe").getByText("Second artboard").waitFor();
  await shortcut.close();
  await editor.evaluate(async (fileId) => { const workspace = await import("/src/state/workspace.ts"); workspace.setSelection(fileId, []); }, fixture.id);
  await editor.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await editor.getByPlaceholder("Search actions, layers, pages and files").fill("Preview artboard");
  const byPalette = editor.waitForEvent("popup");
  await editor.getByPlaceholder("Search actions, layers, pages and files").press("Enter");
  const palette = await byPalette;
  await palette.waitForURL(`**/preview/${fixture.id}/${artboard}`);
  await palette.frameLocator("iframe").getByText("Live edits arrive here.").waitFor();
  await palette.reload();
  await palette.frameLocator("iframe").getByText("Live edits arrive here.").waitFor();
  await editor.evaluate(async (fileId) => { const workspace = await import("/src/state/workspace.ts"); await workspace.flushSave(fileId); }, fixture.id);
  const standalone = await session.browser.newPage();
  await standalone.context().addCookies(await palette.context().cookies());
  const previewUrl = palette.url();
  await editor.close(); // browser.newPage owns the popup's context, so use an independent one here.
  await standalone.goto(previewUrl);
  await standalone.frameLocator("iframe").getByText("Live edits arrive here.").waitFor();
  await standalone.waitForFunction(async () => !(await fetch("/api/status").then((r) => r.json())).editorConnected);
  await standalone.close();
  assert.deepEqual(errors, []);
  await writeFile(join(out, "preview-check.json"), JSON.stringify({ fonts, replayed: replay.length, successful: replay.filter((r) => r.outcome === "success").length, preview: ["button: containing artboard", "shortcut: selected artboard", "palette: first artboard", "reload", "live text and tokens", "local img and background", "bundled and Google fonts", "single bridge editor", "saved fallback after editor closes"], errors }, null, 2));
  console.log(`Preview integration passed. Screenshots: ${out}`);
  if (process.argv.includes("--desktop")) {
    await session.close(); session = undefined;
    const { desktopPreview } = await import("./ergonomics-desktop");
    await desktopPreview({ workspace: temp, fileId: fixture.id, nodeId: artboard, temp, out });
  }
} finally {
  await session?.close();
  if (previousHome === undefined) delete process.env.OPENCREASE_HOME; else process.env.OPENCREASE_HOME = previousHome;
  await rm(temp, { recursive: true, force: true });
}
