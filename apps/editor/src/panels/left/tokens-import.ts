// Parse pasted CSS custom properties (":root { --x: y }" or "@theme { ... }") into token drafts.
import { parseColor } from "@opencrease/css";
import type { TokenType } from "@opencrease/model";

export interface TokenDraft {
  name: string;
  type: TokenType;
  value: string | number;
}

export function inferTokenType(name: string, value: string): TokenType {
  const n = name.toLowerCase();
  const v = value.trim();
  if (/^--(color|colour|clr|bg|fg|surface|text-color)/.test(n) || (parseColor(v) && !/^\d/.test(v))) return "color";
  if (/^--(font-weight|weight|fw)/.test(n)) return "fontWeight";
  if (/^--(leading|line-height|lh)/.test(n)) return "lineHeight";
  if (/^--(tracking|letter-spacing|ls)/.test(n)) return "letterSpacing";
  if (/^--(text|font-size|fs)-/.test(n)) return "fontSize";
  if (/^--(font|family|ff)/.test(n)) return "fontFamily";
  if (/^--(radius|rounded|radii)/.test(n)) return "radius";
  if (/^--(opacity|alpha)/.test(n)) return "opacity";
  if (/^--(container|max-width)/.test(n)) return "container";
  if (/^--(breakpoint|screen|bp)/.test(n)) return "breakpoint";
  if (/^var\(/.test(v)) return "color";
  return "spacing";
}

const PX_TYPES = new Set<TokenType>(["spacing", "radius", "fontSize", "container", "breakpoint"]);

export function parseCssTokens(css: string): TokenDraft[] {
  const out: TokenDraft[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /(--[\w-]+)\s*:\s*([^;{}]+);?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1];
    const raw = m[2].trim();
    if (!raw) continue;
    const type = inferTokenType(name, raw);
    const px = /^(-?\d*\.?\d+)px$/.exec(raw);
    let value: string | number = raw;
    if (px && PX_TYPES.has(type)) value = Number(px[1]);
    else if (/^-?\d*\.?\d+$/.test(raw) && (type === "fontWeight" || type === "opacity" || type === "lineHeight")) value = Number(raw);
    out.push({ name, type, value });
  }
  return out;
}
