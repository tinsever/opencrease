// Run with server 29909 and Vite 5209: node --import tsx apps/extension/test/smoke.mjs
// Chromium's new headless mode loads real extensions without showing a window.
import assert from "node:assert/strict";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { encodedFixture } from "../../editor/src/import/figma.fixture.ts";

const api = "http://127.0.0.1:29909";
const vite = "http://127.0.0.1:5209";
const out = resolve("test-results/track9");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(resolve(tmpdir(), "opencrease-snapshot-browser-"));
const extension = resolve("apps/extension/dist/chrome");
const context = await chromium.launchPersistentContext(profile, {
  headless: false, args: ["--headless=new", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1120, height: 900 },
});
const errors = [];
context.on("page", (p) => p.on("pageerror", (err) => errors.push(err.message)));
const json = async (path, body) => {
  const res = await fetch(api + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  assert(res.ok, `${path}: ${res.status} ${await (!res.ok ? res.text() : Promise.resolve(""))}`);
  return res.json();
};
const wait = async (fn, label) => {
  const end = Date.now() + 20000;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`Timed out: ${label}`);
};
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const file = await json("/api/files", { name: "Snapshot verification" });
  const editor = await context.newPage();
  await editor.goto(`${vite}/file/${file.id}`);
  await wait(async () => (await json("/api/status")).editorConnected, "editor bridge");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const assetResponse = await fetch(`${api}/api/files/${file.id}/assets`, { method: "POST", headers: { "content-type": "image/png" }, body: png });
  const asset = await assetResponse.json();
  const source = await context.newPage();
  await source.goto(`${vite}/@fs/${resolve("apps/extension/test/fixture.html")}`);
  await source.locator("#photo").evaluate((el, src) => el.src = src, `${api}/api/files/${file.id}/assets/${asset.hash}`);
  await source.evaluate(() => document.fonts.ready);
  await source.screenshot({ path: `${out}/source-viewport.png` });
  await source.locator("#capture").screenshot({ path: `${out}/source-element.png` });
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  const sourceId = tabs.find((t) => t.url?.includes("fixture.html")).id;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.evaluate(async () => {
    await chrome.storage.local.set({ settings: { port: 29909, destination: "active", keepFonts: true, colorTokens: true } });
    window.captureMessages = [];
    chrome.runtime.onMessage.addListener((msg) => window.captureMessages.push(msg));
  });
  await worker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), sourceId);
  await popup.reload();
  await popup.waitForFunction(() => document.querySelector("#conn").dataset.state === "open");
  await popup.locator(".popup").screenshot({ path: `${out}/popup.png` });
  // An ordinary extension page can send the same messages as the action popup.
  await popup.evaluate(() => { window.captureMessages = []; chrome.runtime.onMessage.addListener((msg) => window.captureMessages.push(msg)); });
  const capture = async (mode) => {
    await popup.evaluate(() => { window.captureMessages = []; });
    const res = await popup.evaluate(({ mode, tabId }) => chrome.runtime.sendMessage({ type: "capture", mode, tabId }), { mode, tabId: sourceId });
    assert(res.ok, JSON.stringify(res));
  };
  const completed = async () => {
    await popup.waitForFunction(() => window.captureMessages.some((m) => m.type === "status" && ["done", "error"].includes(m.phase)), { timeout: 20000 });
    const message = await popup.evaluate(() => window.captureMessages.find((m) => m.type === "status" && ["done", "error"].includes(m.phase)));
    assert.equal(message.phase, "done", message.text);
    return message;
  };
  const doc = () => editor.evaluate(async () => (await import("/src/state/workspace.ts")).getActiveFile().store.doc);
  await capture("element");
  await source.locator("#capture").hover({ position: { x: 4, y: 4 } });
  await source.locator("#capture").click({ position: { x: 4, y: 4 } });
  await completed();
  let document = await doc();
  const rootId = Object.values(document.pages)[0].rootId;
  const elementId = document.nodes[rootId].children.at(-1);
  const saved = await json(`/api/files/${file.id}`);
  assert(saved.nodes[elementId], "Successful delivery is persisted before responding");
  const nodes = Object.values(document.nodes);
  assert(nodes.some((n) => n.text === "Captured from an open shadow tree"));
  const gradient = nodes.find((n) => n.type === "SVGElement" && n.tag === "linearGradient");
  assert(gradient);
  assert(nodes.some((n) => n.type === "SVGElement" && n.attrs?.fill === `url(#${gradient.attrs.id})`), "SVG gradient reference is self-contained");
  assert(nodes.some((n) => n.text?.includes("New Edition 09")));
  assert(nodes.some((n) => n.type === "Image" && n.src?.startsWith("asset://")));
  await source.evaluate(() => { if (document.querySelector("of-pseudo") || document.querySelector("[data-of-pseudo-host]")) throw new Error("Pseudo materialisation leaked"); });
  const screenshot = await json("/api/tools/call", { tool: "get_screenshot", args: { fileId: file.id, nodeId: elementId, scale: 1 }, client: { name: "track9-test" } });
  const image = screenshot.content.find((c) => c.type === "image");
  assert(image, JSON.stringify(screenshot));
  await writeFile(`${out}/imported-element.png`, Buffer.from(image.data, "base64"));
  const sourceBoxes = await source.locator("#capture").evaluate((el) => {
    const root = el.getBoundingClientRect();
    return ["h1", ".cards", ".badge"].map((selector) => { const r = el.querySelector(selector).getBoundingClientRect(); return { selector, x: r.x - root.x, y: r.y - root.y, width: r.width, height: r.height }; });
  });
  await editor.evaluate(async () => { (await import("/src/canvas/view.ts")).zoomTo(1); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const importedBoxes = await editor.evaluate(async (rootId) => {
    const { getActiveFile } = await import("/src/state/workspace.ts");
    const { getWorldRect } = await import("/src/canvas/registry.ts");
    const doc = getActiveFile().store.doc;
    const root = getWorldRect(rootId);
    const below = (n) => n && (n.parentId === rootId || below(doc.nodes[n.parentId]));
    return ["h1", ".cards", ".badge"].map((selector) => {
      const n = Object.values(doc.nodes).find((n) => below(n) && (selector === "h1" ? n.text?.startsWith("Small details.") : n.name === (selector === ".cards" ? "Cards" : "Badge")));
      const r = getWorldRect(n.id);
      return { selector, x: r.x - root.x, y: r.y - root.y, width: r.width, height: r.height };
    });
  }, elementId);
  await writeFile(`${out}/boxes.json`, JSON.stringify({ source: sourceBoxes, imported: importedBoxes }, null, 2));
  for (let i = 0; i < sourceBoxes.length; i++) {
    for (const key of ["x", "y", "width", "height"]) assert(Math.abs(sourceBoxes[i][key] - importedBoxes[i][key]) < 5, `${sourceBoxes[i].selector} ${key}: ${sourceBoxes[i][key]} vs ${importedBoxes[i][key]}`);
  }
  await capture("viewport"); await completed();
  await capture("page"); await completed();
  document = await doc();
  assert.equal(document.nodes[rootId].children.length, 3);
  const boards = document.nodes[rootId].children.map((id) => document.nodes[id]);
  assert.equal(parseFloat(boards[1].styles.height), 900);
  assert(parseFloat(boards[2].styles.height) > 900);
  // Figma is detected ahead of ordinary HTML or a bitmap clipboard fallback.
  const figmaHtml = encodedFixture();
  await editor.evaluate((html) => {
    const data = new DataTransfer(); data.setData("text/html", html); data.setData("text/plain", "Figma clipboard fallback");
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, figmaHtml);
  await editor.waitForFunction(async () => Object.values((await import("/src/state/workspace.ts")).getActiveFile().store.doc.nodes).some((n) => n.name === "Figma card"));
  await editor.screenshot({ path: `${out}/editor-figma.png` });
  // Clipboard delivery from the real content script, then the editor's normal paste handler.
  await popup.evaluate(async () => { await chrome.storage.local.set({ settings: { port: 29909, destination: "clipboard", keepFonts: true, colorTokens: false } }); });
  await source.bringToFront();
  await capture("viewport"); await completed();
  const copyButton = source.getByRole("button", { name: "Copy to clipboard" });
  if (await copyButton.count()) await copyButton.click();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: vite });
  await editor.bringToFront();
  const clipHtml = await editor.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((i) => i.types.includes("text/html"));
    return item ? (await item.getType("text/html")).text() : "";
  });
  assert(clipHtml.includes('data-opencrease="snapshot"'), "Clipboard contains Snapshot HTML");
  await editor.evaluate((html) => { const data = new DataTransfer(); data.setData("text/html", html); document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); }, clipHtml);
  // Public page smoke check using the same loaded extension.
  let external = "not checked";
  try {
    await source.goto("https://example.com", { timeout: 15000 });
    await source.screenshot({ path: `${out}/source-example.png` });
  } catch (err) { external = `unavailable: ${err.message}`; }
  if (external === "not checked") {
    await popup.evaluate(async () => { await chrome.storage.local.set({ settings: { port: 29909, destination: "active", keepFonts: true, colorTokens: false } }); });
    await capture("viewport"); await completed();
    const imported = await doc();
    const externalId = imported.nodes[rootId].children.at(-1);
    const expectedText = (await source.locator("p").first().innerText()).replace(/\s+/g, " ").trim();
    assert(Object.values(imported.nodes).some((n) => n.text?.replace(/\s+/g, " ").trim() === expectedText), "Public page text becomes editable layers");
    const shot = await json("/api/tools/call", { tool: "get_screenshot", args: { fileId: file.id, nodeId: externalId, scale: 1 }, client: { name: "track9-test" } });
    const externalImage = shot.content.find((c) => c.type === "image");
    assert(externalImage);
    await writeFile(`${out}/imported-example.png`, Buffer.from(externalImage.data, "base64"));
    external = "captured example.com";
  }
  // Creating a new destination file opens it in the existing editor tab.
  await popup.evaluate(async () => { await chrome.storage.local.set({ settings: { port: 29909, destination: "new", keepFonts: true, colorTokens: false } }); });
  await capture("viewport"); await completed();
  const newDocument = await doc();
  assert.notEqual(newDocument.id, file.id);
  const newRoot = Object.values(newDocument.pages)[0].rootId;
  assert.equal(newDocument.nodes[newRoot].children.length, 1);
  assert.deepEqual(errors, [], "No page exceptions");
  await writeFile(`${out}/summary.json`, JSON.stringify({ fileId: file.id, elementId, layers: nodes.length, external, errors }, null, 2));
  console.log(JSON.stringify({ fileId: file.id, elementId, layers: nodes.length, external, screenshots: out }));
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
