import type { StyleMap, StyleValue, Token } from "@opencrease/model";
import { parseColor } from "./color";
import { splitSpaces } from "./tokenize";

export interface TailwindResult {
  classes: string[];
  /** Styles that have no Tailwind mapping (emit as inline style). */
  rest: StyleMap;
}

type Kind = "color" | "length" | "number" | "family" | "any";

interface Ctx {
  tokens: Set<string>;
  classes: string[];
}

/** Namespace prefix of tokens usable for each utility family (Tailwind v4 theme namespaces). */
const NAMESPACES: Record<string, string[]> = {
  bg: ["--color-"],
  text: ["--color-"],
  border: ["--color-"],
  outline: ["--color-"],
  fill: ["--color-"],
  stroke: ["--color-"],
  decoration: ["--color-"],
  fontSize: ["--text-"],
  font: ["--font-"],
  fontWeight: ["--font-weight-"],
  leading: ["--leading-"],
  tracking: ["--tracking-"],
  rounded: ["--radius-"],
  opacity: ["--opacity-"],
  shadow: ["--shadow-"],
  spacing: ["--spacing-"],
  size: ["--spacing-", "--container-"],
};

function str(v: StyleValue): string {
  return typeof v === "number" ? `${v}px` : v.trim();
}

/** Arbitrary value encoding: spaces → "_", literal underscores escaped. */
function arb(value: string): string {
  return value.trim().replace(/_/g, "\\_").replace(/\s*,\s*/g, ",").replace(/\s+/g, "_");
}

function varName(value: string): string | null {
  const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value.trim());
  return m ? m[1] : null;
}

/**
 * Builds a utility class for `prefix` and a value. `var(--x)` uses the token name when the token exists in
 * a matching namespace (`bg-primary` for `--color-primary`), else `prefix-(--x)`.
 */
function utility(ctx: Ctx, prefix: string, value: StyleValue, kind: Kind, ns: string[]): string {
  const v = str(value);
  const name = varName(v);
  if (name) {
    if (ctx.tokens.has(name)) {
      for (const p of ns) {
        if (name.startsWith(p)) {
          const short = name.slice(p.length);
          // font-weight tokens share the "--font-" prefix; never map them to font families
          if (p === "--font-" && short.startsWith("weight-")) continue;
          if (short) return `${prefix}-${short}`;
        }
      }
    }
    const hint = kind === "length" && (prefix === "text" || prefix === "border" || prefix === "outline")
      ? "length:"
      : kind === "family" ? "family-name:" : "";
    return `${prefix}-(${hint}${name})`;
  }
  let inner = v;
  if (kind === "color" && !/^(#|rgb|hsl|hwb|lab|lch|oklab|oklch|color\(|color-mix\(|var\()/i.test(v)) inner = `color:${v}`;
  if (kind === "length" && prefix === "text" && !/^[\d.]/.test(v)) inner = `length:${v}`;
  if (kind === "family") inner = `family-name:${v.replace(/"/g, "'")}`;
  return `${prefix}-[${arb(inner)}]`;
}

const SIZE_KEYWORDS: Record<string, string> = {
  "100%": "full",
  auto: "auto",
  "fit-content": "fit",
  "min-content": "min",
  "max-content": "max",
};

function sizeClass(ctx: Ctx, prefix: string, value: StyleValue): string {
  if (value === 0 || value === "0" || value === "0px") return `${prefix}-0`;
  if (typeof value === "string") {
    const kw = SIZE_KEYWORDS[value.trim()];
    if (kw && !(prefix.startsWith("min") && kw === "auto")) return `${prefix}-${kw}`;
    if (prefix === "w" && value.trim() === "100vw") return "w-screen";
    if (prefix === "h" && value.trim() === "100vh") return "h-screen";
  }
  return utility(ctx, prefix, value, "length", NAMESPACES.size);
}

function spacingClass(ctx: Ctx, prefix: string, value: StyleValue): string {
  if (value === 0 || value === "0" || value === "0px") return `${prefix}-0`;
  return utility(ctx, prefix, value, "length", NAMESPACES.spacing);
}

const ENUMS: Record<string, Record<string, string>> = {
  display: { flex: "flex", block: "block", none: "hidden", grid: "grid" },
  gridAutoFlow: { row: "grid-flow-row", column: "grid-flow-col", dense: "grid-flow-dense", "row dense": "grid-flow-row-dense", "column dense": "grid-flow-col-dense" },
  justifyItems: { start: "justify-items-start", end: "justify-items-end", center: "justify-items-center", stretch: "justify-items-stretch", normal: "justify-items-normal" },
  justifySelf: { auto: "justify-self-auto", start: "justify-self-start", end: "justify-self-end", center: "justify-self-center", stretch: "justify-self-stretch" },
  flexDirection: { row: "flex-row", column: "flex-col", "row-reverse": "flex-row-reverse", "column-reverse": "flex-col-reverse" },
  flexWrap: { wrap: "flex-wrap", nowrap: "flex-nowrap", "wrap-reverse": "flex-wrap-reverse" },
  alignItems: {
    "flex-start": "items-start", start: "items-start", "flex-end": "items-end", end: "items-end",
    center: "items-center", baseline: "items-baseline", stretch: "items-stretch",
  },
  justifyContent: {
    "flex-start": "justify-start", start: "justify-start", "flex-end": "justify-end", end: "justify-end",
    center: "justify-center", "space-between": "justify-between", "space-around": "justify-around",
    "space-evenly": "justify-evenly", stretch: "justify-stretch", normal: "justify-normal",
  },
  alignContent: {
    "flex-start": "content-start", start: "content-start", "flex-end": "content-end", end: "content-end",
    center: "content-center", "space-between": "content-between", "space-around": "content-around",
    "space-evenly": "content-evenly", stretch: "content-stretch", normal: "content-normal",
  },
  alignSelf: {
    auto: "self-auto", "flex-start": "self-start", start: "self-start", "flex-end": "self-end", end: "self-end",
    center: "self-center", stretch: "self-stretch", baseline: "self-baseline",
  },
  position: { relative: "relative", absolute: "absolute" },
  overflow: { hidden: "overflow-hidden", clip: "overflow-clip", visible: "overflow-visible", scroll: "overflow-scroll", auto: "overflow-auto" },
  overflowX: { hidden: "overflow-x-hidden", clip: "overflow-x-clip", visible: "overflow-x-visible", scroll: "overflow-x-scroll", auto: "overflow-x-auto" },
  overflowY: { hidden: "overflow-y-hidden", clip: "overflow-y-clip", visible: "overflow-y-visible", scroll: "overflow-y-scroll", auto: "overflow-y-auto" },
  boxSizing: { "border-box": "box-border", "content-box": "box-content" },
  fontStyle: { italic: "italic", normal: "not-italic" },
  textAlign: { left: "text-left", center: "text-center", right: "text-right", justify: "text-justify", start: "text-start", end: "text-end" },
  textTransform: { uppercase: "uppercase", lowercase: "lowercase", capitalize: "capitalize", none: "normal-case" },
  textDecoration: { underline: "underline", "line-through": "line-through", overline: "overline", none: "no-underline" },
  textDecorationLine: { underline: "underline", "line-through": "line-through", overline: "overline", none: "no-underline" },
  whiteSpace: {
    normal: "whitespace-normal", nowrap: "whitespace-nowrap", pre: "whitespace-pre", "pre-line": "whitespace-pre-line",
    "pre-wrap": "whitespace-pre-wrap", "break-spaces": "whitespace-break-spaces",
  },
  textWrap: { wrap: "text-wrap", nowrap: "text-nowrap", balance: "text-balance", pretty: "text-pretty" },
  textOverflow: { ellipsis: "text-ellipsis", clip: "text-clip" },
  wordBreak: { "break-all": "break-all", "keep-all": "break-keep", normal: "break-normal" },
  overflowWrap: { anywhere: "wrap-anywhere", "break-word": "wrap-break-word", normal: "wrap-normal" },
  objectFit: { cover: "object-cover", contain: "object-contain", fill: "object-fill", none: "object-none", "scale-down": "object-scale-down" },
  mixBlendMode: Object.fromEntries(
    ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light",
      "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity", "plus-darker", "plus-lighter"]
      .map((m) => [m, `mix-blend-${m}`]),
  ),
  borderStyle: { solid: "border-solid", dashed: "border-dashed", dotted: "border-dotted", double: "border-double", none: "border-none" },
  outlineStyle: { solid: "outline-solid", dashed: "outline-dashed", dotted: "outline-dotted", double: "outline-double", none: "outline-hidden" },
};

const FONT_WEIGHTS: Record<string, string> = {
  "100": "thin", "200": "extralight", "300": "light", "400": "normal", "500": "medium",
  "600": "semibold", "700": "bold", "800": "extrabold", "900": "black",
  normal: "normal", bold: "bold",
};

const SIZE_PREFIX: Record<string, string> = {
  width: "w", height: "h", minWidth: "min-w", maxWidth: "max-w", minHeight: "min-h", maxHeight: "max-h", flexBasis: "basis",
};
const SPACING_PREFIX: Record<string, string> = {
  gap: "gap", rowGap: "gap-y", columnGap: "gap-x",
  paddingTop: "pt", paddingRight: "pr", paddingBottom: "pb", paddingLeft: "pl",
  paddingInline: "px", paddingBlock: "py",
  top: "top", right: "right", bottom: "bottom", left: "left", inset: "inset",
};
const RADIUS_PREFIX: Record<string, string> = {
  borderRadius: "rounded", borderTopLeftRadius: "rounded-tl", borderTopRightRadius: "rounded-tr",
  borderBottomRightRadius: "rounded-br", borderBottomLeftRadius: "rounded-bl",
};
const BORDER_SIDE: Record<string, string> = {
  border: "border", borderTop: "border-t", borderRight: "border-r", borderBottom: "border-b", borderLeft: "border-l",
};
const BORDER_WIDTH: Record<string, string> = {
  borderWidth: "border", borderTopWidth: "border-t", borderRightWidth: "border-r",
  borderBottomWidth: "border-b", borderLeftWidth: "border-l",
};

function isColorLike(v: string): boolean {
  return parseColor(v) !== undefined || /^(var|color-mix)\(/i.test(v.trim());
}

function isLengthLike(v: string): boolean {
  return /^-?(\d+\.?\d*|\.\d+)(px|em|rem|%|vw|vh)?$/.test(v) || /^var\(/.test(v) || /^calc\(/.test(v) ||
    ["thin", "medium", "thick"].includes(v);
}

function paddingShorthand(ctx: Ctx, value: StyleValue): boolean {
  const parts = typeof value === "number" ? [value as StyleValue] : splitSpaces(value);
  if (parts.length < 1 || parts.length > 4) return false;
  const [t, r = t, b = t, l = r] = parts;
  const eq = (a: StyleValue, c: StyleValue) => str(a) === str(c);
  if (eq(t, r) && eq(t, b) && eq(t, l)) ctx.classes.push(spacingClass(ctx, "p", t));
  else if (eq(t, b) && eq(r, l)) ctx.classes.push(spacingClass(ctx, "px", r), spacingClass(ctx, "py", t));
  else {
    ctx.classes.push(spacingClass(ctx, "pt", t), spacingClass(ctx, "pr", r), spacingClass(ctx, "pb", b), spacingClass(ctx, "pl", l));
  }
  return true;
}

function borderShorthand(ctx: Ctx, prefix: string, value: StyleValue): boolean {
  if (typeof value === "number") {
    ctx.classes.push(`${prefix}-[${value}px]`);
    return true;
  }
  const v = value.trim();
  if (v === "none" || v === "0") {
    ctx.classes.push(`${prefix}-0`);
    return true;
  }
  const parts = splitSpaces(v);
  let width: string | undefined;
  let style: string | undefined;
  let color: string | undefined;
  for (const p of parts) {
    if (!style && ENUMS.borderStyle[p]) style = p;
    else if (!width && isLengthLike(p)) width = p;
    else if (!color && isColorLike(p)) color = p;
    else return false;
  }
  // Tailwind border styles are not per side: only allow non-solid styles on the full border.
  if (style && style !== "solid" && prefix !== "border") return false;
  const out: string[] = [];
  out.push(width === undefined ? prefix : width === "1px" ? prefix : `${prefix}-[${arb(width)}]`);
  if (style && style !== "solid") out.push(ENUMS.borderStyle[style]);
  else if (style === "solid" && prefix === "border") out.push("border-solid");
  if (color) out.push(utility(ctx, prefix, color, "color", NAMESPACES.border));
  ctx.classes.push(...out);
  return true;
}

function aspectClass(value: StyleValue): string {
  const v = String(value).replace(/\s+/g, "");
  if (v === "1/1" || v === "1") return "aspect-square";
  if (v === "16/9") return "aspect-video";
  if (v === "auto") return "aspect-auto";
  return `aspect-[${arb(v)}]`;
}

function mapOne(ctx: Ctx, key: string, value: StyleValue): boolean {
  const v = typeof value === "string" ? value.trim() : value;
  const sv = String(v);

  const e = ENUMS[key];
  if (e) {
    const cls = e[sv];
    if (cls) {
      ctx.classes.push(cls);
      return true;
    }
    return false;
  }

  if (SIZE_PREFIX[key]) {
    ctx.classes.push(sizeClass(ctx, SIZE_PREFIX[key], v));
    return true;
  }
  if (SPACING_PREFIX[key]) {
    ctx.classes.push(spacingClass(ctx, SPACING_PREFIX[key], v));
    return true;
  }
  if (RADIUS_PREFIX[key]) {
    const prefix = RADIUS_PREFIX[key];
    if (v === 0 || sv === "0" || sv === "0px") ctx.classes.push(`${prefix}-none`);
    else if (sv === "9999px" || v === 9999) ctx.classes.push(`${prefix}-full`);
    else ctx.classes.push(utility(ctx, prefix, v, "length", NAMESPACES.rounded));
    return true;
  }
  if (BORDER_SIDE[key]) return borderShorthand(ctx, BORDER_SIDE[key], v);
  if (BORDER_WIDTH[key]) {
    const prefix = BORDER_WIDTH[key];
    ctx.classes.push(sv === "1px" || v === 1 ? prefix : v === 0 || sv === "0" ? `${prefix}-0` : utility(ctx, prefix, v, "length", []));
    return true;
  }

  switch (key) {
    case "gridTemplateColumns":
    case "gridTemplateRows": {
      const prefix = key === "gridTemplateColumns" ? "grid-cols" : "grid-rows";
      const m = /^repeat\(\s*(\d+)\s*,\s*minmax\(\s*0(px)?\s*,\s*1fr\s*\)\s*\)$/.exec(sv);
      ctx.classes.push(m ? `${prefix}-${m[1]}` : sv === "none" ? `${prefix}-none` : `${prefix}-[${arb(sv)}]`);
      return true;
    }
    case "gridColumn":
    case "gridRow": {
      const prefix = key === "gridColumn" ? "col" : "row";
      const span = /^span\s+(\d+)(\s*\/\s*span\s+\1)?$/.exec(sv);
      ctx.classes.push(span ? `${prefix}-span-${span[1]}` : sv === "1 / -1" ? `${prefix}-span-full` : sv === "auto" ? `${prefix}-auto` : `${prefix}-[${arb(sv)}]`);
      return true;
    }
    case "padding":
      return paddingShorthand(ctx, v);
    case "flexGrow":
      ctx.classes.push(sv === "1" ? "grow" : sv === "0" ? "grow-0" : `grow-[${arb(sv)}]`);
      return true;
    case "flexShrink":
      ctx.classes.push(sv === "1" ? "shrink" : sv === "0" ? "shrink-0" : `shrink-[${arb(sv)}]`);
      return true;
    case "flex":
      if (sv === "1" || sv === "1 1 0%" || sv === "1 1 0") ctx.classes.push("flex-1");
      else if (sv === "none") ctx.classes.push("flex-none");
      else if (sv === "auto") ctx.classes.push("flex-auto");
      else ctx.classes.push(`flex-[${arb(sv)}]`);
      return true;
    case "order":
    case "zIndex": {
      const prefix = key === "order" ? "order" : "z";
      if (/^\d+$/.test(sv)) ctx.classes.push(`${prefix}-${sv}`);
      else if (/^-\d+$/.test(sv)) ctx.classes.push(`-${prefix}-${sv.slice(1)}`);
      else return false;
      return true;
    }
    case "opacity": {
      const name = varName(sv);
      if (name) {
        ctx.classes.push(utility(ctx, "opacity", sv, "number", NAMESPACES.opacity));
        return true;
      }
      const n = sv.endsWith("%") ? Number(sv.slice(0, -1)) / 100 : Number(sv);
      if (!Number.isFinite(n)) return false;
      const pct = n * 100;
      ctx.classes.push(Math.abs(pct - Math.round(pct)) < 1e-9 ? `opacity-${Math.round(pct)}` : `opacity-[${n}]`);
      return true;
    }
    case "backgroundColor":
      ctx.classes.push(utility(ctx, "bg", sv, "color", NAMESPACES.bg));
      return true;
    case "backgroundImage":
      if (/^(none|url\(|(repeating-)?(linear|radial|conic)-gradient\()/i.test(sv)) {
        ctx.classes.push(sv === "none" ? "bg-none" : `bg-[${arb(sv)}]`);
        return true;
      }
      return false;
    case "color":
      ctx.classes.push(utility(ctx, "text", sv, "color", NAMESPACES.text));
      return true;
    case "borderColor":
      ctx.classes.push(utility(ctx, "border", sv, "color", NAMESPACES.border));
      return true;
    case "outlineColor":
      ctx.classes.push(utility(ctx, "outline", sv, "color", NAMESPACES.outline));
      return true;
    case "fill":
    case "stroke":
      if (sv === "none") ctx.classes.push(`${key}-none`);
      else ctx.classes.push(utility(ctx, key, sv, "color", NAMESPACES[key]));
      return true;
    case "fontSize":
      ctx.classes.push(utility(ctx, "text", v, "length", NAMESPACES.fontSize));
      return true;
    case "fontWeight": {
      if (varName(sv)) {
        ctx.classes.push(utility(ctx, "font", sv, "number", NAMESPACES.fontWeight));
        return true;
      }
      const w = FONT_WEIGHTS[sv];
      ctx.classes.push(w ? `font-${w}` : `font-[${arb(sv)}]`);
      return true;
    }
    case "fontFamily":
      ctx.classes.push(utility(ctx, "font", sv, "family", NAMESPACES.font));
      return true;
    case "lineHeight": {
      const val = typeof v === "number" ? String(v) : sv;
      ctx.classes.push(utility(ctx, "leading", val, "length", NAMESPACES.leading));
      return true;
    }
    case "letterSpacing":
      ctx.classes.push(utility(ctx, "tracking", v, "length", NAMESPACES.tracking));
      return true;
    case "boxShadow":
      if (sv === "none") ctx.classes.push("shadow-none");
      else ctx.classes.push(utility(ctx, "shadow", sv, "any", NAMESPACES.shadow));
      return true;
    case "aspectRatio":
      ctx.classes.push(aspectClass(v));
      return true;
    case "rotate":
      ctx.classes.push(typeof v === "number" ? `rotate-[${v}deg]` : `rotate-[${arb(sv)}]`);
      return true;
    case "outlineWidth":
      ctx.classes.push(sv === "1px" || v === 1 ? "outline" : utility(ctx, "outline", v, "length", []));
      return true;
    case "outlineOffset":
      ctx.classes.push(utility(ctx, "outline-offset", v, "length", []));
      return true;
    default:
      return false;
  }
}

/**
 * StyleMap → Tailwind v4 classes. Token-aware: `var(--color-primary)` becomes `bg-primary` when a token named
 * `--color-primary` exists, otherwise `bg-(--color-primary)`. Anything without a mapping stays in `rest`.
 */
export function stylesToTailwind(styles: StyleMap, tokens: Token[]): TailwindResult {
  const ctx: Ctx = { tokens: new Set(tokens.map((t) => t.name)), classes: [] };
  const rest: StyleMap = {};
  for (const [key, value] of Object.entries(styles)) {
    if (value === "" || value === null || value === undefined) continue;
    const before = ctx.classes.length;
    let ok = false;
    try {
      ok = mapOne(ctx, key, value);
    } catch {
      ok = false;
    }
    if (!ok) {
      ctx.classes.length = before;
      rest[key] = value;
    }
  }
  const classes = ctx.classes.filter((c, i) => ctx.classes.indexOf(c) === i);
  return { classes, rest };
}
