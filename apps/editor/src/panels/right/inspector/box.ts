// Four-sided values (padding, border width) and corner radii from shorthand + longhands.
import { splitSpaces } from "@opencrease/css";
import type { StyleMap, StyleValue } from "@opencrease/model";

export type Sides<T> = [T, T, T, T]; // top, right, bottom, left
export const SIDE_NAMES = ["Top", "Right", "Bottom", "Left"] as const;
export const CORNER_NAMES = ["TopLeft", "TopRight", "BottomRight", "BottomLeft"] as const;

function expand(value: StyleValue | undefined): Sides<StyleValue | undefined> {
  if (value === undefined || value === "") return [undefined, undefined, undefined, undefined];
  if (typeof value === "number") return [value, value, value, value];
  const p = splitSpaces(value);
  const [a, b = a, c = a, d = b] = p;
  return [a, b, c, d];
}

/** padding (or margin-like) sides with shorthand, Inline/Block and per-side longhands applied in order. */
export function readSides(styles: StyleMap, prop: "padding"): Sides<StyleValue | undefined> {
  const out = expand(styles[prop]);
  const inline = styles[`${prop}Inline`];
  if (inline !== undefined) {
    const [l, r = l] = typeof inline === "number" ? [inline] : splitSpaces(String(inline));
    out[3] = l;
    out[1] = r;
  }
  const block = styles[`${prop}Block`];
  if (block !== undefined) {
    const [t, b = t] = typeof block === "number" ? [block] : splitSpaces(String(block));
    out[0] = t;
    out[2] = b;
  }
  SIDE_NAMES.forEach((s, i) => {
    const v = styles[`${prop}${s}`];
    if (v !== undefined) out[i] = v;
  });
  return out;
}

/** Patch writing all four sides as longhands and clearing the shorthands. */
export function writeSides(prop: "padding", sides: Sides<StyleValue | null | undefined>): Record<string, StyleValue | null> {
  const patch: Record<string, StyleValue | null> = { [prop]: null, [`${prop}Inline`]: null, [`${prop}Block`]: null };
  SIDE_NAMES.forEach((s, i) => {
    const v = sides[i];
    patch[`${prop}${s}`] = v === undefined || v === "" || v === 0 ? null : v;
  });
  return patch;
}

export function readCorners(styles: StyleMap): Sides<StyleValue | undefined> {
  const r = styles.borderRadius;
  let out: Sides<StyleValue | undefined> = [undefined, undefined, undefined, undefined];
  if (r !== undefined && r !== "") {
    if (typeof r === "number") out = [r, r, r, r];
    else {
      const first = String(r).split("/")[0].trim();
      const p = splitSpaces(first);
      const [a, b = a, c = a, d = b] = p;
      out = [a, b, c, d];
    }
  }
  CORNER_NAMES.forEach((c, i) => {
    const v = styles[`border${c}Radius`];
    if (v !== undefined) out[i] = v;
  });
  return out;
}

/** Writes radius: one value → borderRadius only; different corners → longhands. */
export function writeCorners(corners: Sides<StyleValue | null | undefined>): Record<string, StyleValue | null> {
  const patch: Record<string, StyleValue | null> = {};
  for (const c of CORNER_NAMES) patch[`border${c}Radius`] = null;
  const allSame = corners.every((v) => String(v ?? "") === String(corners[0] ?? ""));
  if (allSame) {
    const v = corners[0];
    patch.borderRadius = v === undefined || v === null || v === "" || v === 0 ? null : v;
  } else {
    patch.borderRadius = null;
    CORNER_NAMES.forEach((c, i) => {
      const v = corners[i];
      patch[`border${c}Radius`] = v === undefined || v === null || v === "" || v === 0 ? null : v;
    });
  }
  return patch;
}

export interface BorderValue {
  /** uniform width (the top width when sides differ) */
  width?: StyleValue;
  style?: string;
  color?: string;
  /** per-side widths: top, right, bottom, left */
  widths?: Sides<StyleValue | undefined>;
}

const BORDER_STYLE = /^(solid|dashed|dotted|double|groove|ridge|inset|outset|none|hidden)$/;
const WIDTH_KEYWORD = /^(thin|medium|thick)$/;

/** `1px solid #000` → parts. Unknown tokens are taken as the colour. */
export function parseBorderShorthand(value: StyleValue | undefined): BorderValue {
  const out: BorderValue = {};
  if (value === undefined || value === "") return out;
  if (typeof value === "number") return { width: value };
  if (value === "none" || value === "0") return { style: "none" };
  for (const t of splitSpaces(String(value))) {
    if (/^-?\d*\.?\d+(px)?$/.test(t)) out.width = Number.parseFloat(t);
    else if (/^-?\d*\.?\d+[a-z%]+$/.test(t) || WIDTH_KEYWORD.test(t)) out.width = t;
    else if (BORDER_STYLE.test(t)) out.style = t;
    else out.color = out.color ? `${out.color} ${t}` : t;
  }
  return out;
}

/** Border from the shorthands and longhands, with per-side widths. */
export function readBorder(styles: StyleMap): BorderValue {
  const base = parseBorderShorthand(styles.border);
  const widths: Sides<StyleValue | undefined> = [base.width, base.width, base.width, base.width];
  let style = base.style;
  let color = base.color;
  if (styles.borderWidth !== undefined) {
    const e = expand(styles.borderWidth);
    for (let i = 0; i < 4; i++) widths[i] = typeof e[i] === "string" && /^\d*\.?\d+px$/.test(String(e[i])) ? Number.parseFloat(String(e[i])) : e[i];
  }
  if (styles.borderStyle !== undefined) style = splitSpaces(String(styles.borderStyle))[0];
  if (styles.borderColor !== undefined) color = String(styles.borderColor);
  SIDE_NAMES.forEach((s, i) => {
    const sh = styles[`border${s}`];
    if (sh !== undefined) {
      const p = parseBorderShorthand(sh);
      widths[i] = p.style === "none" ? 0 : (p.width ?? (p.style ? "medium" : widths[i]));
      style ??= p.style;
      color ??= p.color;
    }
    const w = styles[`border${s}Width`];
    if (w !== undefined) widths[i] = w;
    const st = styles[`border${s}Style`];
    if (st !== undefined) style ??= String(st);
    const c = styles[`border${s}Color`];
    if (c !== undefined) color ??= String(c);
  });
  const out: BorderValue = {};
  const first = widths.find((w) => w !== undefined);
  if (first !== undefined) out.width = widths[0] ?? first;
  if (widths.some((w) => w !== undefined)) out.widths = widths;
  if (style !== undefined) out.style = style;
  if (color !== undefined) out.color = color;
  return out;
}

export function hasBorder(styles: StyleMap): boolean {
  const b = readBorder(styles);
  if (b.style === "none" || b.style === "hidden") return false;
  return b.width !== undefined || b.style !== undefined || b.color !== undefined;
}

/** True when the per-side widths differ. */
export function bordersDiffer(b: BorderValue): boolean {
  const w = b.widths;
  return !!w && w.some((x) => String(x ?? 0) !== String(w[0] ?? 0));
}

export function writeBorder(b: BorderValue | null): Record<string, StyleValue | null> {
  const patch: Record<string, StyleValue | null> = { border: null, borderWidth: null, borderStyle: null, borderColor: null };
  for (const s of SIDE_NAMES) {
    patch[`border${s}`] = null;
    patch[`border${s}Width`] = null;
    patch[`border${s}Style`] = null;
    patch[`border${s}Color`] = null;
  }
  if (!b) return patch;
  if (b.widths && bordersDiffer(b)) {
    SIDE_NAMES.forEach((s, i) => {
      patch[`border${s}Width`] = b.widths![i] ?? 0;
    });
  } else {
    patch.borderWidth = b.widths?.[0] ?? b.width ?? 1;
  }
  patch.borderStyle = b.style ?? "solid";
  patch.borderColor = b.color ?? "#000000";
  return patch;
}

// ---------------------------------------------------------------- outline

export interface OutlineValue {
  width?: StyleValue;
  style?: string;
  color?: string;
  offset?: StyleValue;
}

export function readOutline(styles: StyleMap): OutlineValue {
  const sh = parseBorderShorthand(styles.outline);
  const out: OutlineValue = {};
  if (sh.width !== undefined) out.width = sh.width;
  if (sh.style !== undefined) out.style = sh.style;
  if (sh.color !== undefined) out.color = sh.color;
  if (styles.outlineWidth !== undefined) out.width = styles.outlineWidth;
  if (styles.outlineStyle !== undefined) out.style = String(styles.outlineStyle);
  if (styles.outlineColor !== undefined) out.color = String(styles.outlineColor);
  if (styles.outlineOffset !== undefined) out.offset = styles.outlineOffset;
  return out;
}

export function hasOutline(styles: StyleMap): boolean {
  const o = readOutline(styles);
  if (o.style === "none" || o.style === "hidden") return false;
  return o.width !== undefined || o.style !== undefined || o.color !== undefined;
}

export function writeOutline(o: OutlineValue | null): Record<string, StyleValue | null> {
  const patch: Record<string, StyleValue | null> = { outline: null, outlineWidth: null, outlineStyle: null, outlineColor: null, outlineOffset: null };
  if (!o) return patch;
  patch.outlineWidth = o.width ?? 1;
  patch.outlineStyle = o.style ?? "solid";
  patch.outlineColor = o.color ?? "#000000";
  patch.outlineOffset = o.offset === undefined || o.offset === 0 ? null : o.offset;
  return patch;
}
