// Constraints: how absolutely positioned children follow their parent when it is resized (SPEC §4.3).
// Pure math plus a document walk that takes a measuring callback, so the canvas, the inspector and the
// agent tools share one implementation.
import type { Constraints, FoldDocument, HorizontalConstraint, NodeId, OFNode, StyleValue, VerticalConstraint } from "@opencrease/model";
import { pxValue } from "./selection-logic";

export type AxisConstraint = HorizontalConstraint | VerticalConstraint;

export const DEFAULT_CONSTRAINTS: Constraints = { horizontal: "left", vertical: "top" };

/** Child box relative to the parent's padding box (CSS containing block), world units. */
export interface ChildBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Normalise "top"/"bottom" to the start/end vocabulary of one axis. */
function role(c: AxisConstraint): "start" | "end" | "center" | "scale" | "stretch" {
  if (c === "left" || c === "top") return "start";
  if (c === "right" || c === "bottom") return "end";
  return c;
}

/** One axis: start offset and size inside a parent going from `oldParent` to `newParent`. */
export function constrainAxis(c: AxisConstraint, start: number, size: number, oldParent: number, newParent: number): { start: number; size: number } {
  const d = newParent - oldParent;
  switch (role(c)) {
    case "start":
      return { start, size };
    case "end":
      return { start: start + d, size };
    case "center":
      return { start: start + d / 2, size };
    case "scale": {
      const k = oldParent > 0 ? newParent / oldParent : 1;
      return { start: start * k, size: size * k };
    }
    case "stretch":
      return { start, size: Math.max(0, size + d) };
  }
}

export function constrainBox(box: ChildBox, c: Constraints, from: Size, to: Size): ChildBox {
  const h = constrainAxis(c.horizontal, box.left, box.width, from.width, to.width);
  const v = constrainAxis(c.vertical, box.top, box.height, from.height, to.height);
  return { left: h.start, top: v.start, width: h.size, height: v.size };
}

export function constraintsOf(node: OFNode | undefined): Constraints {
  return node?.constraints ?? DEFAULT_CONSTRAINTS;
}

export function isDefaultConstraints(c: Constraints): boolean {
  return c.horizontal === "left" && c.vertical === "top";
}

/** Children that constraints apply to: absolutely positioned, visible or not. */
export function constrainedChildren(doc: FoldDocument, parentId: NodeId): OFNode[] {
  const parent = doc.nodes[parentId];
  if (!parent) return [];
  return parent.children
    .map((id) => doc.nodes[id])
    .filter((n): n is OFNode => !!n && (n.styles.position === "absolute" || n.styles.position === "fixed") && !isDefaultConstraints(constraintsOf(n)));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function has(v: StyleValue | undefined): boolean {
  return v !== undefined && v !== "";
}

/**
 * Style patch moving a child from `before` to `after`, written in the child's own anchoring: a child
 * placed with `right` keeps using `right`, one placed with `left` keeps `left`, and stretch children
 * pinned on both sides keep both insets without a width.
 */
export function boxPatch(node: OFNode, before: ChildBox, after: ChildBox, parentAfter: Size): Record<string, StyleValue | null> {
  const s = node.styles;
  const patch: Record<string, StyleValue | null> = {};
  const both = (a: string, b: string, size: string) => has(s[a]) && has(s[b]) && !has(s[size]);

  if (both("left", "right", "width")) {
    // insets on both sides: the browser stretches it, only rewrite the insets when they change
    if (r2(after.left) !== r2(before.left)) patch.left = r2(after.left);
    const right = parentAfter.width - after.left - after.width;
    if (pxValue(s.right) === undefined || Math.abs(right - (pxValue(s.right) ?? 0)) > 0.01) patch.right = r2(right);
  } else {
    if (has(s.right) && !has(s.left)) {
      const right = parentAfter.width - after.left - after.width;
      if (Math.abs(right - (pxValue(s.right) ?? Number.NaN)) > 0.01) patch.right = r2(right);
    } else if (Math.abs(after.left - before.left) > 0.01 || !has(s.left)) {
      patch.left = r2(after.left);
    }
    if (Math.abs(after.width - before.width) > 0.01) patch.width = r2(after.width);
  }

  if (both("top", "bottom", "height")) {
    if (r2(after.top) !== r2(before.top)) patch.top = r2(after.top);
    const bottom = parentAfter.height - after.top - after.height;
    if (pxValue(s.bottom) === undefined || Math.abs(bottom - (pxValue(s.bottom) ?? 0)) > 0.01) patch.bottom = r2(bottom);
  } else {
    if (has(s.bottom) && !has(s.top)) {
      const bottom = parentAfter.height - after.top - after.height;
      if (Math.abs(bottom - (pxValue(s.bottom) ?? Number.NaN)) > 0.01) patch.bottom = r2(bottom);
    } else if (Math.abs(after.top - before.top) > 0.01 || !has(s.top)) {
      patch.top = r2(after.top);
    }
    if (Math.abs(after.height - before.height) > 0.01) patch.height = r2(after.height);
  }
  return patch;
}

/**
 * Patches for every constrained descendant when `parentId` goes from `from` to `to` (its padding-box
 * size). Children whose own size changes pass the change on to their constrained children.
 * `measure` returns a child's box relative to its parent's padding box at the start, or null.
 */
export function constraintPatches(
  doc: FoldDocument,
  parentId: NodeId,
  from: Size,
  to: Size,
  measure: (id: NodeId) => ChildBox | null,
  depth = 0,
): Array<{ id: NodeId; styles: Record<string, StyleValue | null> }> {
  if (depth > 32 || (Math.abs(from.width - to.width) < 0.01 && Math.abs(from.height - to.height) < 0.01)) return [];
  const out: Array<{ id: NodeId; styles: Record<string, StyleValue | null> }> = [];
  for (const child of constrainedChildren(doc, parentId)) {
    const box = measure(child.id);
    if (!box) continue;
    const next = constrainBox(box, constraintsOf(child), from, to);
    const styles = boxPatch(child, box, next, to);
    if (Object.keys(styles).length) out.push({ id: child.id, styles });
    if (Math.abs(next.width - box.width) > 0.01 || Math.abs(next.height - box.height) > 0.01) {
      out.push(...constraintPatches(doc, child.id, { width: box.width, height: box.height }, { width: next.width, height: next.height }, measure, depth + 1));
    }
  }
  return out;
}
