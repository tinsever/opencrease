// Fill layers: parsed from background / backgroundColor / backgroundImage (+ per-layer size, position,
// repeat and blend lists) and the node's paint (shader fill, hidden layers), and written back.
import { formatColor, parseColor, splitCommas, splitSpaces } from "@opencrease/css";
import type { HiddenFill, NodePaint, ShaderSpec, StyleMap, StyleValue } from "@opencrease/model";
import { converter, formatRgb, type Color } from "culori";
import { gradientToCss, isColorValue, parseGradient, type Gradient, type GradientStop } from "./gradient";

export { isColorValue, parseGradient, type GradientStop };

/** Per-layer background properties (image and gradient layers). */
export interface LayerBox {
  size?: string;
  position?: string;
  repeat?: string;
  blend?: string;
}

export type FillLayer = (
  | { kind: "solid"; color: string }
  | Gradient
  | { kind: "image"; url: string; raw: string }
  | { kind: "other"; raw: string }
  | { kind: "shader"; spec: ShaderSpec }
) &
  LayerBox & { hidden?: boolean };

export type GradientLayer = Extract<FillLayer, { kind: "linear" | "radial" | "conic" }>;

export function isGradientLayer(l: FillLayer): l is GradientLayer {
  return l.kind === "linear" || l.kind === "radial" || l.kind === "conic";
}

const str = (v: StyleValue | undefined) => (v === undefined || v === null ? "" : String(v)).trim();

function classify(part: string): FillLayer {
  const t = part.trim();
  if (isColorValue(t)) return { kind: "solid", color: t };
  const g = parseGradient(t);
  if (g) {
    // linear-gradient(c, c) is how a solid layer above the bottom one is written
    if (g.kind === "linear" && !g.repeating && g.stops.length === 2 && g.stops[0].color === g.stops[1].color && g.stops.every((s) => s.position === undefined) && !g.interpolation) {
      return { kind: "solid", color: g.stops[0].color };
    }
    return g;
  }
  const url = /^url\(\s*(['"]?)(.*?)\1\s*\)$/.exec(t);
  if (url) return { kind: "image", url: url[2], raw: t };
  return { kind: "other", raw: t };
}

const REPEAT = /^(repeat|repeat-x|repeat-y|no-repeat|space|round)$/;
const BOX = /^(border-box|padding-box|content-box|text)$/;
const ATTACH = /^(scroll|fixed|local)$/;

/** One layer of the `background` shorthand: image, colour (last layer only), position / size, repeat. */
function parseShorthandLayer(part: string): { image?: string; color?: string; box: LayerBox } {
  const tokens = splitSpaces(part);
  const out: { image?: string; color?: string; box: LayerBox } = { box: {} };
  const pos: string[] = [];
  const size: string[] = [];
  const repeat: string[] = [];
  let inSize = false;
  for (const t of tokens) {
    if (t === "/") {
      inSize = true;
      continue;
    }
    if (/^(-?[\w-]*gradient|url|image-set)\(/i.test(t) || t === "none") out.image = t === "none" ? undefined : t;
    else if (REPEAT.test(t)) repeat.push(t);
    else if (BOX.test(t) || ATTACH.test(t)) continue;
    else if (isColorValue(t)) out.color = t;
    else if (t.includes("/")) {
      const [a, b] = t.split("/");
      if (a) pos.push(a);
      if (b) size.push(b);
      inSize = true;
    } else (inSize ? size : pos).push(t);
  }
  if (pos.length) out.box.position = pos.join(" ");
  if (size.length) out.box.size = size.join(" ");
  if (repeat.length) out.box.repeat = repeat.join(" ");
  return out;
}

function listAt(value: string, i: number): string | undefined {
  if (!value) return undefined;
  const parts = splitCommas(value);
  return parts.length ? parts[i % parts.length].trim() : undefined;
}

const DEFAULTS: Required<LayerBox> = { size: "auto", position: "0% 0%", repeat: "repeat", blend: "normal" };

function cleanBox(box: LayerBox): LayerBox {
  const out: LayerBox = {};
  for (const k of ["size", "position", "repeat", "blend"] as const) {
    const v = box[k]?.trim();
    if (v && v !== DEFAULTS[k] && !(k === "size" && v === "auto auto") && !(k === "position" && (v === "0 0" || v === "left top" || v === "0% 0%"))) out[k] = v;
  }
  return out;
}

/**
 * Fill layers, top-most first (CSS order). `paint` adds the shader fill (always on top) and hidden
 * layers at their stored positions.
 */
export function parseFills(styles: StyleMap, paint?: NodePaint): FillLayer[] {
  let images: FillLayer[] = [];
  let bottom: FillLayer | undefined;
  const bg = str(styles.background);
  if (bg && bg !== "none") {
    const parts = splitCommas(bg);
    parts.forEach((p, i) => {
      const sh = parseShorthandLayer(p);
      if (sh.image) images.push({ ...classify(sh.image), ...cleanBox(sh.box) });
      if (i === parts.length - 1 && sh.color) bottom = { kind: "solid", color: sh.color };
    });
  }
  const image = str(styles.backgroundImage);
  if (image) images = image === "none" ? [] : splitCommas(image).map(classify);
  const color = str(styles.backgroundColor);
  if (color) bottom = color === "transparent" ? undefined : { kind: "solid", color };

  // per-layer longhands
  const size = str(styles.backgroundSize);
  const position = str(styles.backgroundPosition);
  const repeat = str(styles.backgroundRepeat);
  const blend = str(styles.backgroundBlendMode);
  images = images.map((l, i) => {
    const box: LayerBox = { size: l.size, position: l.position, repeat: l.repeat, blend: l.blend };
    if (size) box.size = listAt(size, i);
    if (position) box.position = listAt(position, i);
    if (repeat) box.repeat = listAt(repeat, i);
    if (blend) box.blend = listAt(blend, i);
    const { size: _s, position: _p, repeat: _r, blend: _b, ...rest } = l;
    return { ...rest, ...cleanBox(box) } as FillLayer;
  });

  const layers: FillLayer[] = [...images];
  if (bottom) layers.push(bottom);
  for (const h of [...(paint?.hiddenFills ?? [])].sort((a, b) => a.index - b.index)) {
    const layer = { ...classify(h.css), ...cleanBox({ size: h.size, position: h.position, repeat: h.repeat, blend: h.blend }), hidden: true } as FillLayer;
    layers.splice(Math.max(0, Math.min(layers.length, h.index)), 0, layer);
  }
  if (paint?.shader?.name) layers.unshift({ kind: "shader", spec: paint.shader, ...(paint.shaderHidden ? { hidden: true } : {}) });
  return layers;
}

/** CSS of one layer. `asImage` writes solids as `linear-gradient(c, c)` so they can sit above others. */
export function layerToCss(layer: FillLayer, asImage: boolean): string {
  switch (layer.kind) {
    case "solid":
      return asImage ? `linear-gradient(${layer.color}, ${layer.color})` : layer.color;
    case "linear":
    case "radial":
    case "conic":
      return gradientToCss(layer);
    case "image":
      return /^url\(/.test(layer.raw) ? layer.raw : `url("${layer.url}")`;
    case "other":
      return layer.raw;
    case "shader":
      return "";
  }
}

export interface FillWrite {
  styles: Record<string, string | null>;
  /** next paint, or undefined to remove it */
  paint: NodePaint | undefined;
}

const PAINT_KEYS = ["background", "backgroundColor", "backgroundImage", "backgroundSize", "backgroundPosition", "backgroundRepeat", "backgroundBlendMode"];

/**
 * Style patch writing visible layers as backgroundColor + backgroundImage (+ per-layer lists) and the
 * shorthand cleared, plus the node paint holding the shader fill and hidden layers.
 */
export function writeFills(layers: FillLayer[], paint?: NodePaint): FillWrite {
  const styles: Record<string, string | null> = Object.fromEntries(PAINT_KEYS.map((k) => [k, null]));
  const nextPaint: NodePaint = { ...(paint ?? {}) };
  delete nextPaint.shader;
  delete nextPaint.shaderHidden;
  delete nextPaint.hiddenFills;
  const hidden: HiddenFill[] = [];
  const visible: FillLayer[] = [];
  let index = 0;
  for (const l of layers) {
    if (l.kind === "shader") {
      nextPaint.shader = l.spec;
      if (l.hidden) nextPaint.shaderHidden = true;
      continue;
    }
    if (l.hidden) {
      hidden.push({ index, css: layerToCss(l, false), ...cleanBox(l) });
    } else visible.push(l);
    index++;
  }
  if (hidden.length) nextPaint.hiddenFills = hidden;
  const last = visible[visible.length - 1];
  const images = last && last.kind === "solid" ? visible.slice(0, -1) : visible;
  if (last && last.kind === "solid") styles.backgroundColor = last.color;
  if (images.length) {
    styles.backgroundImage = images.map((l) => layerToCss(l, true)).join(", ");
    for (const [prop, key] of [["backgroundSize", "size"], ["backgroundPosition", "position"], ["backgroundRepeat", "repeat"], ["backgroundBlendMode", "blend"]] as const) {
      if (images.some((l) => l[key] !== undefined)) styles[prop] = images.map((l) => l[key] ?? DEFAULTS[key]).join(", ");
    }
  }
  return { styles, paint: Object.keys(nextPaint).length ? nextPaint : undefined };
}

/** Backwards-compatible style-only writer (no shader fill, no hidden layers). */
export function fillsToStyles(layers: FillLayer[]): Record<string, string | null> {
  return writeFills(layers).styles;
}

/** Moves a layer in the stack. The shader fill stays on top. */
export function moveLayer(layers: FillLayer[], from: number, to: number): FillLayer[] {
  const next = [...layers];
  const [item] = next.splice(from, 1);
  if (!item || item.kind === "shader") return layers;
  const floor = next[0]?.kind === "shader" ? 1 : 0;
  next.splice(Math.max(floor, Math.min(next.length, to)), 0, item);
  return next;
}

// ---------------------------------------------------------------- image layer fit

export type ImageFit = "fill" | "fit" | "tile" | "crop";

export function imageFit(l: LayerBox): ImageFit {
  if (l.size === "cover") return "fill";
  if (l.size === "contain") return "fit";
  if (!l.size || l.size === "auto") return "tile";
  return "crop";
}

export function withImageFit(l: FillLayer, fit: ImageFit): FillLayer {
  const { size: _s, position: _p, repeat: _r, ...rest } = l;
  switch (fit) {
    case "fill":
      return { ...rest, size: "cover", position: "center", repeat: "no-repeat" } as FillLayer;
    case "fit":
      return { ...rest, size: "contain", position: "center", repeat: "no-repeat" } as FillLayer;
    case "tile":
      return rest as FillLayer;
    case "crop":
      return { ...rest, size: l.size && l.size !== "auto" && l.size !== "cover" && l.size !== "contain" ? l.size : "120%", position: l.position && l.position !== "center" ? l.position : "50% 50%", repeat: "no-repeat" } as FillLayer;
  }
}

// ---------------------------------------------------------------- colour alpha helpers

/** Opacity of a colour value 0..1 (color-mix percentages for var() colours). */
export function colorAlpha(color: string): number {
  const mix = /^color-mix\(\s*in\s+[\w-]+\s*,\s*(.+?)\s+(\d*\.?\d+)%\s*,\s*transparent\s*\)$/i.exec(color.trim());
  if (mix) return Number(mix[2]) / 100;
  const p = parseColor(color);
  if (!p) return 1;
  const a = p.alpha;
  return typeof a === "number" ? a : 1;
}

/** Base colour without alpha (var() unwrapped from color-mix). */
export function colorBase(color: string): string {
  const mix = /^color-mix\(\s*in\s+[\w-]+\s*,\s*(.+?)\s+(\d*\.?\d+)%\s*,\s*transparent\s*\)$/i.exec(color.trim());
  return mix ? mix[1] : color;
}

function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Same colour with a new alpha. Literal colours keep their notation family; var() uses color-mix. */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const base = colorBase(color).trim();
  if (/^var\(/.test(base) || /^color-mix\(/i.test(base)) {
    return a >= 0.999 ? base : `color-mix(in srgb, ${base} ${round(a * 100)}%, transparent)`;
  }
  const p = parseColor(base);
  if (!p) return base;
  // wide-gamut and lab-family notations keep their own syntax with a "/ alpha" part
  const fn = /^(oklch|oklab|lab|lch|color|hwb)\(\s*([^/)]*?)\s*(?:\/\s*[^)]*)?\)$/i.exec(base);
  if (fn && fn[1].toLowerCase() !== "oklch") return a >= 0.999 ? `${fn[1]}(${fn[2]})` : `${fn[1]}(${fn[2]} / ${round(a)})`;
  const rgb = toRgb(p as unknown as Color);
  const css = formatRgb({ ...rgb, alpha: a });
  const mode = /^#/.test(base) || /^[a-z]+$/i.test(base) ? "hex" : /^oklch/i.test(base) ? "oklch" : /^hsl/i.test(base) ? "hsl" : "rgb";
  if (mode === "oklch") {
    const o = parseColor(base) as unknown as { l: number; c: number; h?: number };
    const n = (v: number, d: number) => String(Number(v.toFixed(d)));
    return a >= 0.999 ? `oklch(${n(o.l, 3)} ${n(o.c, 3)} ${n(o.h ?? 0, 1)})` : `oklch(${n(o.l, 3)} ${n(o.c, 3)} ${n(o.h ?? 0, 1)} / ${round(a)})`;
  }
  return formatColor(css, mode);
}

const toRgb = converter("rgb");

/** Short label for a solid colour: token name, hex, or the raw value. */
export function colorLabel(color: string): string {
  const base = colorBase(color).trim();
  const v = /^var\(\s*--([\w-]+)/.exec(base);
  if (v) return v[1];
  if (/^#/.test(base)) return base.toUpperCase();
  return base;
}
