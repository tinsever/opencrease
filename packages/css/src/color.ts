import { converter, differenceEuclidean, formatHex, formatHex8, formatHsl, formatRgb, parse } from "culori";
import type { Color } from "culori";
import { matchParen } from "./tokenize";

export type ParsedColor = { mode: string; [k: string]: unknown };

/** Parses any CSS colour literal (hex, rgb, hsl, hwb, lab, lch, oklab, oklch, color(), named). `var()` and `color-mix()` are not resolved. */
export function parseColor(value: string): ParsedColor | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v) return undefined;
  const c = parse(v);
  return c ? (c as unknown as ParsedColor) : undefined;
}

const toRgb = converter("rgb");
const rgbDistance = differenceEuclidean("rgb");

/** Maximum Euclidean distance in (unclamped) sRGB 0..1 space for two colours to count as equal (half an 8-bit step). */
const COLOR_EPSILON = 0.002;
const ALPHA_EPSILON = 0.003;

function normalizeText(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*([(),/])\s*/g, "$1");
}

/**
 * True when two colour strings denote the same colour, across formats (hex, rgb, hsl, oklch, named, ...).
 * Alpha is compared too; two fully transparent colours are equal. Strings that are not colour literals
 * (e.g. `var(--x)`) are compared textually (case and whitespace insensitive).
 */
export function colorsEqual(a: string, b: string): boolean {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return !ca && !cb && normalizeText(a) === normalizeText(b);
  const ra = toRgb(ca as unknown as Color);
  const rb = toRgb(cb as unknown as Color);
  const alphaA = ra.alpha ?? 1;
  const alphaB = rb.alpha ?? 1;
  if (Math.abs(alphaA - alphaB) > ALPHA_EPSILON) return false;
  if (alphaA <= ALPHA_EPSILON && alphaB <= ALPHA_EPSILON) return true;
  const opaqueA = { ...ra, alpha: 1 };
  const opaqueB = { ...rb, alpha: 1 };
  return rgbDistance(opaqueA, opaqueB) <= COLOR_EPSILON;
}

function num(n: number | undefined, digits: number): string {
  const v = Number.isFinite(n) ? (n as number) : 0;
  const s = v.toFixed(digits).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

/**
 * Formats a CSS colour in the requested notation. Unparseable input is returned unchanged.
 * hex: "#rrggbb" or "#rrggbbaa" (sRGB-clamped); rgb/hsl: legacy comma syntax; oklch: "oklch(L C H / a)".
 */
export function formatColor(value: string, mode: "hex" | "oklch" | "rgb" | "hsl"): string {
  const parsed = parseColor(value);
  if (!parsed) return value;
  const c = parsed as unknown as Color;
  const alpha = c.alpha ?? 1;
  switch (mode) {
    case "hex":
      return alpha < 1 ? formatHex8(c) : formatHex(c);
    case "rgb":
      return formatRgb(c);
    case "hsl":
      return formatHsl(c);
    case "oklch": {
      const o = converter("oklch")(c);
      const base = `${num(o.l, 4)} ${num(o.c, 4)} ${num(o.h ?? 0, 2)}`;
      return alpha < 1 ? `oklch(${base} / ${num(alpha, 3)})` : `oklch(${base})`;
    }
  }
}

const COLOR_FUNCTIONS = new Set([
  "rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color",
]);

/**
 * Extracts colour literals and `var(--x)` references from a composite CSS value (gradients, borders,
 * shadows, ...), in order of first appearance, without duplicates. `color-mix()` and `var()` fallbacks
 * are searched recursively; `url(...)` contents and strings are skipped.
 */
export function findColorsInValue(value: string): string[] {
  const found: string[] = [];
  const add = (s: string) => {
    if (!found.includes(s)) found.push(s);
  };
  if (typeof value !== "string") return found;
  scan(value, add);
  return found;
}

function scan(text: string, add: (s: string) => void): void {
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const end = text.indexOf(ch, i + 1);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (ch === "#") {
      const m = /^#[0-9a-fA-F]+/.exec(text.slice(i));
      if (m && [4, 5, 7, 9].includes(m[0].length) && !/[\w-]/.test(text[i + m[0].length] ?? "")) add(m[0]);
      i += m ? m[0].length : 1;
      continue;
    }
    if (/[a-zA-Z-]/.test(ch) && (i === 0 || !/[\w-]/.test(text[i - 1]))) {
      const m = /^-?[a-zA-Z][\w-]*/.exec(text.slice(i));
      if (!m) {
        i++;
        continue;
      }
      const ident = m[0];
      const after = i + ident.length;
      const lower = ident.toLowerCase();
      if (text[after] === "(") {
        const close = matchParen(text, after);
        const end = close === -1 ? text.length : close;
        const inner = text.slice(after + 1, end);
        if (lower === "url") {
          // skip
        } else if (lower === "var") {
          const name = /^\s*(--[\w-]+)/.exec(inner);
          if (name) add(`var(${name[1]})`);
          const comma = inner.indexOf(",");
          if (comma !== -1) scan(inner.slice(comma + 1), add);
        } else if (COLOR_FUNCTIONS.has(lower)) {
          add(text.slice(i, end + 1).trim());
        } else {
          // gradients, color-mix, drop-shadow(), etc.: look inside
          scan(inner, add);
        }
        i = end + 1;
        continue;
      }
      if (parseColor(lower) && !/^-/.test(ident)) add(ident);
      i = after;
      continue;
    }
    i++;
  }
}

/**
 * Rewrites colour literals and `var(--x)` references inside a composite CSS value. `fn` returns the
 * replacement or undefined to keep a colour. Uses the same scanning rules as `findColorsInValue`.
 */
export function mapColorsInValue(value: string, fn: (color: string) => string | undefined): string {
  if (typeof value !== "string") return value;
  return rewrite(value, fn);
}

function rewrite(text: string, fn: (color: string) => string | undefined): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const end = text.indexOf(ch, i + 1);
      const stop = end === -1 ? text.length : end + 1;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "#") {
      const m = /^#[0-9a-fA-F]+/.exec(text.slice(i));
      if (m && [4, 5, 7, 9].includes(m[0].length) && !/[\w-]/.test(text[i + m[0].length] ?? "")) {
        out += fn(m[0]) ?? m[0];
        i += m[0].length;
        continue;
      }
      out += ch;
      i++;
      continue;
    }
    if (/[a-zA-Z-]/.test(ch) && (i === 0 || !/[\w-]/.test(text[i - 1]))) {
      const m = /^-?[a-zA-Z][\w-]*/.exec(text.slice(i));
      if (!m) {
        out += ch;
        i++;
        continue;
      }
      const ident = m[0];
      const after = i + ident.length;
      const lower = ident.toLowerCase();
      if (text[after] === "(") {
        const close = matchParen(text, after);
        const end = close === -1 ? text.length : close;
        const whole = text.slice(i, end + 1);
        const inner = text.slice(after + 1, end);
        if (lower === "url") {
          out += whole;
        } else if (lower === "var") {
          const ref = /^\s*(--[\w-]+)/.exec(inner);
          const replaced = ref ? fn(`var(${ref[1]})`) : undefined;
          const comma = inner.indexOf(",");
          if (replaced !== undefined) out += replaced;
          else if (comma === -1) out += whole;
          else out += `${text.slice(i, after + 1)}${inner.slice(0, comma + 1)}${rewrite(inner.slice(comma + 1), fn)})`;
        } else if (COLOR_FUNCTIONS.has(lower)) {
          out += fn(whole.trim()) ?? whole;
        } else {
          out += `${text.slice(i, after + 1)}${rewrite(inner, fn)}${close === -1 ? "" : ")"}`;
        }
        i = end + 1;
        continue;
      }
      out += parseColor(lower) && !/^-/.test(ident) ? (fn(ident) ?? ident) : ident;
      i = after;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
