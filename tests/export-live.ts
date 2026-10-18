// Full export acceptance check. Requires ffprobe/ffmpeg for container and alpha verification.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { PNG } from "pngjs";
import { startHeadless } from "../apps/server/src/headless";
import { TOOLS } from "../packages/protocol/src/index";

const output = resolve("test-results/export-live");
await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "of-track6-"));
const previousHome = process.env.OPENCREASE_HOME;
process.env.OPENCREASE_HOME = join(temp, "home");
// A GUI can run concurrently with a different credential. Its dev token must never override ours.
await mkdir(join(process.env.OPENCREASE_HOME, "sessions"), { recursive: true });
await writeFile(join(process.env.OPENCREASE_HOME, "sessions", "29880.token"), "unrelated-gui-token-0000000000\n");
const file = join(temp, "Acceptance.fold");
await cp(resolve("tests/fixtures/layout.fold"), file, { recursive: true });
const bin = resolve("apps/server/bin/opencrease.mjs");
function command(argv: string[]): string {
  const child = spawnSync(process.execPath, [bin, ...argv], { encoding: "utf8", timeout: 120_000 });
  assert.equal(child.status, 0, child.stderr + child.stdout);
  return child.stdout;
}
function probe(path: string): { streams: Array<{ codec_name: string; width: number; height: number; r_frame_rate: string; tags?: Record<string, string> }>; format: { duration: string } } {
  const child = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}
const body = (r: { content: Array<{ type: string; text?: string }> }) => JSON.parse(r.content[1]!.text!);
try {
  const session = await startHeadless({ file, port: 29910, vitePort: 5210, source: true, exportDir: output });
  try {
    const call = async (tool: string, args: Record<string, unknown>) => {
      const r = await session.callTool(tool, { fileId: session.fileId, ...args });
      assert.ok(!r.isError, JSON.stringify(r));
      return r;
    };
    const initial = await session.server.workspace.readDocument(session.fileId!);
    const layoutId = Object.values(initial.nodes).find((n) => n.name === "Layout")!.id;
    const board = body(await call("create_artboard", { name: "Animated mesh", styles: { width: 320, height: 180, backgroundColor: "transparent", overflow: "hidden" } })).id;
    await call("oc_post_brief", { artboardId: board, mood: "Vivid study", palette: "Coral, gold, violet and mint", type: "Geist 700 at 28", direction: "A centred title over an animated mesh" });
    await call("write_html", { targetNodeId: board, mode: "insert-children", html: '<canvas layer-name="Mesh" data-shader="MeshGradient" data-params=\'{"colors":["#fba26a","#ed5267","#5743a8","#75c9ad"],"speed":1,"distortion":0.8}\' style="position:absolute;left:40px;top:10px;width:240px;height:160px;border-radius:80px"></canvas><div style="position:absolute;left:20px;top:68px;font-family:Geist Variable;font-size:28px;font-weight:700;color:#fff">OpenCrease</div><svg layer-name="Export mark" width="20" height="20" style="position:absolute;left:280px;top:140px"><circle cx="10" cy="10" r="8" fill="#ff5b14"/></svg>' });
    const children = body(await call("get_children", { nodeId: board })).children;
    const svg = children.find((n: { name: string }) => n.name === "Export mark").id;
    const imageFormats = ["png", "jpg", "webp", "avif", "pdf"];
    for (const format of imageFormats) {
      const r = body(await call("export", { nodes: { [board]: [{ format, scale: "1x" }] } }));
      assert.ok(!r.errors?.length, JSON.stringify(r));
      assert.ok(!r.warnings?.length, JSON.stringify(r));
      const path = r.exports[0].path;
      const data = await readFile(path);
      assert.ok(data.length > 100);
      if (format !== "pdf") {
        await session.page.route(`**/check-${format}`, (route) => route.fulfill({ body: data, contentType: format === "jpg" ? "image/jpeg" : `image/${format}` }));
        const size = await session.page.evaluate(async (format) => {
          const image = new Image(); image.src = `/check-${format}`; await image.decode(); return [image.naturalWidth, image.naturalHeight];
        }, format);
        assert.deepEqual(size, [320, 180]);
      } else {
        assert.match(data.toString("latin1", 0, 8), /%PDF-/);
        const text = spawnSync("pdftotext", [path, "-"], { encoding: "utf8" });
        if (!text.error) { assert.equal(text.status, 0); assert.match(text.stdout, /OpenCrease/); }
        const fonts = spawnSync("pdffonts", [path], { encoding: "utf8" });
        if (!fonts.error) { assert.equal(fonts.status, 0); assert.match(fonts.stdout, /Geist.*yes\s+yes/); }

      }
      console.log(`${format}: ${data.length} bytes, decoded successfully`);
    }
    const svgResult = body(await call("export", { nodes: { [svg]: [{ format: "svg", scale: "1x" }] } }));
    assert.match(await readFile(svgResult.exports[0].path, "utf8"), /<circle/);
    const combined = body(await call("export_combined_pdf", { nodeIds: [board, layoutId] }));
    assert.equal(combined.pageCount, 2);
    console.log("SVG and combined PDF: verified");
    for (const [format, fps] of [["mp4", 60], ["webm", 24]] as const) {
      const r = body(await call("export", { type: "video", nodes: { [board]: [{ format, scale: "1x", durationSeconds: 2, fps }] } }));
      assert.ok(!r.errors?.length, JSON.stringify(r));
      const path = r.exports[0].path;
      const info = probe(path);
      assert.equal(info.streams[0]!.width, 320);
      assert.equal(info.streams[0]!.height, 180);
      assert.equal(info.streams[0]!.r_frame_rate, `${fps}/1`);
      assert.ok(Math.abs(Number(info.format.duration) - 2) < 0.1);
      const frames: PNG[] = [];
      for (const at of [0, 1]) {
        const png = join(output, `${format}-${at}.png`);
        const decode = spawnSync("ffmpeg", ["-v", "error", ...(format === "webm" ? ["-c:v", "libvpx-vp9"] : []), "-i", path, "-ss", String(at), "-frames:v", "1", "-y", png], { encoding: "utf8" });
        assert.equal(decode.status, 0, decode.stderr);
        frames.push(PNG.sync.read(await readFile(png)));
      }
      assert.notDeepEqual(frames[0]!.data, frames[1]!.data, `${format} must animate`);
      if (format === "webm") {
        assert.equal(info.streams[0]!.tags?.alpha_mode ?? info.streams[0]!.tags?.ALPHA_MODE, "1");
        assert.equal(frames[0]!.data[3], 0, "WebM corners must remain transparent");
        const repeated = body(await call("export", { type: "video", nodes: { [board]: [{ format, scale: "1x", suffix: "-repeat", durationSeconds: 2, fps }] } }));
        const repeatedPng = join(output, "webm-repeat.png");
        const decode = spawnSync("ffmpeg", ["-v", "error", "-c:v", "libvpx-vp9", "-i", repeated.exports[0].path, "-frames:v", "1", "-y", repeatedPng], { encoding: "utf8" });
        assert.equal(decode.status, 0, decode.stderr);
        assert.deepEqual(PNG.sync.read(await readFile(repeatedPng)).data, frames[0]!.data, "Repeated shader export must start at the same deterministic time");
        assert.ok(frames[0]!.data.some((v, i) => i % 4 === 3 && v === 255), "WebM must contain opaque pixels too");
      } else assert.equal(frames[0]!.data[3], 255);
      console.log(`${format}: ${info.streams[0]!.codec_name}, 320x180, 2 s, ${fps} fps, animation and alpha verified`);
    }
    // Inspect the real export section, including its asynchronously generated image preview.
    const page = session.page;
    await page.keyboard.press("Shift+1");
    await page.locator(`[data-layer-id="${layoutId}"]`).click();
    const inspector = page.locator(".of-inspector");
    await inspector.getByText("Export", { exact: true }).scrollIntoViewIfNeeded();
    await inspector.locator(".of-export-preview img").waitFor({ state: "visible", timeout: 15_000 });
    await page.screenshot({ path: join(output, "inspector.png") });
    await inspector.getByRole("button", { name: "Presets", exact: true }).click();
    await page.getByText("Open Graph image  (1 file)", { exact: true }).click();
    assert.equal(await inspector.getByLabel("Scale", { exact: true }).inputValue(), "1200w");
    await inspector.getByLabel("Format", { exact: true }).selectOption("pdf");
    await inspector.getByLabel("PDF image quality", { exact: true }).selectOption("low");
    await inspector.getByLabel("PDF image resampling", { exact: true }).selectOption("basic");
    await inspector.locator(".of-export-preview img").waitFor({ state: "visible", timeout: 15_000 });
    await inspector.locator(".of-export-go").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, "inspector-pdf.png") });
    await page.locator(`[data-layer-id="${board}"]`).click();
    await inspector.getByRole("button", { name: "Add export", exact: true }).click();
    await inspector.getByLabel("Format", { exact: true }).selectOption("webm");
    const length = inspector.getByLabel("Video length in seconds", { exact: true });
    await length.fill("1"); await length.press("Enter");
    await inspector.getByLabel("Frames per second", { exact: true }).selectOption("30");
    await inspector.getByText("Export", { exact: true }).scrollIntoViewIfNeeded();
    await inspector.locator(".of-export-preview img").waitFor({ state: "visible", timeout: 15_000 });
    await inspector.locator(".of-export-go").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, "inspector-video.png") });
    const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
    await inspector.getByRole("button", { name: "Export 1 file", exact: true }).click();
    const download = await downloadPromise;
    const uiVideo = join(output, "inspector-video.webm");
    await download.saveAs(uiVideo);
    const uiInfo = probe(uiVideo);
    assert.equal(uiInfo.streams[0]!.r_frame_rate, "30/1");
    assert.ok(Math.abs(Number(uiInfo.format.duration) - 1) < 0.1);
    console.log("Inspector presets, PDF options and actual 30 fps WebM download: verified");

  } finally { await session.close(); }

  command(["export", file, "--node", "Layout", "--format", "png", "--scale", "512w", "-o", join(output, "cli")]);
  const cliPng = PNG.sync.read(await readFile(join(output, "cli", "Layout@512w.png")));
  assert.equal(cliPng.width, 512);
  command(["render", file, "--node", "Layout", "--scale", "1x", "-o", join(output, "cli-render")]);
  for (const format of ["css", "tailwind", "json"]) command(["tokens", "export", "--file", file, "--format", format]);
  console.log("Headless export, render, CSS/Tailwind/JSON token CLI: verified");

  const child = spawn(process.execPath, [bin, "mcp", "--headless", "--file", file], { stdio: ["pipe", "pipe", "pipe"] });
  let errors = "";
  child.stderr.on("data", (data) => { errors += data; });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<number, (v: unknown) => void>();
  lines.on("line", (line) => { const message = JSON.parse(line); if (message.id) pending.get(message.id)?.(message); });
  let counter = 0;
  const rpc = (method: string, params: unknown) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => reject(new Error(`MCP timeout: ${method}. ${errors}`)), 60_000);
    pending.set(id, (r) => { clearTimeout(timer); pending.delete(id); resolve(r as Record<string, unknown>); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  try {
    const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "acceptance", version: "1" } });
    assert.ok(init.result, JSON.stringify(init));
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const list = await rpc("tools/list", {});
    assert.equal((list.result as { tools: unknown[] }).tools.length, TOOLS.length);
    const added = await rpc("tools/call", { name: "create_artboard", arguments: { fileId: "fixture-layout", name: "Stdio saved", styles: { width: 100, height: 100 } } });
    const created = body(added.result as Parameters<typeof body>[0]).id;
    const shot = await rpc("tools/call", { name: "get_screenshot", arguments: { fileId: "fixture-layout", nodeId: created, scale: 1 } });
    assert.ok((shot.result as { content: Array<{ type: string }> }).content.some((c) => c.type === "image"));
    const onDisk = JSON.parse(await readFile(join(file, "document.json"), "utf8"));
    assert.ok(Object.values(onDisk.nodes).some((n) => (n as { name: string }).name === "Stdio saved"));
    console.log(`Headless stdio MCP: ${TOOLS.length} tools exposed, write persisted and screenshot returned`);
  } finally {
    child.stdin.end();
    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
    const timer = setTimeout(() => child.kill("SIGTERM"), 15_000);
    const code = await exited;
    clearTimeout(timer);
    assert.equal(code, 0, errors);
  }
} finally {
  if (previousHome === undefined) delete process.env.OPENCREASE_HOME; else process.env.OPENCREASE_HOME = previousHome;
  await rm(temp, { recursive: true, force: true });
}
await writeFile(join(output, "verified.txt"), "PNG JPG WebP AVIF SVG PDF combined PDF MP4 WebM CLI stdio MCP passed\n");
