// Run against isolated server/Vite instances. Never starts a visible browser or server.
// OPENCREASE_PORT=29903 OPENCREASE_EDITOR_URL=http://localhost:5203 node scripts/vector-smoke.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const apiUrl = `http://127.0.0.1:${process.env.OPENCREASE_PORT ?? 29903}`;
const editorUrl = process.env.OPENCREASE_EDITOR_URL ?? 'http://localhost:5203';
const output = 'test-results/track3';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let fileId;
const frame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const screenshot = (name) => page.screenshot({ path: `${output}/${name}.png` });
async function fresh(name) {
  const file = await fetch(`${apiUrl}/api/files`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `Vector check ${name}` }) }).then((r) => r.json());
  fileId = file.id;
  await page.goto(`${editorUrl}/file/${fileId}`);
  await page.getByRole('button', { name: 'Move', exact: true }).waitFor();
  await page.evaluate(async () => {
    window.ws = await import('/src/state/workspace.ts');
    window.reg = await import('/src/canvas/registry.ts');
    window.vec = await import('/src/vector/state.ts');
    reg.setViewportLive({ x: 0, y: 0, zoom: 1 });
  });
  await page.waitForFunction(() => ws.getState().bridgeConnected);
}
const selected = () => page.evaluate(() => {
  const f = ws.getActiveFile();
  return f.selection.map((id) => f.store.doc.nodes[id]);
});
const nodes = () => page.evaluate(() => ws.getActiveFile().store.doc.nodes);
const root = () => page.evaluate(() => { const f = ws.getActiveFile(); return f.store.doc.pages[f.activePageId].rootId; });
async function select(ids) {
  await page.evaluate((ids) => ws.setSelection(ws.getActiveFile().id, ids), ids);
  await frame();
}
const screen = (x, y) => page.evaluate(({ x, y }) => reg.worldToScreen({ x, y }), { x, y });
async function click(x, y, options) { const p = await screen(x, y); await page.mouse.click(p.x, p.y, options); }
async function drag(x, y, xx, yy) {
  const a = await screen(x, y), b = await screen(xx, yy);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); await frame();
}
async function tool(tool, args) {
  const result = await fetch(`${apiUrl}/api/tools/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool, args: { fileId, ...args }, client: { name: 'codex-vector-check' } }) }).then((r) => r.json());
  assert.ok(!result.isError, JSON.stringify(result));
  return JSON.parse(result.content[1].text);
}
async function write(html) {
  return (await tool('write_html', { targetNodeId: await root(), mode: 'insert-children', html })).createdNodes.map((n) => n.id);
}
const pointState = () => page.evaluate(async () => {
  const { editModel, pointPosition, validRefs } = await import('/src/vector/edit.ts');
  const edit = vec.vectorUi.get().edit, doc = ws.getActiveFile().store.doc;
  const model = editModel(doc, edit.pathId);
  return { count: model.reduce((n, s) => n + s.anchors.length, 0), positions: validRefs(model, edit.selected).map((ref) => pointPosition(doc, edit, ref)), d: doc.nodes[edit.pathId].attrs.d };
});
try {
  await fresh('drawing');
  await page.keyboard.press('r'); await drag(80, 180, 260, 320);
  let [rect] = await selected(); assert.equal(rect.type, 'SVG'); assert.equal(rect.styles.width, 180);
  await page.getByRole('button', { name: 'Edit points', exact: true }).click();
  const beforeDrag = await nodes();
  await drag(80, 180, 100, 200);
  assert.ok(Math.abs((await pointState()).positions[0].x - 100) < 0.03);
  await page.keyboard.press('Control+z'); await frame(); assert.deepEqual(await nodes(), beforeDrag);
  await page.keyboard.press('Control+Shift+z'); await frame();
  await page.getByRole('textbox', { name: 'Point X', exact: true }).fill('110');
  await page.getByRole('textbox', { name: 'Point X', exact: true }).press('Enter');
  await frame(); assert.ok(Math.abs((await pointState()).positions[0].x - 110) < 0.03);
  const beforeType = (await pointState()).positions[0];
  await page.getByRole('radio', { name: /^Mirrored:/ }).click(); await frame();
  assert.ok(Math.abs((await pointState()).positions[0].x - beforeType.x) < 0.03);
  assert.ok(Math.abs(Number(await page.getByRole('textbox', { name: 'Point X', exact: true }).inputValue()) - beforeType.x) < 0.03);
  assert.match((await pointState()).d, /C/);
  // Drag an actual bezier handle, then undo it as one edit.
  const handle = await page.evaluate(async () => {
    const { editModel, pathToScreen } = await import('/src/vector/edit.ts');
    const edit = vec.vectorUi.get().edit, doc = ws.getActiveFile().store.doc;
    const a = editModel(doc, edit.pathId)[0].anchors[0], m = pathToScreen(doc, edit.pathId), o = reg.canvasOrigin();
    return { x: m[0] * a.out.x + m[2] * a.out.y + m[4] + o.x, y: m[1] * a.out.x + m[3] * a.out.y + m[5] + o.y };
  });
  const beforeHandle = await nodes();
  await page.mouse.move(handle.x, handle.y); await page.mouse.down(); await page.mouse.move(handle.x + 20, handle.y - 25, { steps: 8 }); await page.mouse.up(); await frame();
  assert.notDeepEqual(await nodes(), beforeHandle);
  await page.keyboard.press('Control+z'); await frame(); assert.deepEqual(await nodes(), beforeHandle);
  await screenshot('point-inspector');
  await page.keyboard.press('Escape');
  await page.keyboard.press('p'); await click(330, 200); await drag(450, 170, 490, 120); await click(580, 300); await click(330, 200);
  const [pen] = await selected(); assert.equal(pen.type, 'SVG');
  let all = await nodes(); assert.match(all[pen.children[0]].attrs.d, /C/); assert.match(all[pen.children[0]].attrs.d, /Z/);
  await page.keyboard.press('Enter'); await page.getByRole('toolbar', { name: 'Editing path' }).waitFor();
  await page.keyboard.press('Control+a'); assert.equal((await pointState()).positions.length, 3);
  const bounds = await page.evaluate((id) => reg.getWorldRect(id), pen.id);
  await drag(bounds.x - 10, bounds.y - 10, bounds.x + bounds.width + 10, bounds.y + bounds.height + 10);
  assert.equal((await pointState()).positions.length, 3);
  await screenshot('pen-edit');
  await page.keyboard.press('Escape');
  // All primitive tools remain reachable through the shape menu.
  for (const [name, x, y] of [['Ellipse', 80, 450], ['Polygon', 300, 450], ['Star', 530, 450], ['Line', 80, 670]]) {
    await page.getByRole('button', { name: /, shapes menu$/ }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click();
    await drag(x, y, x + 140, y + 100);
    const [shape] = await selected(); assert.equal(shape.type, 'SVG');
    all = await nodes();
    if (name === 'Polygon') {
      await page.getByRole('textbox', { name: 'Polygon sides' }).fill('6'); await page.getByRole('textbox', { name: 'Polygon sides' }).press('Enter');
      assert.equal((await nodes())[shape.children[0]].attrs['data-sides'], '6');
    }
    if (name === 'Star') {
      await page.getByRole('textbox', { name: 'Star points' }).fill('7'); await page.getByRole('textbox', { name: 'Star points' }).press('Enter');
      await page.getByRole('textbox', { name: 'Star inner radius' }).fill('50'); await page.getByRole('textbox', { name: 'Star inner radius' }).press('Enter');
      assert.equal((await nodes())[shape.children[0]].attrs['data-points'], '7');
    }
  }
  await screenshot('shapes');
  await page.setViewportSize({ width: 900, height: 900 });
  await page.getByRole('button', { name: 'More tools', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Pen/ }).click();
  assert.equal(await page.evaluate(() => ws.getState().tool), 'pen');
  await screenshot('toolbar-overflow');
  await page.setViewportSize({ width: 1440, height: 1000 });

  await fresh('editing');
  // Paste SVG, select an inner element, then edit a path through a transformed group.
  const markup = '<svg width="240" height="180" viewBox="0 0 240 180" style="left:100px;top:200px"><g transform="translate(20 20)" stroke="blue" stroke-linecap="round"><path d="M0 100C40 0 100 0 140 100" fill="none" stroke-width="4"/><rect x="150" y="20" width="30" height="60" fill="red"/></g></svg>';
  await page.evaluate((html) => {
    const data = new DataTransfer(); data.setData('text/plain', html);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, markup);
  await frame(); const [pasted] = await selected(); assert.equal(pasted.type, 'SVG');
  all = await nodes(); const group = all[pasted.children[0]], path = all[group.children[0]];
  const anchor = await page.evaluate((id) => { const el = document.querySelector(`[data-of-id="${id}"]`); const m = el.getScreenCTM(); return { x: m.e, y: m.f + 100 * m.d }; }, path.id);
  await page.keyboard.down('Control'); await page.mouse.click(anchor.x, anchor.y); await page.keyboard.up('Control');
  assert.equal((await selected())[0].id, path.id);
  await page.getByRole('combobox', { name: 'Stroke cap' }).selectOption('butt');
  await page.getByRole('textbox', { name: 'Stroke dashes' }).fill('8 4'); await page.getByRole('textbox', { name: 'Stroke dashes' }).press('Enter');
  assert.equal((await nodes())[path.id].attrs['stroke-linecap'], 'butt');
  await page.keyboard.press('Enter');
  await frame();
  await page.keyboard.press('Control+Shift+Quote');
  const snapBefore = await page.evaluate(() => vec.vectorUi.get().snapHalf); assert.equal(snapBefore, true);
  await page.mouse.move(anchor.x, anchor.y); await page.mouse.down(); await page.mouse.move(anchor.x + 10.3, anchor.y + 7.3, { steps: 8 }); await page.mouse.up(); await frame();
  let pos = (await pointState()).positions[0]; assert.equal(pos.x, 130.5); assert.equal(pos.y, 327.5);
  await screenshot('svg-inner-edit');
  // Add a point at the curve midpoint using the same model as the rendered SVG.
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  const midpoint = await page.evaluate(async () => {
    const edit = vec.vectorUi.get().edit;
    const el = document.querySelector(`[data-of-id="${edit.pathId}"]`), p = el.getPointAtLength(el.getTotalLength() / 2), m = el.getScreenCTM();
    return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
  });
  const count = (await pointState()).count;
  await page.mouse.click(midpoint.x, midpoint.y); await frame(); assert.equal((await pointState()).count, count + 1);
  await page.keyboard.press('Backspace'); await frame(); assert.equal((await pointState()).count, count);
  await page.keyboard.press('Control+z'); await frame(); assert.equal((await pointState()).count, count + 1);
  await page.keyboard.press('Escape');
  // A draft must disappear when another tool is chosen.
  await page.keyboard.press('p'); await click(500, 500); await page.keyboard.press('v');
  assert.equal(await page.evaluate(() => vec.vectorUi.get().pen), null);

  await fresh('operations');
  for (const [op, y] of [['union', 150], ['subtract', 350], ['intersect', 550], ['exclude', 750]]) {
    const ids = await write(`<svg width="140" height="140" viewBox="0 0 140 140" style="left:100px;top:${y}px"><rect width="140" height="140" fill="#f05a28" /></svg><svg width="140" height="140" viewBox="0 0 140 140" style="left:170px;top:${y}px"><circle cx="70" cy="70" r="70" fill="#142b47" /></svg>`);
    await select(ids);
    if (op === 'union') { await page.getByRole('button', { name: 'Union', exact: true }).click(); }
    else {
      const result = await tool('oc_boolean_op', { nodeIds: ids, operation: op }); await select(result.createdNodes.map((n) => n.id));
    }
    const [result] = await selected(); all = await nodes(); assert.equal(result.type, 'SVG'); assert.equal(all[ids[0]], undefined);
    assert.match(all[result.children[0]].attrs.d, /C/);
  }
  await screenshot('booleans');
  const [line] = await write('<svg width="200" height="40" viewBox="0 0 200 40" style="left:500px;top:180px"><path d="M0 20C40 0 140 40 200 20" fill="none" stroke="#142b47" stroke-width="12" stroke-linecap="square" stroke-dasharray="20 10" /></svg>');
  await select([line]); await page.getByRole('button', { name: 'Outline stroke', exact: true }).click();
  const [outlined] = await selected(); assert.equal((await nodes())[outlined.children[0]].attrs.stroke, undefined);
  const flatten = await tool('oc_flatten', { nodeIds: [outlined.id] }); assert.equal(flatten.createdNodes.length, 1);
  await select(flatten.createdNodes.map((n) => n.id)); await screenshot('outlined-stroke');

  await fresh('tracing');
  const src = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 120; c.height = 80; const ctx = c.getContext('2d'); ctx.fillStyle = '#142b47'; ctx.fillRect(0, 0, 120, 80); ctx.fillStyle = '#ff6030'; ctx.fillRect(15, 15, 55, 50); ctx.fillStyle = '#faf4df'; ctx.beginPath(); ctx.arc(85, 40, 20, 0, Math.PI * 2); ctx.fill(); return c.toDataURL(); });
  const [image] = await write(`<img src="${src}" style="width:480px;height:320px;left:120px;top:200px;object-fit:contain" />`);
  await select([image]); await page.getByRole('button', { name: 'Trace to vector', exact: true }).click();
  await page.waitForFunction((id) => { const f = ws.getActiveFile(); return !f.store.doc.nodes[id] && f.selection.length === 1 && f.store.doc.nodes[f.selection[0]]?.type === 'SVG'; }, image, { timeout: 45000 });
  const [traced] = await selected(); assert.equal(traced.styles.width, 480); assert.ok(traced.children.length >= 3);
  await screenshot('vectorised-raster');
  await page.keyboard.press('Control+z'); await frame(); assert.equal((await nodes())[image].type, 'Image');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, screenshots: output, browserErrors: errors }));
} catch (error) { await screenshot("failure"); throw error; } finally { await browser.close(); }
