// Fixed / Hug / Fill sizing intent from styles, and the patches that set an intent.
import type { OFNode, StyleValue } from "@opencrease/model";

export type SizeIntent = "fixed" | "hug" | "fill";
export type Axis = "width" | "height";

export function isFlex(node: OFNode | undefined): boolean {
  const d = node?.styles.display;
  return d === "flex" || d === "inline-flex";
}

export function flexDirection(node: OFNode | undefined): "row" | "column" {
  const d = String(node?.styles.flexDirection ?? "row");
  return d.startsWith("column") ? "column" : "row";
}

/** Positioned out of flow: artboards (parent is Root) and position absolute/fixed nodes. */
export function isAbsolute(node: OFNode, parent: OFNode | undefined): boolean {
  if (!parent || parent.type === "Root") return true;
  const p = node.styles.position;
  return p === "absolute" || p === "fixed";
}

function isMainAxis(parent: OFNode | undefined, axis: Axis): boolean {
  return (flexDirection(parent) === "row") === (axis === "width");
}

export function sizeIntent(node: OFNode, parent: OFNode | undefined, axis: Axis): SizeIntent {
  const v = node.styles[axis] as StyleValue | undefined;
  const abs = isAbsolute(node, parent);
  const flexParent = !abs && isFlex(parent);
  if (typeof v === "number") return "fixed";
  if (typeof v === "string" && v !== "" && v !== "auto") {
    if (/^(fit|max|min)-content$/.test(v)) return "hug";
    if (v === "100%") return "fill";
    return "fixed";
  }
  if (flexParent) {
    if (isMainAxis(parent, axis)) return Number(node.styles.flexGrow ?? 0) >= 1 ? "fill" : "hug";
    const align = String(node.styles.alignSelf ?? parent?.styles.alignItems ?? "stretch");
    return align === "stretch" || align === "normal" ? "fill" : "hug";
  }
  if (abs) return "hug";
  // block flow: divs fill the width and hug the height
  return axis === "width" ? "fill" : "hug";
}

/** Style patch to switch an axis to an intent. `measured` is the current rendered size (for Fixed). */
export function sizePatch(intent: SizeIntent, node: OFNode, parent: OFNode | undefined, axis: Axis, measured: number | null): Record<string, StyleValue | null> {
  const abs = isAbsolute(node, parent);
  const flexParent = !abs && isFlex(parent);
  const main = flexParent && isMainAxis(parent, axis);
  const cross = flexParent && !main;
  const patch: Record<string, StyleValue | null> = {};
  if (main) {
    patch.flexGrow = null;
    patch.flexBasis = null;
  }
  if (cross && node.styles.alignSelf === "stretch") patch.alignSelf = null;
  switch (intent) {
    case "fixed":
      patch[axis] = Math.round(measured ?? (typeof node.styles[axis] === "number" ? (node.styles[axis] as number) : 100));
      if (main) patch.flexShrink = 0;
      break;
    case "hug":
      patch[axis] = "fit-content";
      if (main) patch.flexShrink = null;
      break;
    case "fill":
      if (main) {
        patch[axis] = null;
        patch.flexGrow = 1;
        patch.flexBasis = 0;
        patch.flexShrink = null;
      } else if (cross) {
        patch[axis] = null;
        patch.alignSelf = "stretch";
      } else {
        patch[axis] = "100%";
      }
      break;
  }
  return patch;
}

export const INTENT_LABEL: Record<SizeIntent, string> = { fixed: "Fixed", hug: "Hug", fill: "Fill" };
