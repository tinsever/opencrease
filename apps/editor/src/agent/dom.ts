// DOM access for the agent: finding rendered nodes, waiting for the canvas, an offscreen fallback
// renderer, and web font embedding for screenshots.
import { nodeToHtml } from "@opencrease/css";
import { pageOfNode, tokenCssVars, type FoldDocument, type NodeId } from "@opencrease/model";
import { getMountedFileId, getNodeElement, getWorldRect } from "../canvas/registry";
import { pinTopLevel } from "../canvas/virtual";
import { api } from "../state/api";
import { getOpenFile, getState, openFile, setActivePage } from "../state/workspace";
import type { WorldRect } from "./env";

const OFFSCREEN_ATTR = "data-of-agent-offscreen";

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Two animation frames, with a timeout fallback because background tabs do not run rAF. */
export function waitFrames(n = 2): Promise<void> {
  const frames = new Promise<void>((resolve) => {
    let left = n;
    const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
  return Promise.race([frames, sleep(120)]);
}

/**
 * Wait until a change is rendered and laid out: React commits, web fonts used by the new content
 * finish loading (they change text metrics), then one more frame.
 */
export async function settleLayout(): Promise<void> {
  await waitFrames(2);
  await Promise.race([document.fonts.ready, sleep(1500)]);
  await waitFrames(1);
}

export async function waitUntil(check: () => boolean, timeoutMs: number, stepMs = 30): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(stepMs);
  }
  return check();
}

/** The canvas element of a node of the given file, null when not rendered. */
export function findNodeElement(fileId: string, id: NodeId): HTMLElement | null {
  if (getMountedFileId() !== fileId) return null;
  const el = getNodeElement(id);
  if (el) return el;
  const all = document.querySelectorAll<HTMLElement>(`[data-of-id="${CSS.escape(id)}"]`);
  for (const candidate of all) if (!candidate.closest(`[${OFFSCREEN_ATTR}], [data-of-responsive-preview], [data-of-capture-host]`)) return candidate;
  return null;
}

export function measureNode(fileId: string, id: NodeId): WorldRect | null {
  if (getMountedFileId() !== fileId) return null;
  const rect = getWorldRect(id);
  if (!rect || !Number.isFinite(rect.width)) return null;
  return rect;
}

/** Focus a file and make sure the canvas shows the page of `nodeId` (or `pageId`). */
export async function showPage(fileId: string, pageId: string | undefined): Promise<void> {
  if (getState().activeFileId !== fileId) await openFile(fileId);
  const file = getOpenFile(fileId);
  if (!file) return;
  if (pageId && file.activePageId !== pageId && file.store.doc.pages[pageId]) {
    setActivePage(fileId, pageId);
  }
  await waitUntil(() => getMountedFileId() === fileId, 3000);
  await waitFrames();
}

/** Make sure a node is rendered on the canvas; resolves to its element or null. */
export async function showNode(fileId: string, id: NodeId): Promise<HTMLElement | null> {
  const file = getOpenFile(fileId) ?? (await openFile(fileId));
  const page = pageOfNode(file.store.doc, id);
  await showPage(fileId, page?.id);
  let top = file.store.doc.nodes[id];
  while (top?.parentId && file.store.doc.nodes[top.parentId]?.type !== "Root") top = file.store.doc.nodes[top.parentId];
  if (top) pinTopLevel([top.id], 30_000);
  await waitFrames();
  await waitUntil(() => {
    const el = findNodeElement(fileId, id);
    return !!el && !el.hasAttribute("data-of-virtual");
  }, 2000);
  return findNodeElement(fileId, id);
}

// ------------------------------------------------------------------ offscreen fallback renderer

/**
 * Render a node subtree from the model into a hidden host (used when the canvas cannot show it).
 * Returns the node element and a cleanup function.
 */
export function renderOffscreen(fileId: string, doc: FoldDocument, id: NodeId): { el: HTMLElement; dispose(): void } {
  const host = document.createElement("div");
  host.setAttribute(OFFSCREEN_ATTR, "");
  Object.assign(host.style, { position: "fixed", left: "-100000px", top: "0", pointerEvents: "none", contain: "layout" });
  for (const [k, v] of Object.entries(tokenCssVars(doc))) host.style.setProperty(k, v);
  const html = nodeToHtml(doc, id, { includeNodeIds: true }).replace(/asset:\/\/([a-f0-9]{64})/g, (_m, hash: string) => api.assetUrl(fileId, hash));
  host.innerHTML = html;
  for (const el of host.querySelectorAll<HTMLElement>("[data-of-id]")) {
    const node = doc.nodes[el.getAttribute("data-of-id")!];
    if (node?.type === "Text") el.style.whiteSpace ||= "pre-wrap";
  }
  document.body.appendChild(host);
  const el = host.querySelector<HTMLElement>(`[data-of-id="${CSS.escape(id)}"]`) ?? (host.firstElementChild as HTMLElement);
  return { el, dispose: () => host.remove() };
}

/** Wait for images inside an element to load (or fail), capped. */
export async function waitForImages(el: Element, timeoutMs = 8000): Promise<void> {
  const imgs = [...(el instanceof HTMLImageElement ? [el] : []), ...el.querySelectorAll("img")];
  await Promise.race([
    Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined)))),
    sleep(timeoutMs),
  ]);
  await Promise.race([document.fonts.ready, sleep(3000)]);
}

// ------------------------------------------------------------------ fonts for screenshots

const fontDataCache = new Map<string, Promise<string | null>>();
const cssCache = new Map<string, Promise<string>>();

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function fetchFontData(url: string): Promise<string | null> {
  let p = fontDataCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? blobToDataUrl(b) : null))
      .catch(() => null);
    fontDataCache.set(url, p);
  }
  return p;
}

function fetchCss(url: string): Promise<string> {
  let p = cssCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => "");
    cssCache.set(url, p);
  }
  return p;
}

function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "").trim().toLowerCase();
}

/** Does a unicode-range descriptor cover any of the code points? */
export function rangeCovers(range: string, codePoints: Set<number>): boolean {
  if (!range.trim()) return true;
  for (const part of range.split(",")) {
    const m = /U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(part.trim());
    if (!m) continue;
    let lo: number;
    let hi: number;
    if (m[1].includes("?")) {
      lo = parseInt(m[1].replace(/\?/g, "0"), 16);
      hi = parseInt(m[1].replace(/\?/g, "f"), 16);
    } else {
      lo = parseInt(m[1], 16);
      hi = m[2] ? parseInt(m[2], 16) : lo;
    }
    for (const cp of codePoints) if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

interface FaceRule {
  family: string;
  css: string;
  range: string;
  baseUrl: string | null;
}

function collectFaceRules(rules: CSSRuleList, baseUrl: string | null, out: FaceRule[]): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSFontFaceRule) {
      out.push({ family: unquote(rule.style.getPropertyValue("font-family")), css: rule.cssText, range: rule.style.getPropertyValue("unicode-range"), baseUrl });
    } else if ("cssRules" in rule) {
      collectFaceRules((rule as CSSGroupingRule).cssRules, baseUrl, out);
    }
  }
}

function parseFaceRules(cssText: string, baseUrl: string): FaceRule[] {
  const sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(cssText);
  } catch {
    return [];
  }
  const out: FaceRule[] = [];
  collectFaceRules(sheet.cssRules, baseUrl, out);
  return out;
}

/**
 * @font-face CSS with inlined font data for the families and characters used in `root`, so the
 * screenshot renders with the real fonts (cross-origin Google Fonts stylesheets are fetched directly).
 */
export async function embeddedFontCss(root: Element): Promise<string> {
  const families = new Set<string>();
  const codePoints = new Set<number>();
  const visit = (el: Element) => {
    const cs = getComputedStyle(el);
    for (const f of cs.fontFamily.split(",")) families.add(unquote(f));
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) for (const ch of node.textContent ?? "") codePoints.add(ch.codePointAt(0)!);
    }
    for (const child of Array.from(el.children)) visit(child);
  };
  visit(root);
  if (codePoints.size === 0) codePoints.add(0x41);

  const faces: FaceRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      collectFaceRules(sheet.cssRules, sheet.href, faces);
    } catch {
      if (sheet.href) faces.push(...parseFaceRules(await fetchCss(sheet.href), sheet.href));
    }
  }
  const wanted = faces.filter((f) => families.has(f.family) && rangeCovers(f.range, codePoints));
  const parts = await Promise.all(
    wanted.map(async (f) => {
      const urls = [...f.css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);
      let css = f.css;
      for (const raw of urls) {
        if (raw.startsWith("data:")) continue;
        const abs = new URL(raw, f.baseUrl ?? location.href).href;
        const data = await fetchFontData(abs);
        if (!data) return "";
        css = css.split(raw).join(data);
      }
      return css;
    }),
  );
  return parts.filter(Boolean).join("\n");
}
