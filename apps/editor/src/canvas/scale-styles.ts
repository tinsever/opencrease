// Scale tool (K): scale a layer's styles proportionally, its descendants included: sizes, positions of
// absolute children, font sizes, line heights, letter spacing in px, padding, gap, radius, borders,
// outlines, shadows and blur. Unitless values, percentages, em and tokens are left alone.
import { UNITLESS_PROPERTIES } from "@opencrease/css";
import type { FoldDocument, NodeId, StyleMap, StyleValue } from "@opencrease/model";

/** Keys never scaled even if they contain px (they do not describe lengths). */
const NEVER = new Set(["opacity", "zIndex", "fontWeight", "flexGrow", "flexShrink", "order", "rotate", "aspectRatio", "lineClamp", "WebkitLineClamp"]);
/** Keys the caller sets itself on the scaled layer (its own box). */
export const OWN_BOX_KEYS = ["left", "top", "right", "bottom", "width", "height"];

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Scale every `px` length inside a CSS value string. */
export function scaleCssLengths(value: string, k: number): string {
  return value.replace(/(-?\d*\.?\d+)px\b/g, (_m, n: string) => `${r2(Number(n) * k)}px`);
}

/** One value: numbers are px unless the property is unitless; strings get their px lengths scaled. */
export function scaleValue(key: string, value: StyleValue, k: number): StyleValue {
  if (NEVER.has(key)) return value;
  if (typeof value === "number") return UNITLESS_PROPERTIES.has(key) && key !== "strokeWidth" ? value : r2(value * k);
  if (/var\(/.test(value) && !/px/.test(value)) return value;
  return scaleCssLengths(value, k);
}

/** Patch scaling a style map by `k`. `skip` lists keys left untouched (the layer's own box). */
export function scaleStyles(styles: StyleMap, k: number, skip: readonly string[] = []): Record<string, StyleValue> {
  const out: Record<string, StyleValue> = {};
  for (const [key, value] of Object.entries(styles)) {
    if (skip.includes(key)) continue;
    const next = scaleValue(key, value, k);
    if (next !== value) out[key] = next;
  }
  return out;
}

/** Patches for a layer and all its descendants. The layer's own box keys are skipped. */
export function scaleSubtree(doc: FoldDocument, id: NodeId, k: number): Array<{ id: NodeId; styles: Record<string, StyleValue> }> {
  const out: Array<{ id: NodeId; styles: Record<string, StyleValue> }> = [];
  const walk = (nid: NodeId, root: boolean) => {
    const n = doc.nodes[nid];
    if (!n) return;
    const styles = scaleStyles(n.styles, k, root ? OWN_BOX_KEYS : []);
    if (Object.keys(styles).length) out.push({ id: nid, styles });
    for (const c of n.children) walk(c, false);
  };
  walk(id, true);
  return out;
}
