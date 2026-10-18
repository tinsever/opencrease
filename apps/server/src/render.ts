// Headless Chromium (Playwright) for the server: prints vector PDFs for the editor and runs the
// editor itself in headless mode (see headless.ts). Chromium is optional: without it the editor falls
// back to raster PDFs and the headless commands explain how to install it.
import type { Browser } from "playwright";

export class ChromiumUnavailable extends Error {
  constructor(detail: string) {
    super(`Headless Chromium is not available (${detail}). Install it with "npx playwright install chromium-headless-shell".`);
    this.name = "ChromiumUnavailable";
  }
}

/** Flags that give headless Chromium WebGL (for shaders) without a GPU. */
export const CHROMIUM_ARGS = ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];

let shared: Browser | null = null;
let launching: Promise<Browser> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let owned = false;

export async function launchChromium(): Promise<Browser> {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch (err) {
    throw new ChromiumUnavailable(`the playwright package could not be loaded: ${(err as Error).message}`);
  }
  try {
    return await playwright.chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  } catch (err) {
    const first = String((err as Error).message ?? err).split("\n")[0];
    throw new ChromiumUnavailable(first);
  }
}

/** Use an already running browser (the headless editor's) instead of launching a second one. */
export function shareBrowser(browser: Browser): void {
  shared = browser;
  owned = false;
}

async function browser(): Promise<Browser> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (shared?.isConnected()) return shared;
  launching ??= launchChromium()
    .then((b) => {
      shared = b;
      owned = true;
      return b;
    })
    .finally(() => {
      launching = null;
    });
  return launching;
}

function releaseLater(): void {
  if (!owned) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeRenderer(), 60_000);
  idleTimer.unref();
}

export async function closeRenderer(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const b = shared;
  const wasOwned = owned;
  shared = null;
  owned = false;
  if (b && wasOwned) await b.close().catch(() => {});
}

export interface PdfPageInput {
  html: string;
  width: number;
  height: number;
}

const MAX_PAGE_SIDE = 20_000;

export function validatePages(input: unknown): PdfPageInput[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("pages must be a non-empty array");
  if (input.length > 500) throw new Error("At most 500 pages per PDF");
  return input.map((p, i) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const width = Number(o.width);
    const height = Number(o.height);
    if (typeof o.html !== "string" || !o.html) throw new Error(`pages[${i}].html is required`);
    if (!(width >= 1 && width <= MAX_PAGE_SIDE && height >= 1 && height <= MAX_PAGE_SIDE)) throw new Error(`pages[${i}] needs a width and height between 1 and ${MAX_PAGE_SIDE}`);
    return { html: o.html, width: Math.round(width), height: Math.round(height) };
  });
}

/**
 * Print standalone HTML pages to one PDF. Text stays vector with embedded font subsets. Each page is
 * printed on its own (pages can differ in size) and merged with pdf-lib.
 */
export async function renderPdf(pages: PdfPageInput[], opts: { title?: string } = {}): Promise<Buffer> {
  const b = await browser();
  const maxW = Math.max(...pages.map((p) => p.width));
  const maxH = Math.max(...pages.map((p) => p.height));
  // Static snapshots never execute scripts. CDP evaluation can still wait for fonts.
  const context = await b.newContext({ javaScriptEnabled: false, viewport: { width: Math.min(maxW, 4000), height: Math.min(maxH, 4000) } });
  try {
    await context.route("**/*", (route) => {
      const u = new URL(route.request().url());
      const allowed = u.protocol === "data:" || (u.protocol === "https:" && ["fonts.googleapis.com", "fonts.gstatic.com", "images.unsplash.com", "plus.unsplash.com", "images.pexels.com", "images.pixabay.com", "cdn.pixabay.com"].includes(u.hostname));
      return allowed ? route.continue() : route.abort();
    });
    const { PDFDocument } = await import("pdf-lib");
    const out = await PDFDocument.create();
    for (const p of pages) {
      const page = await context.newPage();
      await page.setContent(p.html, { waitUntil: "load", timeout: 60_000 });
      await page.evaluate("document.fonts.ready.then(() => undefined)");
      const pdf = await page.pdf({ width: `${p.width}px`, height: `${p.height}px`, printBackground: true, pageRanges: "1" });
      await page.close();
      const src = await PDFDocument.load(pdf);
      const [copied] = await out.copyPages(src, [0]);
      out.addPage(copied);
    }
    if (opts.title) out.setTitle(opts.title);
    out.setCreator("OpenCrease");
    out.setProducer("OpenCrease (Chromium)");
    return Buffer.from(await out.save());
  } finally {
    await context.close().catch(() => {});
    releaseLater();
  }
}
