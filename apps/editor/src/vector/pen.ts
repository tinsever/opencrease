// Pen tool and shape tools: draw paths point by point, or drag out lines, ellipses, polygons and stars.
// Results are fitted SVG layers inserted where the drawing started.
import type { NodeId, NodeTree } from "@opencrease/model";
import { getActiveFile, getState, setSelection, setTool, type Tool } from "../state/workspace";
import { beginDrag } from "../canvas/interactions";
import { containerAt } from "../canvas/hit";
import { containingBlockOrigin, pageRootId } from "../canvas/insert";
import { clientToLocal, getViewportLive, screenToWorld } from "../canvas/registry";
import { isContainer } from "../canvas/selection-logic";
import { dist, type Anchor, type Pt } from "./path";
import { DEFAULT_STROKE, DEFAULT_STROKE_WIDTH, padBounds, pathTree, shapeTree, type ShapeKind } from "./shapes";
import { snapValue, vectorUi, type ShapeDraft } from "./state";

const DRAG_THRESHOLD = 3;
const CLOSE_PX = 7;

/** Tools that draw editable SVG primitives. */
export const SVG_SHAPE_TOOLS = ["rect", "line", "ellipse", "polygon", "star"] as const;
export type SvgShapeTool = (typeof SVG_SHAPE_TOOLS)[number];

export function isSvgShapeTool(tool: Tool | string): tool is SvgShapeTool {
  return (SVG_SHAPE_TOOLS as readonly string[]).includes(tool);
}

// ------------------------------------------------------------------ inserting

/** Insert a tree at a world position inside `containerId` (absolute child) or on the page. */
export function insertVectorAt(tree: NodeTree, origin: Pt, containerId: NodeId | null, label: string): NodeId | null {
  const file = getActiveFile();
  if (!file) return null;
  const doc = file.store.doc;
  const rootId = pageRootId(doc, file.activePageId);
  if (!rootId) return null;
  const container = containerId ? doc.nodes[containerId] : undefined;
  const parentId = container && isContainer(container) && container.type !== "Root" ? container.id : rootId;
  const round = (n: number) => Math.round(n * 100) / 100;
  let styles = { ...tree.styles };
  if (parentId === rootId) styles = { ...styles, left: round(origin.x), top: round(origin.y) };
  else {
    const o = containingBlockOrigin(parentId);
    styles = { ...styles, position: "absolute", left: round(origin.x - o.x), top: round(origin.y - o.y) };
  }
  const [id] = file.store.transact(label, (tx) => tx.insertTrees(parentId, [{ ...tree, styles }]));
  setSelection(file.id, [id]);
  return id;
}

// ------------------------------------------------------------------ pen

function worldAt(e: { clientX: number; clientY: number }): Pt {
  const w = screenToWorld({ x: e.clientX, y: e.clientY });
  return { x: snapValue(w.x), y: snapValue(w.y) };
}

/** Constrain `p` to 45° steps around `from`. */
function constrain45(from: Pt, p: Pt): Pt {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const d = Math.hypot(dx, dy);
  return { x: from.x + Math.cos(angle) * d, y: from.y + Math.sin(angle) * d };
}

function screenDist(a: Pt, b: Pt): number {
  return dist(a, b) * getViewportLive().zoom;
}

function updatePen(patch: Partial<NonNullable<ReturnType<typeof vectorUi.get>["pen"]>>) {
  const pen = vectorUi.get().pen;
  if (pen) vectorUi.set({ pen: { ...pen, ...patch } });
}

export function penPointerDown(e: PointerEvent) {
  const file = getActiveFile();
  if (!file) return;
  let pen = vectorUi.get().pen;
  if (pen && pen.fileId !== file.id) pen = null;
  let p = worldAt(e);
  if (!pen) {
    pen = { fileId: file.id, anchors: [], cursor: p, closing: false, containerId: containerAt(file.store.doc, e.clientX, e.clientY) };
  }
  const anchors = pen.anchors.map((a) => ({ ...a }));
  const start = clientToLocal({ x: e.clientX, y: e.clientY });

  // clicking the first point closes the path (dragging shapes its handles)
  if (anchors.length >= 2 && screenDist(anchors[0], p) <= CLOSE_PX) {
    const first = anchors[0];
    vectorUi.set({ pen: { ...pen, anchors } });
    let dragged = false;
    beginDrag({
      move(ev) {
        const local = clientToLocal({ x: ev.clientX, y: ev.clientY });
        if (!dragged && Math.hypot(local.x - start.x, local.y - start.y) < DRAG_THRESHOLD) return;
        dragged = true;
        const h = worldAt(ev);
        const next = anchors.map((a) => ({ ...a }));
        next[0] = { ...first, out: h, in: ev.altKey ? first.in : { x: 2 * first.x - h.x, y: 2 * first.y - h.y } };
        updatePen({ anchors: next });
      },
      up() {
        finishPen(true);
      },
      cancel() {
        updatePen({ anchors });
      },
    });
    return;
  }

  const last = anchors[anchors.length - 1];
  if (last && e.shiftKey) {
    p = constrain45(last, p);
    p = { x: snapValue(p.x), y: snapValue(p.y) };
  }
  const anchor: Anchor = { x: p.x, y: p.y, in: null, out: null };
  anchors.push(anchor);
  vectorUi.set({ pen: { ...pen, anchors, cursor: p, closing: false } });
  let dragged = false;
  beginDrag({
    move(ev) {
      const local = clientToLocal({ x: ev.clientX, y: ev.clientY });
      if (!dragged && Math.hypot(local.x - start.x, local.y - start.y) < DRAG_THRESHOLD) return;
      dragged = true;
      const h = worldAt(ev);
      const next = anchors.map((a) => ({ ...a }));
      const a = next[next.length - 1];
      a.out = h;
      a.in = ev.altKey ? a.in : { x: 2 * a.x - h.x, y: 2 * a.y - h.y };
      updatePen({ anchors: next, cursor: h });
    },
    up() {},
    cancel() {
      updatePen({ anchors: anchors.slice(0, -1) });
    },
  });
}

/** Hover feedback for the pen: rubber band and the close target. */
export function penPointerMove(e: PointerEvent) {
  const pen = vectorUi.get().pen;
  if (!pen || getState().tool !== "pen") return;
  let p = worldAt(e);
  const last = pen.anchors[pen.anchors.length - 1];
  if (last && e.shiftKey) p = constrain45(last, p);
  const closing = pen.anchors.length >= 2 && screenDist(pen.anchors[0], p) <= CLOSE_PX;
  updatePen({ cursor: p, closing });
}

/** Finish the path being drawn. Fewer than two points cancels it. */
export function finishPen(closed = false): NodeId | null {
  const pen = vectorUi.get().pen;
  vectorUi.set({ pen: null });
  if (!pen || pen.anchors.length < 2) return null;
  const file = getActiveFile();
  if (!file || file.id !== pen.fileId) return null;
  const built = pathTree([{ anchors: pen.anchors, closed }], { fill: "none", stroke: DEFAULT_STROKE, "stroke-width": String(DEFAULT_STROKE_WIDTH) }, "Path");
  if (!built) return null;
  const id = insertVectorAt(built.tree, built.origin, pen.containerId, "Draw path");
  setTool("move");
  return id;
}

export function cancelPen() {
  vectorUi.set({ pen: null });
}

/** Backspace while drawing removes the last point. */
export function penUndoPoint() {
  const pen = vectorUi.get().pen;
  if (!pen) return;
  if (pen.anchors.length <= 1) vectorUi.set({ pen: null });
  else updatePen({ anchors: pen.anchors.slice(0, -1) });
}

// ------------------------------------------------------------------ shape tools

const DEFAULT_SHAPE_SIZE = 100;

export function beginShapeDraw(e: PointerEvent, kind: SvgShapeTool) {
  const file = getActiveFile();
  if (!file) return;
  const container = containerAt(file.store.doc, e.clientX, e.clientY);
  const w0 = screenToWorld({ x: e.clientX, y: e.clientY });
  const a = { x: Math.round(w0.x), y: Math.round(w0.y) };
  const start = clientToLocal({ x: e.clientX, y: e.clientY });
  let draft: ShapeDraft | null = null;
  beginDrag({
    move(ev) {
      const local = clientToLocal({ x: ev.clientX, y: ev.clientY });
      if (!draft && Math.hypot(local.x - start.x, local.y - start.y) < DRAG_THRESHOLD) return;
      const w = screenToWorld({ x: ev.clientX, y: ev.clientY });
      let b = { x: Math.round(w.x), y: Math.round(w.y) };
      let from = a;
      if (kind === "line") {
        if (ev.shiftKey) b = constrain45(a, b);
      } else {
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        if (ev.shiftKey) {
          const s = Math.max(Math.abs(dx), Math.abs(dy));
          dx = Math.sign(dx || 1) * s;
          dy = Math.sign(dy || 1) * s;
        }
        b = { x: a.x + dx, y: a.y + dy };
        if (ev.altKey) from = { x: a.x - dx, y: a.y - dy };
      }
      draft = { kind, a: from, b };
      vectorUi.set({ shape: draft });
    },
    up() {
      vectorUi.set({ shape: null });
      const d = draft ?? { kind, a, b: kind === "line" ? { x: a.x + DEFAULT_SHAPE_SIZE, y: a.y } : { x: a.x + DEFAULT_SHAPE_SIZE, y: a.y + DEFAULT_SHAPE_SIZE } };
      insertShape(d, container);
      vectorUi.set({ lastShape: kind });
      setTool("move");
    },
    cancel() {
      vectorUi.set({ shape: null });
    },
  });
}

const SHAPE_LABELS: Record<ShapeKind, string> = { rect: "Add rectangle", line: "Add line", ellipse: "Add ellipse", polygon: "Add polygon", star: "Add star" };

export function insertShape(d: ShapeDraft, containerId: NodeId | null): NodeId | null {
  if (d.kind === "line") {
    const raw = { x: Math.min(d.a.x, d.b.x), y: Math.min(d.a.y, d.b.y), width: Math.abs(d.b.x - d.a.x), height: Math.abs(d.b.y - d.a.y) };
    const box = padBounds(raw);
    const tree = shapeTree("line", box.width, box.height, {
      a: { x: d.a.x - box.x, y: d.a.y - box.y },
      b: { x: d.b.x - box.x, y: d.b.y - box.y },
    });
    return insertVectorAt(tree, { x: box.x, y: box.y }, containerId, SHAPE_LABELS.line);
  }
  const x = Math.min(d.a.x, d.b.x);
  const y = Math.min(d.a.y, d.b.y);
  const w = Math.max(1, Math.abs(d.b.x - d.a.x));
  const h = Math.max(1, Math.abs(d.b.y - d.a.y));
  return insertVectorAt(shapeTree(d.kind, w, h), { x, y }, containerId, SHAPE_LABELS[d.kind]);
}
