// Computed style → OpenCrease style map. Pure: works on a reader function, so it is unit tested without a DOM.
// Only paint and text properties are produced here; size, position and flex come from the layout step.
import { formatColor, normalizeStyles } from "@opencrease/css";
import type { StyleMap } from "@opencrease/model";
import type { CapKind } from "./types";

/** Reads a computed property by its CSS (kebab-case) name, like CSSStyleDeclaration.getPropertyValue. */
export type StyleReader = (prop: string) => string;

export interface StyleContext {
  kind: CapKind;
  /** Keep font families and OpenType features. When false only the generic family is kept. */
  keepFonts: boolean;
}

const SIDES = ["top", "right", "bottom", "left"] as const;
const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;
const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji"]);

/** Rounds a number to at most 2 decimals and drops a trailing ".0". */
export function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

/** "12.3456px" → 12.35; anything that is not a plain px length → undefined. */
export function pxNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^(-?\d*\.?\d+(?:e-?\d+)?)px$/i.exec(value.trim());
  return m ? round2(Number(m[1])) : undefined;
}

/** Rounds every px length inside a value ("0px 1.33333px 2px" → "0px 1.33px 2px"). */
export function roundLengths(value: string): string {
  return value.replace(/(-?\d*\.\d+)(px|em|rem|%|deg)/g, (_m, n: string, unit: string) => `${round2(Number(n))}${unit}`);
}

/** rgb()/rgba() literals → hex, so captured colours read like hand-written ones. */
export function hexColors(value: string): string {
  return value.replace(/rgba?\([^()]*\)/gi, (c) => {
    const hex = formatColor(c, "hex");
    return hex.startsWith("#") ? hex.toUpperCase() : c;
  });
}

export function isTransparent(color: string): boolean {
  const c = color.trim().toLowerCase();
  if (c === "transparent" || c === "") return true;
  const m = /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/.exec(c);
  if (m) return Number(m[1]) === 0;
  const slash = /\/\s*0(\.0+)?\s*\)$/.exec(c);
  return slash !== null;
}

function clean(value: string): string {
  return hexColors(roundLengths(value.trim()));
}

/** The first family of a font stack, unquoted ("\"Inter Variable\", sans-serif" → "Inter Variable"). */
export function primaryFamily(stack: string): string {
  const first = stack.split(",")[0] ?? "";
  return first.trim().replace(/^["']|["']$/g, "");
}

/** The generic family at the end of a stack, or sans-serif. */
export function genericFamily(stack: string): string {
  const parts = stack.split(",").map((p) => p.trim().replace(/^["']|["']$/g, "").toLowerCase());
  for (let i = parts.length - 1; i >= 0; i--) if (GENERIC_FAMILIES.has(parts[i])) return parts[i];
  return "sans-serif";
}

function borderOf(read: StyleReader, side: string): string | null {
  const style = read(`border-${side}-style`);
  const width = pxNumber(read(`border-${side}-width`)) ?? 0;
  if (!style || style === "none" || style === "hidden" || width <= 0) return null;
  return `${width}px ${style} ${clean(read(`border-${side}-color`))}`;
}

function textAlign(value: string): string | undefined {
  switch (value) {
    case "start":
    case "left":
    case "-webkit-left":
      return undefined;
    case "end":
    case "right":
    case "-webkit-right":
      return "right";
    case "center":
    case "-webkit-center":
      return "center";
    case "justify":
      return "justify";
    default:
      return undefined;
  }
}

/**
 * Builds the paint and text styles for one captured node from its computed style. Defaults are left out,
 * colours become hex, lengths are rounded and the result is filtered through OpenCrease's allowlist.
 */
export function snapshotStyles(read: StyleReader, ctx: StyleContext): StyleMap {
  const raw: Record<string, string | number> = {};
  const set = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === "") return;
    raw[key] = typeof value === "string" ? clean(value) : value;
  };

  // ---- background
  const bg = read("background-color");
  if (bg && !isTransparent(bg)) set("backgroundColor", bg);
  const image = read("background-image");
  if (image && image !== "none") {
    set("backgroundImage", image);
    const size = read("background-size");
    if (size && size !== "auto" && size !== "auto auto") set("backgroundSize", size);
    const pos = read("background-position");
    if (pos && pos !== "0% 0%") set("backgroundPosition", pos);
    const rep = read("background-repeat");
    if (rep && rep !== "repeat" && rep !== "repeat repeat") set("backgroundRepeat", rep);
    const blend = read("background-blend-mode");
    if (blend && blend !== "normal") set("backgroundBlendMode", blend);
  }
  const clip = read("background-clip") || read("-webkit-background-clip");
  if (clip === "text") set("backgroundClip", "text");

  // ---- borders and corners
  const borders = SIDES.map((s) => borderOf(read, s));
  if (borders.every((b) => b !== null && b === borders[0])) set("border", borders[0]!);
  else
    borders.forEach((b, i) => {
      if (b) set(`border${SIDES[i][0].toUpperCase()}${SIDES[i].slice(1)}`, b);
    });
  const radii = CORNERS.map((c) => read(`border-${c}-radius`) || "0px");
  const nonZero = radii.some((r) => !/^0(px)?( 0(px)?)?$/.test(r.trim()));
  if (nonZero) {
    if (radii.every((r) => r === radii[0])) set("borderRadius", pxNumber(radii[0]) ?? radii[0]);
    else
      radii.forEach((r, i) => {
        const key = `border${CORNERS[i].split("-").map((p) => p[0].toUpperCase() + p.slice(1)).join("")}Radius`;
        set(key, pxNumber(r) ?? r);
      });
  }

  // ---- effects
  const shadow = read("box-shadow");
  if (shadow && shadow !== "none") set("boxShadow", shadow);
  const opacity = Number(read("opacity"));
  if (read("opacity") && Number.isFinite(opacity) && opacity < 1) set("opacity", round2(opacity));
  const blend = read("mix-blend-mode");
  if (blend && blend !== "normal") set("mixBlendMode", blend);
  const filter = read("filter");
  if (filter && filter !== "none") set("filter", filter);
  const backdrop = read("backdrop-filter") || read("-webkit-backdrop-filter");
  if (backdrop && backdrop !== "none") set("backdropFilter", backdrop);
  const clipPath = read("clip-path");
  if (clipPath && clipPath !== "none") set("clipPath", clipPath);
  const mask = read("mask-image") || read("-webkit-mask-image");
  if (mask && mask !== "none") set("maskImage", mask);
  const outlineStyle = read("outline-style");
  const outlineWidth = pxNumber(read("outline-width")) ?? 0;
  if (outlineStyle && outlineStyle !== "none" && outlineWidth > 0) {
    set("outline", `${outlineWidth}px ${outlineStyle} ${read("outline-color")}`);
    const offset = pxNumber(read("outline-offset"));
    if (offset) set("outlineOffset", offset);
  }
  const ox = read("overflow-x");
  const oy = read("overflow-y");
  if ((ox && ox !== "visible") || (oy && oy !== "visible")) set("overflow", "hidden");
  const transform = read("transform");
  if (transform && transform !== "none") {
    set("transform", transform);
    const origin = read("transform-origin");
    if (origin) set("transformOrigin", origin);
  }

  if (ctx.kind === "image") {
    const fit = read("object-fit");
    if (fit && fit !== "fill") set("objectFit", fit);
    const pos = read("object-position");
    if (pos && pos !== "50% 50%") set("objectPosition", pos);
  }

  if (ctx.kind === "text") Object.assign(raw, textStyles(read, ctx));

  return normalizeStyles(raw).styles;
}

function textStyles(read: StyleReader, ctx: StyleContext): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const set = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === "") return;
    out[key] = typeof value === "string" ? clean(value) : value;
  };
  const color = read("color");
  set("color", color);
  const stack = read("font-family");
  if (stack) set("fontFamily", ctx.keepFonts ? stack.trim() : genericFamily(stack));
  set("fontSize", pxNumber(read("font-size")) ?? read("font-size"));
  const weight = Number(read("font-weight"));
  if (read("font-weight") && Number.isFinite(weight)) set("fontWeight", weight);
  const style = read("font-style");
  if (style && style !== "normal") set("fontStyle", style.startsWith("oblique") ? "italic" : style);
  const lh = read("line-height");
  if (lh) set("lineHeight", lh === "normal" ? "normal" : (pxNumber(lh) !== undefined ? `${pxNumber(lh)}px` : lh));
  const ls = read("letter-spacing");
  if (ls && ls !== "normal" && pxNumber(ls) !== 0) set("letterSpacing", ls);
  const ws = read("word-spacing");
  if (ws && ws !== "normal" && pxNumber(ws) !== 0) set("wordSpacing", ws);
  set("textAlign", textAlign(read("text-align")));
  const tt = read("text-transform");
  if (tt && tt !== "none") set("textTransform", tt);
  const indent = pxNumber(read("text-indent"));
  if (indent) set("textIndent", indent);
  const line = read("text-decoration-line");
  if (line && line !== "none") {
    set("textDecorationLine", line);
    const dc = read("text-decoration-color");
    if (dc && dc !== color) set("textDecorationColor", dc);
    const ds = read("text-decoration-style");
    if (ds && ds !== "solid") set("textDecorationStyle", ds);
    const dt = read("text-decoration-thickness");
    if (dt && dt !== "auto" && dt !== "from-font") set("textDecorationThickness", dt);
    const uo = read("text-underline-offset");
    if (uo && uo !== "auto") set("textUnderlineOffset", uo);
  }
  const shadow = read("text-shadow");
  if (shadow && shadow !== "none") set("textShadow", shadow);
  const wb = read("word-break");
  if (wb && wb !== "normal") set("wordBreak", wb);
  const ow = read("overflow-wrap");
  if (ow && ow !== "normal") set("overflowWrap", ow);
  const to = read("text-overflow");
  if (to && to !== "clip") set("textOverflow", to);
  const clamp = read("-webkit-line-clamp");
  if (clamp && clamp !== "none") set("WebkitLineClamp", Number(clamp) || clamp);
  const strokeWidth = pxNumber(read("-webkit-text-stroke-width"));
  if (strokeWidth) set("WebkitTextStroke", `${strokeWidth}px ${read("-webkit-text-stroke-color")}`);
  const fill = read("-webkit-text-fill-color");
  if (fill && fill !== color) set("WebkitTextFillColor", fill);
  const wrap = read("text-wrap-style") || read("text-wrap");
  if (wrap === "balance" || wrap === "pretty") set("textWrap", wrap);

  if (ctx.keepFonts) {
    const stretch = read("font-stretch");
    if (stretch && stretch !== "100%" && stretch !== "normal") set("fontStretch", stretch);
    for (const [prop, key, def] of [
      ["font-feature-settings", "fontFeatureSettings", "normal"],
      ["font-variation-settings", "fontVariationSettings", "normal"],
      ["font-variant-numeric", "fontVariantNumeric", "normal"],
      ["font-variant-ligatures", "fontVariantLigatures", "normal"],
      ["font-variant-caps", "fontVariantCaps", "normal"],
      ["font-optical-sizing", "fontOpticalSizing", "auto"],
      ["font-kerning", "fontKerning", "auto"],
    ] as const) {
      const v = read(prop);
      if (v && v !== def) out[key] = v.trim();
    }
  }
  return out;
}

/** True when the node paints nothing of its own (growing its box is invisible). */
export function isPaintless(styles: StyleMap): boolean {
  const painted = ["backgroundColor", "backgroundImage", "border", "borderTop", "borderRight", "borderBottom", "borderLeft", "boxShadow", "outline", "backdropFilter", "filter"];
  return !painted.some((k) => styles[k] !== undefined);
}
