// Separate from vitest: real Chromium pixels, committed platform baselines and export fidelity.
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { startHeadless } from "../../apps/server/src/headless";

const update = process.argv.includes("--update");
const fixtures = resolve("tests/fixtures");
const output = resolve("test-results/visual");
const baseline = resolve("tests/visual/baselines", process.platform);
await mkdir(output, { recursive: true });
await mkdir(baseline, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "opencrease-visual-"));
const previousHome = process.env.OPENCREASE_HOME;
process.env.OPENCREASE_HOME = join(temp, "home");
let failures = 0;

function compare(actual: Buffer, expected: Buffer, label: string, tolerance: number): Promise<void> {
  const a = PNG.sync.read(actual);
  const b = PNG.sync.read(expected);
  assert.equal(a.width, b.width, `${label}: width`);
  assert.equal(a.height, b.height, `${label}: height`);
  const diff = new PNG({ width: a.width, height: a.height });
  const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1, includeAA: false });
  const fraction = changed / (a.width * a.height);
  console.log(`${label}: ${(fraction * 100).toFixed(3)}% changed (limit ${tolerance * 100}%)`);
  if (fraction > tolerance) {
    failures++;
    return writeFile(join(output, `${label.replace(/[^\w-]/g, "-")}-diff.png`), PNG.sync.write(diff));
  }
  return Promise.resolve();
}

try {
  for (const name of (await readdir(fixtures)).filter((n) => n.endsWith(".fold")).sort()) {
    const file = join(temp, name);
    await cp(join(fixtures, name), file, { recursive: true });
    const session = await startHeadless({ file, exportDir: join(temp, "exports") });
    try {
      const doc = await session.server.workspace.readDocument(session.fileId!);
      const nodeId = Object.values(doc.pages).flatMap((p) => doc.nodes[p.rootId]!.children)[0]!;
      const page = session.page;
      await page.keyboard.press(process.platform === "darwin" ? "Meta+0" : "Control+0");
      await page.addStyleTag({ content: '[data-of-overlay] { visibility: hidden !important; }' });
      const node = page.locator(`[data-of-id="${nodeId}"]`).first();
      await node.waitFor();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const canvas = await node.screenshot({ animations: "disabled" });
      const stem = name.slice(0, -5);
      await writeFile(join(output, `${stem}-canvas.png`), canvas);
      const baselinePath = join(baseline, `${stem}.png`);
      if (update) await writeFile(baselinePath, canvas);
      else await compare(canvas, await readFile(baselinePath).catch(() => { throw new Error(`Missing baseline ${baselinePath}. Run pnpm test:visual:update on ${process.platform}.`); }), `${stem}-regression`, 0.005);
      const result = await session.callTool("export", { fileId: doc.id, nodes: { [nodeId]: [{ format: "png", scale: "1x" }] } });
      assert.ok(!result.isError, JSON.stringify(result));
      const body = JSON.parse((result.content[1] as { text: string }).text);
      const exported = await readFile(body.exports[0].path);
      await writeFile(join(output, `${stem}-export.png`), exported);
      // Native canvas pixels are the reference, never another invocation of our exporter.
      await compare(exported, canvas, `${stem}-fidelity`, 0.005);
      const screenshot = await session.callTool("get_screenshot", { fileId: doc.id, nodeId, scale: 1 });
      assert.ok(screenshot.content.some((c) => c.type === "image"), "Headless screenshots must return image content");
    } finally { await session.close(); }
  }
} finally {
  if (previousHome === undefined) delete process.env.OPENCREASE_HOME;
  else process.env.OPENCREASE_HOME = previousHome;
  await rm(temp, { recursive: true, force: true });
}
assert.equal(failures, 0, `${failures} visual comparisons exceeded tolerance; inspect ${output}`);
