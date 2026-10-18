// Align, distribute and tidy up for the current selection (inspector header, command palette, canvas
// menu). They move positioned layers (artboards and absolute children); flow children are laid out by
// their parent and stay put. One layer aligns to its parent.
import { parentDelta } from "./measure-dom";
import type { NodeId } from "@opencrease/model";
import { getActiveFile } from "../state/workspace";
import { alignOffsets, distributeOffsets, tidyOffsets, type AlignKind, type DistributeAxis } from "./arrange";
import type { Point, Rect } from "./geometry";
import { getNodeElement, getWorldRect } from "./registry";
import { isAbsolutelyPositioned, isLockedDeep, pxValue, topmostOnly } from "./selection-logic";

export type ArrangeAction = { kind: "align"; align: AlignKind } | { kind: "distribute"; axis: DistributeAxis } | { kind: "tidy" };

interface Ctx {
  ids: NodeId[];
  rects: Rect[];
  parent: Rect | null;
}

function context(): Ctx | null {
  const file = getActiveFile();
  if (!file) return null;
  const doc = file.store.doc;
  const ids = topmostOnly(doc, file.selection).filter((id) => {
    const n = doc.nodes[id];
    return n && n.type !== "Root" && !isLockedDeep(doc, id) && isAbsolutelyPositioned(doc, n);
  });
  const rects: Rect[] = [];
  const kept: NodeId[] = [];
  for (const id of ids) {
    const r = getWorldRect(id);
    if (r) {
      rects.push(r);
      kept.push(id);
    }
  }
  if (kept.length === 0) return null;
  let parent: Rect | null = null;
  if (kept.length === 1) {
    const p = doc.nodes[kept[0]].parentId;
    parent = p && doc.nodes[p]?.type !== "Root" ? getWorldRect(p) : null;
  }
  return { ids: kept, rects, parent };
}

/** Whether an action would do anything for the current selection (for disabling buttons). */
export function canArrange(action: ArrangeAction): boolean {
  const c = context();
  if (!c) return false;
  if (action.kind === "align") return c.ids.length > 1 || !!c.parent;
  if (action.kind === "distribute") return c.ids.length > 2;
  return c.ids.length > 1;
}

function offsets(c: Ctx, action: ArrangeAction): Point[] {
  if (action.kind === "align") return alignOffsets(c.rects, action.align, c.ids.length === 1 ? c.parent : undefined);
  if (action.kind === "distribute") return distributeOffsets(c.rects, action.axis);
  return tidyOffsets(c.rects);
}

const LABEL: Record<string, string> = {
  left: "Align left", hcenter: "Align centre", right: "Align right", top: "Align top", vcenter: "Align middle", bottom: "Align bottom",
  horizontal: "Distribute horizontally", vertical: "Distribute vertically", tidy: "Tidy up",
};

export function arrangeLabel(action: ArrangeAction): string {
  return LABEL[action.kind === "align" ? action.align : action.kind === "distribute" ? action.axis : "tidy"];
}

/** Run an action as one undo step. Returns false when nothing moved. */
export function arrangeSelection(action: ArrangeAction): boolean {
  const file = getActiveFile();
  const c = context();
  if (!file || !c || !canArrange(action)) return false;
  const deltas = offsets(c, action);
  if (deltas.every((d) => Math.abs(d.x) < 0.01 && Math.abs(d.y) < 0.01)) return false;
  file.store.transact(arrangeLabel(action), (tx) => {
    c.ids.forEach((id, i) => {
      const d = parentDelta(file.store.doc, id, deltas[i]);
      if (Math.abs(d.x) < 0.01 && Math.abs(d.y) < 0.01) return;
      const node = tx.doc.nodes[id];
      const el = getNodeElement(id);
      const left = pxValue(node.styles.left) ?? (el instanceof HTMLElement ? el.offsetLeft : 0);
      const top = pxValue(node.styles.top) ?? (el instanceof HTMLElement ? el.offsetTop : 0);
      tx.setStyles(id, { left: Math.round((left + d.x) * 100) / 100, top: Math.round((top + d.y) * 100) / 100, right: null, bottom: null });
    });
  });
  return true;
}

export const ALIGN_ACTIONS: ArrangeAction[] = (["left", "hcenter", "right", "top", "vcenter", "bottom"] as AlignKind[]).map((align) => ({ kind: "align", align }));
export const DISTRIBUTE_ACTIONS: ArrangeAction[] = [
  { kind: "distribute", axis: "horizontal" },
  { kind: "distribute", axis: "vertical" },
  { kind: "tidy" },
];
