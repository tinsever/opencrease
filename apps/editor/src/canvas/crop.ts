// ⌘ + resize crops an image fill: the image keeps its size and place on the canvas while the frame's
// edges move, written as explicit backgroundSize / backgroundPosition on that fill layer.
import type { FoldDocument, OFNode } from "@opencrease/model";
import { parseFills, writeFills, type FillLayer } from "../panels/right/inspector/fills";
import { parsePosition } from "../panels/right/inspector/gradient";
import { assetHashOf } from "../panels/right/inspector/asset-ref";
import type { Rect } from "./geometry";

const natural = new Map<string, { w: number; h: number }>();

/** Natural size of an image URL: asset metadata, or the browser's decoded image (loaded on first ask). */
export function naturalSize(doc: FoldDocument, url: string): { w: number; h: number } | null {
  const hash = assetHashOf(url);
  const meta = hash ? doc.assets[hash] : undefined;
  if (meta?.width && meta.height) return { w: meta.width, h: meta.height };
  const known = natural.get(url);
  if (known) return known;
  if (typeof Image !== "undefined") {
    const img = new Image();
    img.onload = () => natural.set(url, { w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
  }
  return null;
}

function len(token: string | undefined, box: number): number | null {
  if (!token || token === "auto") return null;
  const px = /^(-?\d*\.?\d+)px$/.exec(token);
  if (px) return Number(px[1]);
  const pc = /^(-?\d*\.?\d+)%$/.exec(token);
  if (pc) return (Number(pc[1]) / 100) * box;
  return token === "0" ? 0 : null;
}

/** Rendered image rect inside a w × h box for a layer's size and position (CSS background rules). */
export function imageRect(layer: Pick<FillLayer, "size" | "position">, w: number, h: number, iw: number, ih: number): Rect {
  let dw = iw;
  let dh = ih;
  const size = (layer.size ?? "auto").trim();
  if (size === "cover" || size === "contain") {
    const s = size === "cover" ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    dw = iw * s;
    dh = ih * s;
  } else {
    const [a, b] = size.split(/\s+/);
    const sw = len(a, w);
    const sh = len(b, h);
    if (sw !== null && sh !== null) [dw, dh] = [sw, sh];
    else if (sw !== null) [dw, dh] = [sw, (sw * ih) / iw];
    else if (sh !== null) [dw, dh] = [(sh * iw) / ih, sh];
  }
  const pos = (layer.position ?? "0% 0%").trim();
  const [px, py] = pos.split(/\s+/);
  const pct = parsePosition(pos);
  const x = /px$/.test(px ?? "") ? Number.parseFloat(px) : ((pct?.x ?? 0) / 100) * (w - dw);
  const y = /px$/.test(py ?? "") ? Number.parseFloat(py) : ((pct?.y ?? 0) / 100) * (h - dh);
  return { x, y, width: dw, height: dh };
}

const r2 = (n: number) => `${Math.round(n * 100) / 100}px`;

/**
 * Style patch that keeps the top visible image fill fixed in world space while the node's box goes
 * from `start` to `next` (both world rects). Null when the node has no image fill or its size is unknown.
 */
export function cropPatch(doc: FoldDocument, node: OFNode, start: Rect, next: Rect): Record<string, string | null> | null {
  const layers = parseFills(node.styles, node.paint);
  const i = layers.findIndex((l) => l.kind === "image" && !l.hidden);
  if (i < 0) return null;
  const layer = layers[i] as Extract<FillLayer, { kind: "image" }>;
  const size = naturalSize(doc, layer.url);
  if (!size) return null;
  const img = imageRect(layer, start.width, start.height, size.w, size.h);
  const worldX = start.x + img.x;
  const worldY = start.y + img.y;
  const cropped: FillLayer = { ...layer, size: `${r2(img.width)} ${r2(img.height)}`, position: `${r2(worldX - next.x)} ${r2(worldY - next.y)}`, repeat: "no-repeat" };
  return writeFills(layers.map((l, j) => (j === i ? cropped : l)), node.paint).styles;
}
