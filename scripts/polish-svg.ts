import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { launchChromium } from '../apps/server/src/render';
const fixture = JSON.parse(await readFile('test-results/polish/after/fixture.json', 'utf8'));
const output = 'test-results/polish/svg'; await mkdir(output, { recursive: true });
const browser = await launchChromium();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`http://127.0.0.1:5211/file/${fixture.fileId}`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '[data-of-overlay] { visibility:hidden!important; }' });
  await page.evaluate(async ({ ids }) => {
    const ws = await import(performance.getEntriesByType('resource').filter((r) => r.name.includes('/src/state/workspace.ts')).at(-1)!.name);
    const file = ws.getActiveFile();
    file.store.transact('SVG capture check', (tx) => {
      const rect = tx.doc.nodes[ids.Rect], group = tx.doc.nodes[ids.Group];
      const attrs = { ...rect.attrs }; delete attrs.fill;
      tx.updateNode(rect.id, { attrs: { ...attrs, transform: 'rotate(5 34 34)' } });
      tx.updateNode(group.id, { attrs: { ...group.attrs, fill: '#d97757' } });
    });
    ws.setSelection(file.id, []);
  }, fixture);
  await page.waitForTimeout(100);
  const report = [];
  for (const name of ['Rect', 'Group']) {
    const id = fixture.ids[name];
    const bounds = await page.locator(`[data-of-id="${id}"]`).first().boundingBox();
    const original = await page.screenshot({ clip: { x: bounds!.x, y: bounds!.y, width: Math.round(bounds!.width), height: Math.round(bounds!.height) }, animations: 'disabled', omitBackground: true });
    const shot = await page.evaluate(async ({ fileId, id }) => {
      const ex = await import(performance.getEntriesByType('resource').filter((r) => r.name.includes('/src/agent/exporter.ts')).at(-1)!.name);
      const capture = await ex.captureNode(fileId, id, 1);
      return capture.canvas.toDataURL();
    }, { fileId: fixture.fileId, id });
    const png = Buffer.from(shot.split(',')[1], 'base64');
    await writeFile(`${output}/${name}-export.png`, png);
    await writeFile(`${output}/${name}-canvas.png`, original);
    const actual = PNG.sync.read(png);
    // Filled pixels ensure inherited SVG paint survived capture (transparent exports used to pass silently).
    let painted = 0;
    for (let i = 3; i < actual.data.length; i += 4) if (actual.data[i] > 128) painted++;
    assert.ok(painted > actual.width * actual.height * .25, `${name} exported transparent`);
    const ref = PNG.sync.read(original);
    assert.equal(actual.width, ref.width); assert.equal(actual.height, ref.height);
    const composite = new PNG({ width: actual.width, height: actual.height });
    const background = [242, 240, 233];
    for (let i = 0; i < actual.data.length; i += 4) {
      const alpha = actual.data[i + 3] / 255;
      for (let c = 0; c < 3; c++) composite.data[i + c] = Math.round(actual.data[i + c] * alpha + background[c] * (1 - alpha));
      composite.data[i + 3] = 255;
    }
    const diff = new PNG({ width: actual.width, height: actual.height });
    const fraction = pixelmatch(composite.data, ref.data, diff.data, ref.width, ref.height, { threshold: .1, includeAA: false }) / (ref.width * ref.height);
    await writeFile(`${output}/${name}-diff.png`, PNG.sync.write(diff));
    assert.ok(fraction < .005, `${name} differs from Chromium by ${(fraction * 100).toFixed(2)}%`);
    report.push({ name, width: actual.width, height: actual.height, painted, changedPercent: fraction * 100 });
  }
  await writeFile(`${output}/checks.json`, JSON.stringify(report, null, 2));
  console.log(report);
} finally { await browser.close(); }
