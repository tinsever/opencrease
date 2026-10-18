import { mapColorsInValue, parseColor } from "@opencrease/css";
import { resolveToken, type FoldDocument } from "@opencrease/model";
import { colorAlpha, colorBase } from "../inspector/fills";
import { literalToOklch } from "./color-format";
import type { Oklch } from "./oklch";

/** Resolve var() chains to a literal colour for display. */
export function resolveColor(doc: FoldDocument | undefined, value: string): string {
  return mapColorsInValue(value, (color) => {
    const m = /^var\(\s*(--[\w-]+)/.exec(color);
    if (m && doc) {
      const resolved = resolveToken(doc, m[1]);
      if (resolved !== undefined) return String(resolved);
    }
    return undefined;
  });
}

/** True when the browser accepts `value` as a CSS colour (any syntax it supports, incl. color-mix()). */
export function isCssColor(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (parseColor(v)) return true;
  return typeof CSS !== "undefined" && CSS.supports("color", v);
}

let probe: HTMLElement | null = null;
/** A colour the browser computes for `value` (color-mix(), light-dark(), system colours), as a literal culori parses. */
export function computeCssColor(value: string): string | null {
  if (parseColor(value)) return value;
  if (typeof document === "undefined" || !isCssColor(value)) return null;
  probe ??= Object.assign(document.createElement("span"), { hidden: true });
  if (!probe.isConnected) document.body.appendChild(probe);
  probe.style.color = "";
  probe.style.color = value;
  const out = getComputedStyle(probe).color;
  return out && parseColor(out) ? out : null;
}

export function toOklchValue(doc: FoldDocument | undefined, value: string): Oklch | null {
  const lit = resolveColor(doc, colorBase(value));
  const computed = computeCssColor(lit);
  if (!computed) return null;
  const opacity = colorBase(value).trim() !== value.trim() ? colorAlpha(value) : 1;
  return literalToOklch(computed, opacity * (literalToOklch(computed)?.a ?? 1));
}
