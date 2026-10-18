// Run against the track's own server/Vite. Chromium is always headless. No user session is touched.
// node scripts/perf-canvas.mjs [editor URL] [file ID] [output folder]
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const url = process.argv[2] ?? "http://localhost:5204";
const fileId = process.argv[3] ?? "01PERFCANVAS000000000000000";
const out = resolve(process.argv[4] ?? "/tmp/of-track4/perf");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-precise-memory-info"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const started = performance.now();
  await page.goto(`${url}/file/${fileId}`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-of-world] > [data-of-id]");
  const loadMs = performance.now() - started;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const stats = await page.evaluate(async () => {
    const registry = await import("/src/canvas/registry.ts");
    const virtual = await import("/src/canvas/virtual.ts");
    const lod = await import("/src/canvas/lod.ts");
    const panels = await import("/src/panels/shared.ts");
    const workspace = await import("/src/state/workspace.ts");
    const prefs = await import("/src/state/prefs.ts");
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const file = workspace.getActiveFile();
    const sample = async (baseline) => {
      virtual.setVirtualisation(!baseline);
      registry.setViewportLive({ x: 24, y: 40, zoom: 0.6 });
      const settleBy = performance.now() + 15000;
      while (baseline && document.querySelectorAll("[data-of-world] [data-of-id]").length !== Object.keys(file.store.doc.nodes).length - 1 && performance.now() < settleBy) await frame();
      for (let i = 0; i < 12; i++) await frame();
      const times = [];
      let before = performance.now();
      for (let i = 0; i < 180; i++) {
        registry.setViewportLive({ x: 24 - i * 4, y: 40 - i * 0.6, zoom: 0.6 + Math.sin(i / 30) * 0.08 });
        await frame();
        const now = performance.now(); times.push(now - before); before = now;
      }
      times.sort((a, b) => a - b);
      for (let i = 0; i < 12; i++) await frame();
      return { medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.floor(times.length * 0.95)], maxMs: Math.max(...times), domNodes: document.querySelectorAll("[data-of-world] [data-of-id]").length, modes: virtual.modeCounts() };
    };
    // Baseline uses the same file with viewport virtualisation disabled.
    const baseline = await sample(true);
    const optimised = await sample(false);
    panels.setExpanded(file.id, Object.keys(file.store.doc.nodes), true);
    await frame(); await frame();
    const visibleLayerRows = document.querySelectorAll("[data-layer-id]").length;
    panels.setExpanded(file.id, Object.keys(file.store.doc.nodes), false);
    prefs.setPrefs({ theme: "light", reduceAgentMotion: true });
    registry.setViewportLive({ x: 24, y: 40, zoom: 0.6 });
    await frame(); await frame();
    return { artboards: file.store.doc.nodes[file.store.doc.pages[file.activePageId].rootId].children.length, baseline, optimised, visibleLayerRows, modelNodes: Object.keys(file.store.doc.nodes).length, measurements: registry.measurementCount(), lod: lod.lodStats(), jsHeapBytes: performance.memory?.usedJSHeapSize ?? null };
  });
  if (stats.baseline.modes.live !== stats.artboards || stats.baseline.domNodes !== stats.modelNodes - 1 || !stats.optimised.modes.placeholder || stats.optimised.domNodes >= stats.baseline.domNodes) throw new Error("Performance modules differ from the mounted editor. Restart Vite before benchmarking after source edits.");
  await page.screenshot({ path: resolve(out, "canvas-50k-light.png") });
  await page.evaluate(async () => (await import("/src/state/prefs.ts")).setPrefs({ theme: "dark" }));
  await page.screenshot({ path: resolve(out, "canvas-50k-dark.png") });
  const memory = await cdp.send("Runtime.getHeapUsage");
  const report = { date: new Date().toISOString(), browser: browser.version(), loadMs, ...stats, memory, errors };
  await writeFile(resolve(out, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
