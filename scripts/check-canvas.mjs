// Track 4 live regression check. Requires the isolated server on 29904 and Vite on 5204.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const url = process.argv[2] ?? "http://localhost:5204";
const out = process.argv[3] ?? "/tmp/of-track4/live";
await mkdir(out, { recursive: true });
const res = await fetch("http://127.0.0.1:29904/api/files", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Canvas live checks" }) });
const file = await res.json();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1560, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const check = async (fn, arg) => page.evaluate(fn, arg);
const until = async (fn, arg) => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await check(fn, arg)) return; await new Promise((r) => setTimeout(r, 30)); }
  throw new Error("Live condition timed out");
};
const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
try {
  await page.goto(`${url}/file/${file.id}`, { waitUntil: "networkidle" });
  const ids = await check(async () => {
    const w = await import("/src/state/workspace.ts");
    const r = await import("/src/canvas/registry.ts");
    const f = w.getActiveFile();
    const root = f.store.doc.pages[f.activePageId].rootId;
    const ids = f.store.transact("Fixture", (tx) => tx.insertTrees(root, [
      { type: "Frame", name: "Canvas laboratory", styles: { left: 0, top: 0, width: 900, height: 700, position: "absolute", backgroundColor: "#f5f2eb" }, children: [
        { type: "Text", name: "Title", text: "Room to explore", styles: { position: "absolute", left: 40, top: 30, fontSize: 32, fontWeight: 600, color: "#242720" } },
        { type: "Frame", name: "Grid study", styles: { position: "absolute", left: 40, top: 100, width: 420, height: 180, display: "grid", gridTemplateColumns: "1fr 2fr", gridTemplateRows: "1fr 1fr", gap: 12 }, children: [0, 1, 2, 3].map((i) => ({ type: "Rectangle", name: `Cell ${i}`, styles: { backgroundColor: i % 2 ? "#bbc6af" : "#e4a783", borderRadius: 12 } })) },
        { type: "Frame", name: "Constraint parent", styles: { position: "absolute", left: 500, top: 100, width: 320, height: 180, backgroundColor: "#e5dfd2", borderRadius: 12 }, children: [
          { type: "Rectangle", name: "Pinned child", constraints: { horizontal: "right", vertical: "bottom" }, styles: { position: "absolute", left: 240, top: 100, width: 60, height: 60, backgroundColor: "#718368", borderRadius: 8 } },
        ] },
        { type: "Rectangle", name: "Rotate me", styles: { position: "absolute", left: 100, top: 380, width: 120, height: 90, backgroundColor: "#d19069", rotate: "30deg", borderRadius: 8 } },
        { type: "Text", name: "Scale me", text: "A considered scale", styles: { position: "absolute", left: 350, top: 390, width: 240, height: 60, fontSize: 20, padding: 8, color: "#343f30" } },
        ...[0, 1, 2].map((i) => ({ type: "Rectangle", name: `Arrange ${i}`, styles: { position: "absolute", left: 80 + i * 150, top: 550 + i * 12, width: 80, height: 40, backgroundColor: "#718368", borderRadius: 8 } })),
      ] },
      { type: "Frame", name: "Far artboard", styles: { position: "absolute", left: 20000, top: 0, width: 900, height: 700, backgroundColor: "#fff" }, children: [{ type: "Text", text: "Offscreen geometry", styles: { fontSize: 20 } }] },
    ]));
    const children = f.store.doc.nodes[ids[0]].children;
    w.setSelection(f.id, []);
    r.setViewportLive({ x: 40, y: 70, zoom: 0.85 });
    return { art: ids[0], far: ids[1], title: children[0], grid: children[1], parent: children[2], child: f.store.doc.nodes[children[2]].children[0], rotated: children[3], scale: children[4], arrange: children.slice(5) };
  });
  const select = async (ids) => { await check(async (ids) => { const w = await import("/src/state/workspace.ts"); w.setSelection(w.getActiveFile().id, ids); }, ids); await frames(); };
  const styles = (id) => check(async (id) => { const w = await import("/src/state/workspace.ts"); return w.getActiveFile().store.doc.nodes[id].styles; }, id);
  await select([ids.grid]);
  await page.waitForSelector("[data-of-grid-lines]");
  await page.getByRole("textbox", { name: "Columns", exact: true }).fill("repeat(3, 1fr)");
  await page.getByRole("textbox", { name: "Columns", exact: true }).press("Enter");
  assert.equal((await styles(ids.grid)).gridTemplateColumns, "repeat(3, 1fr)");
  await select([ids.child]);
  assert.equal(await page.getByLabel("Horizontal constraint", { exact: true }).inputValue(), "right");
  // Real MCP bridge call, keeping one undo step for the resize and its constrained descendants.
  const apiResult = await fetch("http://127.0.0.1:29904/api/tools/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "update_styles", args: { fileId: file.id, updates: [{ nodeIds: [ids.parent], styles: { width: 360, height: 220 } }] }, client: { name: "canvas-check" } }) }).then((r) => r.json());
  assert(!apiResult.isError, JSON.stringify(apiResult));
  assert.equal((await styles(ids.child)).left, 280);
  assert.equal((await styles(ids.child)).top, 140);
  await check(async ({ parent }) => {
    const w = await import("/src/state/workspace.ts"), c = await import("/src/panels/right/inspector/common.tsx");
    c.applyStyles({ fileId: w.getActiveFile().id, ids: [parent] }, { width: "50%" }, "Responsive size");
  }, { parent: ids.parent });
  assert.equal((await styles(ids.child)).left, 370);
  await check(async ({ parent }) => {
    const w = await import("/src/state/workspace.ts"), c = await import("/src/panels/right/inspector/common.tsx");
    c.applyStyles({ fileId: w.getActiveFile().id, ids: [parent] }, { width: 360 }, "Restore size");
  }, { parent: ids.parent });
  await select([ids.rotated]);
  const rotate = page.locator('[data-of-rotate-zone="ne"]');
  await rotate.waitFor();
  const rb = await rotate.boundingBox();
  await page.keyboard.down("Shift");
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2); await page.mouse.down();
  await page.mouse.move(rb.x + 20, rb.y + 100, { steps: 8 }); await page.mouse.up();
  await page.keyboard.up("Shift");
  assert.equal(Number.parseFloat((await styles(ids.rotated)).rotate) % 15, 0);
  // Rotated hit testing excludes the axis-aligned bounding box's empty corners.
  const hits = await check(async (id) => {
    const w = await import("/src/state/workspace.ts"), r = await import("/src/canvas/registry.ts"), h = await import("/src/canvas/hit.ts");
    const el = r.getNodeElement(id), b = el.getBoundingClientRect();
    return { center: h.hitIds(w.getActiveFile().store.doc, b.x + b.width / 2, b.y + b.height / 2).includes(id), corner: h.hitIds(w.getActiveFile().store.doc, b.x + 1, b.y + 1).includes(id) };
  }, ids.rotated);
  assert(hits.center); assert(!hits.corner);
  await select(ids.arrange);
  await page.getByRole("button", { name: "Align and distribute", exact: true }).click();
  await page.getByRole("menuitem", { name: "Align top", exact: true }).click();
  assert.equal((await styles(ids.arrange[2])).top, 550);
  // Group resize through the actual corner handle.
  const union = await check(async (ids) => {
    const r = await import("/src/canvas/registry.ts");
    return ids.map((id) => r.getNodeElement(id).getBoundingClientRect().toJSON());
  }, ids.arrange);
  const right = Math.max(...union.map((r) => r.right)), bottom = Math.max(...union.map((r) => r.bottom));
  await page.mouse.move(right, bottom); await page.mouse.down(); await page.mouse.move(right + 80, bottom + 20, { steps: 8 }); await page.mouse.up();
  assert((await styles(ids.arrange[0])).width > 80);
  await select([ids.scale]);
  await page.keyboard.press("k"); await frames();
  const sb = await page.locator(`[data-of-world] [data-of-id="${ids.scale}"]`).first().boundingBox();
  await page.mouse.move(sb.x + sb.width, sb.y + sb.height); await page.mouse.down(); await page.mouse.move(sb.x + sb.width * 1.5, sb.y + sb.height * 1.5, { steps: 8 }); await page.mouse.up();
  assert((await styles(ids.scale)).fontSize > 20);
  await page.keyboard.press("v");
  await select([ids.title]); await page.keyboard.press("Tab");
  assert.deepEqual(await check(async () => (await import("/src/state/workspace.ts")).getActiveFile().selection), [ids.grid]);
  await page.keyboard.press("Shift+Tab");
  await select([]);
  const before = await check(async () => (await import("/src/canvas/registry.ts")).getViewportLive());
  await page.keyboard.press("ArrowRight");
  const after = await check(async () => (await import("/src/canvas/registry.ts")).getViewportLive());
  assert.equal(after.x, before.x - 40);
  const canvas = page.locator("[data-of-canvas]");
  const cb = await canvas.boundingBox();
  await page.keyboard.press("z"); await page.mouse.click(cb.x + cb.width / 2, cb.y + 300); await frames();
  const zoomed = await check(async () => (await import("/src/canvas/registry.ts")).getViewportLive().zoom);
  assert(zoomed > after.zoom);
  await page.keyboard.down("Alt"); await page.mouse.click(cb.x + cb.width / 2, cb.y + 300); await page.keyboard.up("Alt");
  await page.keyboard.press("v");
  // Sidebar size is saved, and preferences drive both theme and reduced motion attributes.
  const separator = page.getByRole("separator", { name: "Resize left sidebar" });
  await separator.focus(); await separator.press("ArrowRight");
  assert.equal(await check(async () => (await import("/src/state/prefs.ts")).getPrefs().leftWidth), 258);
  await check(async () => { const r = await import("/src/canvas/registry.ts"); r.setViewportLive({ x: 40, y: 70, zoom: 0.85 }); });
  await select([ids.grid]);
  for (const theme of ["light", "dark"]) {
    await check(async (theme) => (await import("/src/state/prefs.ts")).setPrefs({ theme }), theme);
    await frames(); await page.screenshot({ path: `${out}/grid-${theme}.png` });
    await check(async () => (await import("/src/panels/shared.ts")).openSettings("general"));
    await page.getByRole("radiogroup", { name: "Editor theme" }).waitFor();
    await page.screenshot({ path: `${out}/settings-${theme}.png` });
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
  // Responsive preview from the actual artboard context menu.
  await select([ids.art]);
  await page.locator(`[data-of-artboard-label="${ids.art}"]`).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Responsive preview/ }).click();
  assert.equal(await page.locator("[data-of-responsive-preview]").count(), 3);
  // MCP offscreen reads must pin and mount the actual subtree.
  const info = await fetch("http://127.0.0.1:29904/api/tools/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "get_node_info", args: { fileId: file.id, nodeId: ids.far }, client: { name: "canvas-check" } }) }).then((r) => r.json());
  assert(!info.isError);
  assert.equal(await page.locator(`[data-of-world] [data-of-id="${ids.far}"][data-of-virtual]`).count(), 0);
  // Clipboard formats and paste-to-replace use the actual system clipboard in Chromium.
  await select([ids.child]);
  await check(async () => { const clip = await import("/src/canvas/clipboard-extra.ts"); await clip.copySelection(); });
  const copied = await check(async () => {
    const items = await navigator.clipboard.read();
    return await (await items[0].getType("text/html")).text();
  });
  assert(copied.includes("data-of-trees"));
  await check(async () => { const c = await import("/src/canvas/clipboard-extra.ts"); await c.copyAsCode("react"); });
  assert((await check(() => navigator.clipboard.readText())).includes("style="));
  await check(async () => { const c = await import("/src/canvas/clipboard-extra.ts"); await c.copyAsCode("tailwind"); });
  assert((await check(() => navigator.clipboard.readText())).includes("className="));
  await check(async () => { const c = await import("/src/canvas/clipboard-extra.ts"); await c.copyAsCode("html"); });
  assert((await check(() => navigator.clipboard.readText())).includes("<div"));
  await select(ids.arrange);
  assert(await check(async () => (await import("/src/canvas/clipboard-extra.ts")).copyAsPng()));
  assert(await check(async () => (await navigator.clipboard.read())[0].types.includes("image/png")));
  await select([ids.scale]);
  await check(() => navigator.clipboard.writeText("Replacement text"));
  await page.keyboard.press("Meta+Shift+r");
  await until(async (id) => !(await import("/src/state/workspace.ts")).getActiveFile().store.doc.nodes[id], ids.scale);
  // Alt-drag and repeat duplicate compound the last rotation.
  await select([ids.rotated]);
  await page.keyboard.press("v");
  const db = await page.locator(`[data-of-world] [data-of-id="${ids.rotated}"]`).first().boundingBox();
  await page.keyboard.down("Alt"); await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2); await page.mouse.down();
  await page.mouse.move(db.x + db.width / 2 + 35, db.y + db.height / 2 + 20, { steps: 6 }); await page.mouse.up(); await page.keyboard.up("Alt");
  const firstCopy = await check(async () => (await import("/src/state/workspace.ts")).getActiveFile().selection[0]);
  assert.notEqual(firstCopy, ids.rotated);
  await check(async (id) => { const w = await import("/src/state/workspace.ts"); w.getActiveFile().store.transact("Turn copy", (tx) => tx.setStyles(id, { rotate: "90deg" })); }, firstCopy);
  await page.keyboard.press("Meta+d");
  const nextCopy = await check(async () => (await import("/src/state/workspace.ts")).getActiveFile().selection[0]);
  assert.notEqual(nextCopy, firstCopy);
  // Layers-under-cursor and distance labels.
  await select([ids.child]);
  const childBox = await page.locator(`[data-of-world] [data-of-id="${ids.child}"]`).first().boundingBox();
  await page.keyboard.down("Meta"); await page.mouse.click(childBox.x + childBox.width / 2, childBox.y + childBox.height / 2, { button: "right" }); await page.keyboard.up("Meta");
  await page.getByText("Layers under cursor", { exact: true }).waitFor(); await page.keyboard.press("Escape");
  await page.keyboard.down("Alt"); await frames();
  assert(await page.locator("[data-of-measure]").count() > 0); await page.keyboard.up("Alt");
  // Wheel modes, invert zoom, Shift horizontal scroll and area zoom.
  await select([]);
  await page.mouse.move(cb.x + cb.width / 2, cb.y + 300);
  const wheel = async () => { await page.mouse.wheel(0, 80); await frames(); return check(async () => (await import("/src/canvas/registry.ts")).getViewportLive()); };
  await check(async () => (await import("/src/state/prefs.ts")).setPrefs({ scrollZoom: true, invertZoom: false }));
  const wheelBefore = await check(async () => (await import("/src/canvas/registry.ts")).getViewportLive());
  const wheelAfter = await wheel(); assert(wheelAfter.zoom < wheelBefore.zoom);
  await check(async () => (await import("/src/state/prefs.ts")).setPrefs({ invertZoom: true }));
  assert((await wheel()).zoom > wheelAfter.zoom);
  await check(async () => (await import("/src/state/prefs.ts")).setPrefs({ scrollZoom: false, invertZoom: false }));
  const shiftBefore = await check(async () => (await import("/src/canvas/registry.ts")).getViewportLive());
  await page.keyboard.down("Shift"); const shiftAfter = await wheel(); await page.keyboard.up("Shift");
  assert(shiftAfter.x < shiftBefore.x); assert.equal(shiftAfter.y, shiftBefore.y);
  await page.keyboard.press("z"); await page.mouse.move(cb.x + 150, cb.y + 150); await page.mouse.down(); await page.mouse.move(cb.x + 500, cb.y + 450, { steps: 8 }); await page.mouse.up();
  assert((await check(async () => (await import("/src/canvas/registry.ts")).getViewportLive().zoom)) > shiftAfter.zoom);
  await page.keyboard.press("v");
  await select([ids.grid]);
  // Every editor surface in both palettes.
  for (const theme of ["light", "dark"]) {
    await check(async (theme) => (await import("/src/state/prefs.ts")).setPrefs({ theme }), theme);
    for (const tab of ["code", "agent"]) {
      await check(async (tab) => (await import("/src/state/workspace.ts")).setRightTab(tab), tab);
      await frames(); await page.screenshot({ path: `${out}/${tab}-${theme}.png` });
    }
    for (const tab of ["theme", "assets"]) {
      await check(async (tab) => (await import("/src/state/workspace.ts")).setLeftTab(tab), tab);
      await frames(); await page.screenshot({ path: `${out}/${tab}-${theme}.png` });
    }
    await select(ids.arrange);
    await check(async () => (await import("/src/panels/shared.ts")).openCommandPalette());
    await page.getByPlaceholder("Search actions, layers, pages and files").fill("Distribute horizontally");
    await page.screenshot({ path: `${out}/palette-${theme}.png` }); await page.keyboard.press("Escape");
    await check(async () => { const w = await import("/src/state/workspace.ts"); w.setRightTab("design"); w.setLeftTab("layers"); });
    await select([ids.rotated]);
    await page.getByRole("button", { name: "Edit colour", exact: true }).first().click();
    await frames(); await page.screenshot({ path: `${out}/colour-${theme}.png` }); await page.keyboard.press("Escape");
    await check(async () => (await import("/src/state/workspace.ts")).goHome());
    await frames(); await page.screenshot({ path: `${out}/home-${theme}.png` });
    await check(async (fileId) => (await import("/src/state/workspace.ts")).openFile(fileId), file.id);
  }
  await check(async () => { const w = await import("/src/state/workspace.ts"); w.setLeftTab("layers"); w.setRightTab("design"); });
  // Paste between files preserves constraints and referenced local image assets.
  const transfer = await check(async () => {
    const w = await import("/src/state/workspace.ts"), api = (await import("/src/state/api.ts")).api;
    const f = w.getActiveFile(), root = f.store.doc.pages[f.activePageId].rootId;
    const png = document.createElement("canvas"); png.width = png.height = 4;
    const ctx = png.getContext("2d"); ctx.fillStyle = "#e27b40"; ctx.fillRect(0, 0, 4, 4);
    const meta = await api.uploadAsset(f.id, await new Promise((r) => png.toBlob(r)));
    const [id] = f.store.transact("Image", (tx) => { tx.addAsset(meta); return tx.insertTrees(root, [{ type: "Frame", name: "Transfer", styles: { width: 200, height: 100 }, children: [{ type: "Image", src: `asset://${meta.hash}`, constraints: { horizontal: "right", vertical: "top" }, styles: { position: "absolute", left: 10, top: 10, width: 40, height: 40 } }] }]); });
    w.setSelection(f.id, [id]);
    return { hash: meta.hash, html: (await import("/src/canvas/clipboard.ts")).selectionToClipboard().html };
  });
  const dest = await fetch("http://127.0.0.1:29904/api/files", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Clipboard destination" }) }).then((r) => r.json());
  await check(async ({ fileId, html }) => { const w = await import("/src/state/workspace.ts"); await w.openFile(fileId); (await import("/src/canvas/clipboard.ts")).pasteHtml(html); }, { fileId: dest.id, html: transfer.html });
  await until(async (hash) => { const w = await import("/src/state/workspace.ts"); const f = w.getActiveFile(); return f.selection.length && !!f.store.doc.assets[hash]; }, transfer.hash);
  const transferState = await check(async () => { const f = (await import("/src/state/workspace.ts")).getActiveFile(); return { id: f.id, nodes: f.store.doc.nodes }; });
  assert(Object.values(transferState.nodes).some((n) => n.constraints?.horizontal === "right"), JSON.stringify({ transferState, copied: transfer.html.slice(0, 1800) }));
  await check(async (fileId) => (await import("/src/state/workspace.ts")).openFile(fileId), file.id);
  await check(async () => (await import("/src/state/prefs.ts")).setPrefs({ theme: "system", reduceAgentMotion: false }));
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" }); await frames();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.equal(await page.locator("html").getAttribute("data-agent-motion"), "reduced");
  // LOD capture: release selection and agent pins, then zoom out on a fresh page.
  await page.reload({ waitUntil: "networkidle" });
  await check(async () => { const r = await import("/src/canvas/registry.ts"); r.setViewportLive({ x: 40, y: 70, zoom: 0.08 }); });
  await page.waitForSelector('[data-of-virtual="thumb"] img', { timeout: 20000 });
  await page.screenshot({ path: `${out}/lod.png` });
  assert.equal(errors.length, 0, errors.join("\n"));
  await writeFile(`${out}/results.json`, JSON.stringify({ fileId: file.id, checks: "clipboard formats and multi-selection PNG, paste to replace, image transfer between files, Alt duplicate, repeat rotation, layers under cursor, measurements, wheel settings, area zoom, all editor surfaces in both themes, system preferences, grid, constraints through MCP, rotate with Shift, rotated hit testing, arrange, group resize, scale styles, sibling navigation, arrow pan, zoom clicks, sidebar resize, both themes, settings, responsive preview, virtual MCP reads, LOD", errors }, null, 2));
  console.log(`Canvas live checks passed. Screenshots: ${out}`);
} finally { await browser.close(); }
