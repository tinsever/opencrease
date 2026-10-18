// One capture from start to finish: materialise pseudo-elements, measure, restore the page, inline images,
// lay out and emit OpenCrease HTML.
import { layoutSnapshot } from "../snapshot/layout";
import { countNodes, emitNode } from "../snapshot/emit";
import { snapshotStyles } from "../snapshot/styles";
import type { CapNode, CaptureOptions, OutNode, SnapshotPayload } from "../snapshot/types";
import { backdropColor, canvasColor, layerName, UI_TAG, Walker } from "./capture";
import { materializePseudos } from "./pseudo";

const MAX_INLINE_BYTES = 60 * 1024 * 1024;

function frameAround(child: CapNode, name: string): CapNode {
  return {
    kind: "frame", name, rect: { ...child.rect }, styles: {}, border: { t: 0, r: 0, b: 0, l: 0 },
    padding: { t: 0, r: 0, b: 0, l: 0 }, flow: "in", children: [child], paintless: true,
  };
}

function colorStyle(color: string): string {
  return String(snapshotStyles((p) => (p === "background-color" ? color : ""), { kind: "frame", keepFonts: false }).backgroundColor ?? color);
}

/** Measures the page. Synchronous so the page cannot change while pseudo-elements are materialised. */
export function measure(opts: CaptureOptions, target?: Element): { root: CapNode; name: string; walker: Walker } {
  const walker = new Walker(opts);
  const scope = opts.mode === "element" && target ? target : document.documentElement;
  const restore = materializePseudos(scope, (el) => el.tagName.toLowerCase() === UI_TAG);
  try {
    if (opts.mode === "element" && target) {
      let root = walker.node(target, "in");
      if (!root) throw new Error("The selected element renders nothing.");
      if (root.kind !== "frame") root = frameAround(root, layerName(target) ?? "Snapshot");
      if (!root.styles.backgroundColor && !root.styles.backgroundImage) {
        root.styles.backgroundColor = colorStyle(backdropColor(target.parentElement));
      }
      root.flow = "in";
      return { root, name: layerName(target) ?? "Snapshot", walker };
    }

    const body = document.body;
    if (!body) throw new Error("This page has no body to capture.");
    const doc = document.documentElement;
    const viewport = opts.mode === "viewport";
    const width = viewport ? doc.clientWidth : Math.max(doc.scrollWidth, body.scrollWidth, doc.clientWidth);
    const height = viewport ? doc.clientHeight : Math.max(doc.scrollHeight, body.scrollHeight, doc.clientHeight);
    const rect = viewport ? { x: window.scrollX, y: window.scrollY, w: width, h: height } : { x: 0, y: 0, w: width, h: height };
    if (viewport) walker.clip = rect;
    const bodyNode = walker.node(body, "in");
    const canvas = colorStyle(canvasColor());
    if (bodyNode && bodyNode.styles.backgroundColor && bodyNode.styles.backgroundColor === canvas) {
      // body's background is propagated to the canvas; the body box itself is not painted
      delete bodyNode.styles.backgroundColor;
      bodyNode.paintless = !bodyNode.styles.backgroundImage;
    }
    const root: CapNode = {
      kind: "frame", rect, styles: { backgroundColor: canvas, overflow: "hidden" }, border: { t: 0, r: 0, b: 0, l: 0 },
      padding: { t: 0, r: 0, b: 0, l: 0 }, flow: "in", children: bodyNode ? [bodyNode] : [], paintless: false,
    };
    if (height > 30000) walker.warn("This page is very tall; the snapshot may be slow to edit.");
    const title = document.title.trim() || location.hostname || "Snapshot";
    return { root, name: viewport ? title : `${title} (full page)`, walker };
  } finally {
    restore();
  }
}

function collectUrls(n: CapNode, out: Set<string>): void {
  if (n.src && !n.src.startsWith("data:")) out.add(n.src);
  for (const v of [n.styles.backgroundImage, n.styles.maskImage]) {
    if (typeof v !== "string") continue;
    for (const m of v.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/g)) if (!m[2].startsWith("data:")) out.add(m[2]);
  }
  for (const c of n.children) collectUrls(c, out);
}

function replaceUrls(n: CapNode, map: Map<string, string>): void {
  if (n.src && map.has(n.src)) n.src = map.get(n.src);
  for (const key of ["backgroundImage", "maskImage"]) {
    const v = n.styles[key];
    if (typeof v !== "string") continue;
    n.styles[key] = v.replace(/url\(\s*(["']?)(.*?)\1\s*\)/g, (all, _q: string, url: string) => (map.has(url) ? `url("${map.get(url)}")` : all));
  }
  for (const c of n.children) replaceUrls(c, map);
}

export type ImageFetcher = (urls: string[]) => Promise<Record<string, string | null>>;

/** Replaces image URLs with data URLs (fetched by the background script, which is not bound by CORS). */
export async function inlineImages(root: CapNode, fetchImages: ImageFetcher, warn: (m: string) => void): Promise<number> {
  const urls = new Set<string>();
  collectUrls(root, urls);
  if (!urls.size) return 0;
  const result = await fetchImages([...urls]);
  const map = new Map<string, string>();
  let bytes = 0;
  let failed = 0;
  for (const url of urls) {
    const data = result[url];
    if (!data) {
      failed++;
      continue;
    }
    bytes += data.length;
    if (bytes > MAX_INLINE_BYTES) {
      warn("The page has more image data than a snapshot can carry; some images keep their web address.");
      break;
    }
    map.set(url, data);
  }
  if (failed) warn(`${failed} image${failed === 1 ? "" : "s"} could not be downloaded and keep${failed === 1 ? "s" : ""} the web address.`);
  replaceUrls(root, map);
  return map.size;
}

/** Full pipeline. */
export async function snapshot(opts: CaptureOptions, fetchImages: ImageFetcher, target?: Element): Promise<SnapshotPayload> {
  const { root, name, walker } = measure(opts, target);
  const width = Math.round(root.rect.w);
  const height = Math.round(root.rect.h);
  const images = await inlineImages(root, fetchImages, (m) => walker.warn(m));
  const { node, stats } = layoutSnapshot(root);
  const artboard: OutNode = { ...node, name };
  const html = emitNode(artboard);
  return {
    html,
    name,
    url: location.href,
    width,
    height,
    fonts: walker.fontList(),
    warnings: [...walker.warnings],
    stats: { nodes: countNodes(artboard), images, absolute: stats.absolute },
  };
}
