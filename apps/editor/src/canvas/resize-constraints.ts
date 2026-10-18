// Constraint patches for inspector and MCP style writes. Canvas drags use their start-of-gesture snapshot.
import type { FoldDocument, NodeId, StyleValue } from "@opencrease/model";
import { constraintPatches, type ChildBox, type Size } from "./constraints";
import type { Rect } from "./geometry";
import { pxValue } from "./selection-logic";

type Patch = Record<string, StyleValue | null>;
export function resizeConstraintPatches(doc: FoldDocument, id: NodeId, patch: Patch, measure: (id: NodeId) => Rect | null) {
  const node = doc.nodes[id];
  if (!node || !("width" in patch || "height" in patch)) return [];
  const rect = measure(id);
  const size = (key: "width" | "height") => pxValue(node.styles[key]) ?? rect?.[key];
  const width = size("width"), height = size("height");
  if (width === undefined || height === undefined) return [];
  const from: Size = { width, height };
  const to: Size = { width: pxValue(patch.width ?? undefined) ?? width, height: pxValue(patch.height ?? undefined) ?? height };
  const box = (cid: NodeId): ChildBox | null => {
    const child = doc.nodes[cid];
    const parent = child?.parentId ? doc.nodes[child.parentId] : undefined;
    if (!child || !parent) return null;
    const cr = measure(cid), pr = measure(parent.id);
    const cw = pxValue(child.styles.width) ?? cr?.width;
    const ch = pxValue(child.styles.height) ?? cr?.height;
    const pw = pxValue(parent.styles.width) ?? pr?.width;
    const ph = pxValue(parent.styles.height) ?? pr?.height;
    if (cw === undefined || ch === undefined || pw === undefined || ph === undefined) return null;
    return {
      left: pxValue(child.styles.left) ?? (pxValue(child.styles.right) !== undefined ? pw - pxValue(child.styles.right)! - cw : cr && pr ? cr.x - pr.x : 0),
      top: pxValue(child.styles.top) ?? (pxValue(child.styles.bottom) !== undefined ? ph - pxValue(child.styles.bottom)! - ch : cr && pr ? cr.y - pr.y : 0),
      width: cw, height: ch,
    };
  };
  return constraintPatches(doc, id, from, to, box);
}
