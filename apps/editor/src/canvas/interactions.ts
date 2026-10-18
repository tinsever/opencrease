// Pointer interactions on the canvas: pan/zoom, selection, marquee, move, reorder, resize, drawing.
import type { FoldDocument, NodeId, OFNode } from "@opencrease/model";
import { getOpenFile, getState, select, setHover, setSelection, setTool, type OpenFile } from "../state/workspace";
import { handleAxes, rectFromPoints, rectsIntersect, resizeRect, translateRect, unionRects, type Handle, type Point, type Rect } from "./geometry";
import { containerAt, hitIds, innermostAt } from "./hit";
import { containingBlockOrigin, flowInsertIndex, insertLayer, pageRootId, type LayerKind } from "./insert";
import {
  canvasSize, clientToLocal, getNodeElement, getViewportLive, getWorldRect, screenToWorld, setViewportLive,
} from "./registry";
import {
  flexAxis, isAbsolutelyPositioned, isArtboardNode, isContainer, isFlex, isLockedDeep, isRootChild, pickTarget, pxValue,
  sizeIntent, sortByDocumentOrder, topmostOnly,
} from "./selection-logic";
import { snapResize } from "./snapping";
import { smartSnapMove } from "./spacing";
import { applyConstraintsTx, parentDelta, positionDelta, orientedBox, paddingSize, snapshotConstraintBoxes } from "./measure-dom";
import {
  angleStyle, boxBounds, boxContains, boxFromRect, parseAngle, resizeBox, rotatePoint, rotationFromDrag,
  type OrientedBox,
} from "./transform";
import { recordDuplicate } from "./duplicate-repeat";
import { scaleSubtree } from "./scale-styles";
import { getPrefs } from "../state/prefs";
import { commitActiveTextEdit, startTextEdit } from "./text-edit";
import { canvasUi, resetGesture } from "./ui-state";
import { fitRect, MAX_ZOOM, stepZoom, wheelPixels, wheelZoomFactor, zoomAt } from "./viewport-math";
import { vectorDoubleClick, vectorPointerDown } from "../vector/controller";
import { prepareVectorResize } from "../vector/shapes";
import { cropPatch } from "./crop";

const DRAG_THRESHOLD = 3;
const SNAP_PX = 6;

let fileId: string | null = null;

function file(): OpenFile | undefined {
  return getOpenFile(fileId);
}

function rootIdOf(f: OpenFile): NodeId | undefined {
  return pageRootId(f.store.doc, f.activePageId);
}

// ------------------------------------------------------------------ drag plumbing

export interface DragHandlers {
  move(e: PointerEvent): void;
  up(e: PointerEvent): void;
  cancel?(): void;
}

let drag: DragHandlers | null = null;

function onDragMove(e: PointerEvent) {
  drag?.move(e);
}
function onDragUp(e: PointerEvent) {
  const d = drag;
  endDrag();
  d?.up(e);
}
function onDragKey(e: KeyboardEvent) {
  if (e.key === "Escape" && drag) {
    e.preventDefault();
    e.stopPropagation();
    const d = drag;
    endDrag();
    d.cancel?.();
    resetGesture();
  }
}

export function beginDrag(handlers: DragHandlers) {
  endDrag();
  drag = handlers;
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragUp);
  window.addEventListener("pointercancel", onDragUp);
  window.addEventListener("keydown", onDragKey, true);
}

function endDrag() {
  drag = null;
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", onDragUp);
  window.removeEventListener("pointercancel", onDragUp);
  window.removeEventListener("keydown", onDragKey, true);
}

export function isDragging(): boolean {
  return drag !== null;
}

function worldDelta(start: { x: number; y: number }, e: PointerEvent): Point {
  const z = getViewportLive().zoom;
  return { x: (e.clientX - start.x) / z, y: (e.clientY - start.y) / z };
}

function blurFocused() {
  const el = document.activeElement as HTMLElement | null;
  if (el && el !== document.body && typeof el.blur === "function") el.blur();
}

// ------------------------------------------------------------------ snapping targets

function snapTargetsFor(doc: FoldDocument, ids: NodeId[]): Rect[] {
  const moving = new Set(ids);
  const first = doc.nodes[ids[0]];
  const parent = first?.parentId ? doc.nodes[first.parentId] : undefined;
  if (!parent) return [];
  const rects: Rect[] = [];
  if (parent.type !== "Root") {
    const pr = getWorldRect(parent.id);
    if (pr) rects.push(pr);
  }
  for (const id of parent.children) {
    if (moving.has(id) || !doc.nodes[id]?.visible) continue;
    const r = getWorldRect(id);
    if (r) rects.push(r);
  }
  return rects;
}

function startOffset(doc: FoldDocument, id: NodeId): { left: number; top: number } {
  const node = doc.nodes[id];
  const el = getNodeElement(id);
  const left = pxValue(node.styles.left) ?? (el instanceof HTMLElement ? el.offsetLeft : 0);
  const top = pxValue(node.styles.top) ?? (el instanceof HTMLElement ? el.offsetTop : 0);
  return { left, top };
}

// ------------------------------------------------------------------ pan

function beginPan(e: PointerEvent) {
  const start = { x: e.clientX, y: e.clientY };
  const vp0 = getViewportLive();
  canvasUi.set({ gesture: "pan" });
  beginDrag({
    move(ev) {
      setViewportLive({ ...vp0, x: vp0.x + ev.clientX - start.x, y: vp0.y + ev.clientY - start.y });
    },
    up() {
      canvasUi.set({ gesture: "idle" });
    },
    cancel() {
      setViewportLive(vp0);
    },
  });
}

// ------------------------------------------------------------------ marquee

function beginMarquee(e: PointerEvent, scopeId: NodeId, base: NodeId[]) {
  const f = file();
  if (!f) return;
  const doc = f.store.doc;
  const startW = screenToWorld({ x: e.clientX, y: e.clientY });
  const scope = doc.nodes[scopeId];
  const candidates = (scope?.children ?? [])
    .map((id) => doc.nodes[id])
    .filter((n) => n && n.visible && !n.locked)
    .map((n) => ({ id: n.id, rect: getWorldRect(n.id) }))
    .filter((c): c is { id: NodeId; rect: Rect } => !!c.rect);
  const startClient = { x: e.clientX, y: e.clientY };
  let active = false;
  beginDrag({
    move(ev) {
      if (!active) {
        if (Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y) < DRAG_THRESHOLD) return;
        active = true;
        canvasUi.set({ gesture: "marquee" });
      }
      const r = rectFromPoints(startW, screenToWorld({ x: ev.clientX, y: ev.clientY }));
      canvasUi.set({ marquee: r });
      const hits = candidates.filter((c) => rectsIntersect(c.rect, r)).map((c) => c.id);
      setSelection(f.id, [...base, ...hits]);
    },
    up() {
      resetGesture();
    },
    cancel() {
      setSelection(f.id, base);
    },
  });
}

// ------------------------------------------------------------------ move

interface MoveSession {
  update(e: PointerEvent): void;
  finish(e: PointerEvent): void;
  cancel(): void;
}

function startMove(e: PointerEvent, start: Point, primaryId: NodeId): MoveSession | null {
  const f = file();
  if (!f) return null;
  const doc = f.store.doc;
  let ids = sortByDocumentOrder(
    doc,
    topmostOnly(doc, f.selection).filter((id) => {
      const n = doc.nodes[id];
      return n && n.type !== "Root" && n.type !== "SVGElement" && !isLockedDeep(doc, id);
    }),
  );
  if (ids.length === 0) return null;
  const primary = doc.nodes[ids.includes(primaryId) ? primaryId : ids[0]];
  const absolute = isAbsolutelyPositioned(doc, primary);
  ids = ids.filter((id) => {
    const n = doc.nodes[id];
    return absolute ? isAbsolutelyPositioned(doc, n) : !isAbsolutelyPositioned(doc, n) && n.parentId === primary.parentId;
  });
  const mergeKey = `move:${Date.now()}:${Math.random()}`;

  // measure before duplicating: duplicates have the same geometry
  const offsets = ids.map((id) => startOffset(doc, id));
  const rects = ids.map((id) => getWorldRect(id));
  if (e.altKey) {
    const source = ids;
    ids = f.store.transact("Duplicate", (tx) => source.map((id) => tx.duplicateNode(id).newId), { mergeKey });
    setSelection(f.id, ids);
    recordDuplicate(f.id, source, ids);
  }
  canvasUi.set({ gesture: "move" });
  if (absolute) return absoluteMove(f, ids, offsets, rects, start, mergeKey);
  const session = flowMove(f, ids, rects, start, mergeKey);
  return e.altKey ? { ...session, cancel() { session.cancel(); f.store.undo(); } } : session;
}

function absoluteMove(
  f: OpenFile,
  ids: NodeId[],
  offsets: Array<{ left: number; top: number }>,
  rects: Array<Rect | null>,
  start: Point,
  mergeKey: string,
): MoveSession {
  const doc0 = f.store.doc;
  const union = unionRects(rects.filter((r): r is Rect => !!r));
  const targets = snapTargetsFor(doc0, ids);
  const idSet = new Set(ids);
  // page-level layers that are not artboards can be dropped into frames
  const loose = ids.every((id) => {
    const n = doc0.nodes[id];
    return isRootChild(doc0, n) && !isArtboardNode(doc0, n);
  });
  let moved = false;
  let dropTarget: NodeId | null = null;

  return {
    update(ev) {
      let d = worldDelta(start, ev);
      if (ev.shiftKey) d = Math.abs(d.x) > Math.abs(d.y) ? { x: d.x, y: 0 } : { x: 0, y: d.y };
      let sx = 0;
      let sy = 0;
      let guides: ReturnType<typeof smartSnapMove>["guides"] = [];
      let measures: ReturnType<typeof smartSnapMove>["measures"] = [];
      if (union && !(ev.metaKey || ev.ctrlKey)) {
        const snap = smartSnapMove(translateRect(union, d.x, d.y), targets, SNAP_PX / getViewportLive().zoom);
        sx = ev.shiftKey && d.x === 0 ? 0 : snap.dx;
        sy = ev.shiftKey && d.y === 0 ? 0 : snap.dy;
        guides = snap.guides.filter((g) => (g.orientation === "vertical" ? sx !== 0 || snap.dx === 0 : sy !== 0 || snap.dy === 0));
        measures = snap.measures.filter((m) => (m.y1 === m.y2 ? sx === snap.dx : sy === snap.dy));
      }
      f.store.transact(
        "Move",
        (tx) => {
          ids.forEach((id, i) => {
            if (!tx.doc.nodes[id]) return;
            const local = parentDelta(doc0, id, { x: d.x + sx, y: d.y + sy });
            tx.setStyles(id, {
              left: Math.round(offsets[i].left + local.x),
              top: Math.round(offsets[i].top + local.y),
              right: null,
              bottom: null,
            });
          });
        },
        { mergeKey },
      );
      moved = true;
      let insertLine = null;
      dropTarget = null;
      if (loose) {
        const doc = f.store.doc;
        const c = containerAt(doc, ev.clientX, ev.clientY, { exclude: idSet });
        if (c) {
          dropTarget = c;
          if (isFlex(doc.nodes[c])) insertLine = flowInsertIndex(doc, c, screenToWorld({ x: ev.clientX, y: ev.clientY }), idSet).line;
        }
      }
      canvasUi.set({ guides, measures, dropTarget, insertLine });
    },
    finish(ev) {
      resetGesture();
      if (!loose || !dropTarget) return;
      const doc = f.store.doc;
      const target = doc.nodes[dropTarget];
      if (!target || !isContainer(target)) return;
      const pw = screenToWorld({ x: ev.clientX, y: ev.clientY });
      if (isFlex(target)) {
        const { index } = flowInsertIndex(doc, target.id, pw, idSet);
        f.store.transact(
          "Move into frame",
          (tx) => {
            ids.forEach((id, i) => {
              tx.moveNode(id, target.id, index + i);
              tx.setStyles(id, { position: null, left: null, top: null, right: null, bottom: null });
            });
          },
          { mergeKey },
        );
      } else {
        const o = containingBlockOrigin(target.id);
        const now = ids.map((id) => getWorldRect(id));
        f.store.transact(
          "Move into frame",
          (tx) => {
            ids.forEach((id, i) => {
              const r = now[i];
              tx.moveNode(id, target.id);
              tx.setStyles(id, {
                position: "absolute",
                left: r ? Math.round(r.x - o.x) : 0,
                top: r ? Math.round(r.y - o.y) : 0,
              });
            });
          },
          { mergeKey },
        );
      }
    },
    cancel() {
      resetGesture();
      if (moved) f.store.undo();
    },
  };
}

function flowMove(f: OpenFile, ids: NodeId[], rects: Array<Rect | null>, start: Point, mergeKey: string): MoveSession {
  const doc0 = f.store.doc;
  const idSet = new Set(ids);
  const originalParent = doc0.nodes[ids[0]].parentId!;
  const saved = new Map<NodeId, { transform: string; pointerEvents: string; zIndex: string; opacity: string }>();
  let delta: Point = { x: 0, y: 0 };
  let target: NodeId | "page" | null = null;

  const elements = () => ids.map((id) => [id, getNodeElement(id)] as const);

  function resolveTarget(ev: PointerEvent): NodeId | "page" {
    const doc = f.store.doc;
    const hit = innermostAt(doc, ev.clientX, ev.clientY, { exclude: idSet });
    if (!hit) return "page";
    const pw = screenToWorld({ x: ev.clientX, y: ev.clientY });
    let cur: OFNode | undefined = doc.nodes[hit];
    while (cur && cur.type !== "Root") {
      if (isContainer(cur) && !cur.locked) {
        if (cur.parentId === originalParent && cur.id !== originalParent) {
          // a sibling frame only captures the drop in its middle, so reordering past it still works
          const r = getWorldRect(cur.id);
          if (r && pw.x > r.x + r.width * 0.25 && pw.x < r.x + r.width * 0.75 && pw.y > r.y + r.height * 0.25 && pw.y < r.y + r.height * 0.75) {
            return cur.id;
          }
        } else {
          return cur.id;
        }
      }
      cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
    }
    return "page";
  }

  function restore() {
    for (const [id, el] of elements()) {
      const s = saved.get(id);
      if (el && s) {
        el.style.transform = s.transform;
        el.style.pointerEvents = s.pointerEvents;
        el.style.zIndex = s.zIndex;
        el.style.opacity = s.opacity;
      }
    }
  }

  return {
    update(ev) {
      delta = worldDelta(start, ev);
      for (const [id, el] of elements()) {
        if (!el) continue;
        if (!saved.has(id)) {
          saved.set(id, { transform: el.style.transform, pointerEvents: el.style.pointerEvents, zIndex: el.style.zIndex, opacity: el.style.opacity });
        }
        const s = saved.get(id)!;
        el.style.transform = `translate(${delta.x}px, ${delta.y}px) ${s.transform}`.trim();
        el.style.pointerEvents = "none";
        el.style.zIndex = "2147483000";
        el.style.opacity = "0.9";
      }
      target = resolveTarget(ev);
      if (target === "page") {
        canvasUi.set({ dropTarget: null, insertLine: null });
      } else {
        const slot = flowInsertIndex(f.store.doc, target, screenToWorld({ x: ev.clientX, y: ev.clientY }), idSet);
        canvasUi.set({ dropTarget: target === originalParent ? null : target, insertLine: slot.line });
      }
    },
    finish(ev) {
      restore();
      resetGesture();
      const doc = f.store.doc;
      const rootId = rootIdOf(f);
      if (!rootId || !target) return;
      if (target === "page") {
        f.store.transact(
          "Move to page",
          (tx) => {
            ids.forEach((id, i) => {
              const node = tx.doc.nodes[id];
              const r = rects[i];
              if (!node || !r) return;
              const fillW = sizeIntent(doc, doc.nodes[id], "width") === "Fill";
              const fillH = sizeIntent(doc, doc.nodes[id], "height") === "Fill";
              tx.moveNode(id, rootId);
              tx.setStyles(id, {
                position: null,
                right: null,
                bottom: null,
                left: Math.round(r.x + delta.x),
                top: Math.round(r.y + delta.y),
                ...(fillW ? { width: Math.round(r.width), flexGrow: null } : {}),
                ...(fillH ? { height: Math.round(r.height), alignSelf: null } : {}),
              });
            });
          },
          { mergeKey },
        );
        return;
      }
      const t = target;
      const { index } = flowInsertIndex(doc, t, screenToWorld({ x: ev.clientX, y: ev.clientY }), idSet);
      try {
        f.store.transact("Reorder", (tx) => ids.forEach((id, i) => tx.moveNode(id, t, index + i)), { mergeKey });
      } catch (err) {
        console.warn("Move failed", err);
      }
    },
    cancel() {
      restore();
      resetGesture();
    },
  };
}

function beginPress(e: PointerEvent, targetId: NodeId, click: { toggle?: boolean; collapse?: boolean }) {
  const start = { x: e.clientX, y: e.clientY };
  let session: MoveSession | null = null;
  let started = false;
  beginDrag({
    move(ev) {
      if (!started) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
        started = true;
        setHover(null);
        session = startMove(ev, start, targetId);
      }
      session?.update(ev);
    },
    up(ev) {
      if (session) {
        session.finish(ev);
        return;
      }
      if (started) return;
      const f = file();
      if (!f) return;
      if (click.toggle) select([targetId], { toggle: true });
      else if (click.collapse) setSelection(f.id, [targetId]);
    },
    cancel() {
      session?.cancel();
    },
  });
}

/** Pointer down on an artboard label: select it and allow dragging the artboard. */
export function pressArtboardLabel(e: PointerEvent, id: NodeId) {
  const f = file();
  if (!f || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  commitActiveTextEdit();
  blurFocused();
  const doc = f.store.doc;
  if (isLockedDeep(doc, id)) {
    setSelection(f.id, [id]);
    return;
  }
  const already = f.selection.includes(id);
  if (e.shiftKey) {
    if (!already) select([id], { additive: true });
  } else if (!already) setSelection(f.id, [id]);
  beginPress(e, id, { toggle: e.shiftKey && already, collapse: !e.shiftKey && already && f.selection.length > 1 });
}

// ------------------------------------------------------------------ resize, rotate and scale

/** Layers a transform handle acts on: topmost selected layers that can be transformed. */
function transformIds(f: OpenFile): NodeId[] {
  const doc = f.store.doc;
  return sortByDocumentOrder(
    doc,
    topmostOnly(doc, f.selection).filter((id) => {
      const n = doc.nodes[id];
      return n && n.type !== "Root" && n.type !== "SVGElement" && !isLockedDeep(doc, id);
    }),
  );
}

export function beginResize(e: PointerEvent, handle: Handle) {
  const f = file();
  if (!f || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  blurFocused();
  const ids = transformIds(f);
  if (ids.length === 0) return;
  const scaleTool = getState().tool === "scale";
  if (ids.length > 1) {
    beginGroupResize(e, f, ids, handle, scaleTool);
    return;
  }
  const doc = f.store.doc;
  const id = ids[0];
  const node = doc.nodes[id];
  const startRect = getWorldRect(id);
  const box0 = orientedBox(doc, id);
  if (!startRect || !box0) return;
  const rotated = Math.abs(box0.angle) > 0.01;
  const abs = isAbsolutelyPositioned(doc, node);
  const offset = startOffset(doc, id);
  const targets = abs && !rotated ? snapTargetsFor(doc, [id]) : [];
  const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
  const flexParent = parent && isFlex(parent) && !abs ? parent : undefined;
  const mainAxis = flexParent ? (flexAxis(flexParent) === "row" ? "width" : "height") : null;
  const pad0 = paddingSize(doc, id);
  const boxes = scaleTool ? new Map() : snapshotConstraintBoxes(doc, [id]);
  const start = { x: e.clientX, y: e.clientY };
  const mergeKey = `resize:${Date.now()}:${Math.random()}`;
  const { h, v } = handleAxes(handle);
  // fitted vector layers rewrite their geometry instead of stretching
  const vectorResize = prepareVectorResize(doc, id);
  let changed = false;
  canvasUi.set({ gesture: "resize" });

  beginDrag({
    move(ev) {
      const d = worldDelta(start, ev);
      const keepAspect = ev.shiftKey || scaleTool;
      let b: OrientedBox;
      let guides: ReturnType<typeof snapResize>["guides"] = [];
      if (!rotated) {
        let r = resizeRect(startRect, handle, d.x, d.y, { keepAspect, fromCenter: ev.altKey, minSize: 1 });
        if (abs && !keepAspect && !ev.altKey && !(ev.metaKey || ev.ctrlKey)) {
          const snapped = snapResize(r, handle, targets, SNAP_PX / getViewportLive().zoom);
          r = snapped.rect;
          guides = snapped.guides;
        }
        b = boxFromRect(r, 0);
      } else {
        b = resizeBox(box0, handle, d.x, d.y, { keepAspect, fromCenter: ev.altKey, minSize: 1 });
      }
      const styles: Record<string, string | number | null> = {};
      const setW = h !== 0 || keepAspect;
      const setH = v !== 0 || keepAspect;
      if (setW) {
        styles.width = Math.max(1, Math.round(b.width));
        if (mainAxis === "width") styles.flexGrow = null;
        else if (flexParent && node.styles.alignSelf === "stretch") styles.alignSelf = null;
      }
      if (setH) {
        styles.height = Math.max(1, Math.round(b.height));
        if (mainAxis === "height") styles.flexGrow = null;
        else if (flexParent && node.styles.alignSelf === "stretch") styles.alignSelf = null;
      }
      if (abs) {
        const tl = positionDelta(doc, id, box0, b);
        if (Math.abs(tl.x) > 0.001 || ev.altKey) {
          styles.left = Math.round(offset.left + tl.x);
          styles.right = null;
        }
        if (Math.abs(tl.y) > 0.001 || ev.altKey) {
          styles.top = Math.round(offset.top + tl.y);
          styles.bottom = null;
        }
      }
      if (!rotated && (ev.metaKey || ev.ctrlKey)) Object.assign(styles, cropPatch(doc, node, startRect, boxBounds(b)) ?? {});
      const k = h !== 0 ? b.width / Math.max(1, box0.width) : b.height / Math.max(1, box0.height);
      f.store.transact(
        scaleTool ? "Scale" : "Resize",
        (tx) => {
          if (!tx.doc.nodes[id]) return;
          if (scaleTool) for (const p of scaleSubtree(doc, id, k)) tx.setStyles(p.id, p.styles);
          tx.setStyles(id, styles);
          vectorResize?.(tx, Math.round(b.width), Math.round(b.height));
          if (!scaleTool && pad0) {
            const to = { width: pad0.width + (setW ? Math.round(b.width) - box0.width : 0), height: pad0.height + (setH ? Math.round(b.height) - box0.height : 0) };
            applyConstraintsTx(tx, doc, id, pad0, to, boxes);
          }
        },
        { mergeKey },
      );
      changed = true;
      canvasUi.set({ guides, scaling: scaleTool ? k : null });
    },
    up() {
      resetGesture();
    },
    cancel() {
      resetGesture();
      if (changed) f.store.undo();
    },
  });
}

/** Resize (or scale) several layers together: positions and sizes scale with the selection bounds. */
function beginGroupResize(e: PointerEvent, f: OpenFile, ids: NodeId[], handle: Handle, scaleTool: boolean) {
  const doc = f.store.doc;
  const abs = ids.map((id) => isAbsolutelyPositioned(doc, doc.nodes[id]));
  if (!scaleTool && abs.some((a) => !a)) return;
  const boxes0 = ids.map((id) => orientedBox(doc, id));
  if (boxes0.some((b) => !b)) return;
  const boxes = boxes0 as OrientedBox[];
  const union = unionRects(boxes.map(boxBounds))!;
  const offsets = ids.map((id) => startOffset(doc, id));
  const pads = ids.map((id) => paddingSize(doc, id));
  const vectorResizers = ids.map((id) => prepareVectorResize(doc, id));
  const cboxes = scaleTool ? new Map() : snapshotConstraintBoxes(doc, ids);
  const targets = snapTargetsFor(doc, ids);
  const start = { x: e.clientX, y: e.clientY };
  const mergeKey = `resize:${Date.now()}:${Math.random()}`;
  const { h } = handleAxes(handle);
  let changed = false;
  canvasUi.set({ gesture: "resize" });

  beginDrag({
    move(ev) {
      const d = worldDelta(start, ev);
      const keepAspect = ev.shiftKey || scaleTool;
      let u = resizeRect(union, handle, d.x, d.y, { keepAspect, fromCenter: ev.altKey, minSize: 1 });
      let guides: ReturnType<typeof snapResize>["guides"] = [];
      if (!keepAspect && !ev.altKey && !(ev.metaKey || ev.ctrlKey)) {
        const snapped = snapResize(u, handle, targets, SNAP_PX / getViewportLive().zoom);
        u = snapped.rect;
        guides = snapped.guides;
      }
      let sx = u.width / Math.max(1, union.width);
      let sy = u.height / Math.max(1, union.height);
      if (scaleTool) sx = sy = h !== 0 ? sx : sy;
      f.store.transact(
        scaleTool ? "Scale" : "Resize",
        (tx) => {
          ids.forEach((id, i) => {
            if (!tx.doc.nodes[id]) return;
            const b = boxes[i];
            const quarter = Math.abs(Math.sin((b.angle * Math.PI) / 180)) > 0.7;
            const nb: OrientedBox = {
              cx: u.x + (b.cx - union.x) * sx,
              cy: u.y + (b.cy - union.y) * sy,
              width: Math.max(1, b.width * (quarter ? sy : sx)),
              height: Math.max(1, b.height * (quarter ? sx : sy)),
              angle: b.angle,
            };
            const styles: Record<string, string | number | null> = { width: Math.round(nb.width), height: Math.round(nb.height) };
            if (abs[i]) {
              const tl = positionDelta(doc, id, b, nb);
              styles.left = Math.round(offsets[i].left + tl.x);
              styles.top = Math.round(offsets[i].top + tl.y);
              styles.right = null;
              styles.bottom = null;
            }
            if (scaleTool) for (const p of scaleSubtree(doc, id, sx)) tx.setStyles(p.id, p.styles);
            tx.setStyles(id, styles);
            vectorResizers[i]?.(tx, Math.round(nb.width), Math.round(nb.height));
            const pad = pads[i];
            if (!scaleTool && pad) {
              applyConstraintsTx(tx, doc, id, pad, { width: pad.width + Math.round(nb.width) - b.width, height: pad.height + Math.round(nb.height) - b.height }, cboxes);
            }
          });
        },
        { mergeKey },
      );
      changed = true;
      canvasUi.set({ guides, scaling: scaleTool ? sx : null });
    },
    up() {
      resetGesture();
    },
    cancel() {
      resetGesture();
      if (changed) f.store.undo();
    },
  });
}

/**
 * Rotate the selection from a corner zone. One layer turns around its centre; several turn around the
 * centre of their bounds, and positioned ones orbit it. Shift snaps to 15°.
 */
export function beginRotate(e: PointerEvent) {
  const f = file();
  if (!f || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  blurFocused();
  const ids = transformIds(f);
  if (ids.length === 0) return;
  const doc = f.store.doc;
  const boxes0 = ids.map((id) => orientedBox(doc, id));
  if (boxes0.some((b) => !b)) return;
  const boxes = boxes0 as OrientedBox[];
  const single = ids.length === 1;
  const union = unionRects(boxes.map(boxBounds))!;
  const centre = single ? { x: boxes[0].cx, y: boxes[0].cy } : { x: union.x + union.width / 2, y: union.y + union.height / 2 };
  const own = ids.map((id) => parseAngle(doc.nodes[id].styles.rotate));
  const abs = ids.map((id) => isAbsolutelyPositioned(doc, doc.nodes[id]));
  const offsets = ids.map((id) => startOffset(doc, id));
  const start = screenToWorld({ x: e.clientX, y: e.clientY });
  const mergeKey = `rotate:${Date.now()}:${Math.random()}`;
  let changed = false;
  canvasUi.set({ gesture: "rotate", rotating: single ? own[0] : 0 });

  beginDrag({
    move(ev) {
      const p = screenToWorld({ x: ev.clientX, y: ev.clientY });
      const snap = ev.shiftKey ? 15 : 0;
      const delta = single ? rotationFromDrag(centre, start, p, own[0], snap) - own[0] : rotationFromDrag(centre, start, p, 0, snap);
      f.store.transact(
        "Rotate",
        (tx) => {
          ids.forEach((id, i) => {
            if (!tx.doc.nodes[id]) return;
            const styles: Record<string, string | number | null> = { rotate: angleStyle(own[i] + delta) };
            if (!single && abs[i]) {
              const c = rotatePoint({ x: boxes[i].cx, y: boxes[i].cy }, centre, delta);
              const d = parentDelta(doc, id, { x: c.x - boxes[i].cx, y: c.y - boxes[i].cy });
              styles.left = Math.round(offsets[i].left + d.x);
              styles.top = Math.round(offsets[i].top + d.y);
              styles.right = null;
              styles.bottom = null;
            }
            tx.setStyles(id, styles);
          });
        },
        { mergeKey },
      );
      changed = true;
      canvasUi.set({ rotating: single ? own[0] + delta : delta });
    },
    up() {
      resetGesture();
    },
    cancel() {
      resetGesture();
      if (changed) f.store.undo();
    },
  });
}

// ------------------------------------------------------------------ gap

/** Drag a flex gap handle: changes `gap` (or the axis gap when set) 1:1 with the pointer, Shift snaps to 8. */
export function beginGapDrag(e: PointerEvent, frameId: NodeId, axis: "row" | "column", measured: number) {
  const f = file();
  if (!f || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  blurFocused();
  const node = f.store.doc.nodes[frameId];
  if (!node || isLockedDeep(f.store.doc, frameId)) return;
  const axisKey = axis === "row" ? "columnGap" : "rowGap";
  const key = node.styles[axisKey] !== undefined ? axisKey : "gap";
  const startGap = pxValue(node.styles[key]) ?? Math.round(measured);
  const start = { x: e.clientX, y: e.clientY };
  const mergeKey = `gap:${Date.now()}:${Math.random()}`;
  let changed = false;
  canvasUi.set({ gesture: "resize", gapDrag: { frameId, value: startGap } });
  beginDrag({
    move(ev) {
      const d = worldDelta(start, ev);
      let v = startGap + (axis === "row" ? d.x : d.y);
      v = ev.shiftKey ? Math.round(v / 8) * 8 : Math.round(v);
      f.store.transact("Change gap", (tx) => tx.doc.nodes[frameId] && tx.setStyles(frameId, { [key]: v }), { mergeKey });
      changed = true;
      canvasUi.set({ gapDrag: { frameId, value: v } });
    },
    up() {
      canvasUi.set({ gapDrag: null });
      resetGesture();
    },
    cancel() {
      canvasUi.set({ gapDrag: null });
      resetGesture();
      if (changed) f.store.undo();
    },
  });
}

// ------------------------------------------------------------------ drawing

const DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
  artboard: { width: 400, height: 300 },
  frame: { width: 100, height: 100 },
  rect: { width: 100, height: 100 },
  shader: { width: 320, height: 240 },
};

function beginDraw(e: PointerEvent, kind: LayerKind) {
  const f = file();
  if (!f) return;
  const doc = f.store.doc;
  const container = containerAt(doc, e.clientX, e.clientY);
  const startW = screenToWorld({ x: e.clientX, y: e.clientY });
  startW.x = Math.round(startW.x);
  startW.y = Math.round(startW.y);
  const startClient = { x: e.clientX, y: e.clientY };
  let draft: Rect | null = null;
  canvasUi.set({ gesture: "draw", dropTarget: container });
  beginDrag({
    move(ev) {
      if (!draft && Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y) < DRAG_THRESHOLD) return;
      const cur = screenToWorld({ x: ev.clientX, y: ev.clientY });
      let dx = Math.round(cur.x) - startW.x;
      let dy = Math.round(cur.y) - startW.y;
      if (ev.shiftKey) {
        const s = Math.max(Math.abs(dx), Math.abs(dy));
        dx = Math.sign(dx || 1) * s;
        dy = Math.sign(dy || 1) * s;
      }
      draft = ev.altKey
        ? { x: startW.x - Math.abs(dx), y: startW.y - Math.abs(dy), width: Math.abs(dx) * 2, height: Math.abs(dy) * 2 }
        : rectFromPoints(startW, { x: startW.x + dx, y: startW.y + dy });
      canvasUi.set({ draft });
    },
    up() {
      resetGesture();
      let rect = draft;
      if (!rect || rect.width < 2 || rect.height < 2) {
        const size = DEFAULT_SIZE[kind === "frame" && !container ? "artboard" : kind] ?? DEFAULT_SIZE.rect;
        rect = { x: startW.x, y: startW.y, ...size };
      }
      insertLayer(kind, rect, container);
    },
    cancel() {
      resetGesture();
    },
  });
}

function placeText(e: PointerEvent) {
  const f = file();
  if (!f) return;
  const container = containerAt(f.store.doc, e.clientX, e.clientY);
  const w = screenToWorld({ x: e.clientX, y: e.clientY });
  const id = insertLayer("text", { x: Math.round(w.x), y: Math.round(w.y - 12), width: 0, height: 24 }, container, { autoSize: true });
  if (id) requestAnimationFrame(() => startTextEdit(id));
}

// ------------------------------------------------------------------ zoom tool

/** Zoom tool (Z): click zooms in, Alt-click zooms out, dragging zooms to the dragged area. */
function beginZoomTool(e: PointerEvent) {
  const startClient = { x: e.clientX, y: e.clientY };
  const startW = screenToWorld(startClient);
  let area: Rect | null = null;
  beginDrag({
    move(ev) {
      if (!area && Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y) < DRAG_THRESHOLD) return;
      area = rectFromPoints(startW, screenToWorld({ x: ev.clientX, y: ev.clientY }));
      canvasUi.set({ gesture: "zoom", marquee: area });
    },
    up(ev) {
      resetGesture();
      const vp = getViewportLive();
      if (area && area.width * vp.zoom > 4 && area.height * vp.zoom > 4) {
        setViewportLive(fitRect(area, canvasSize(), { padding: 16, maxZoom: MAX_ZOOM }));
        return;
      }
      const out = ev.altKey || e.altKey;
      setViewportLive(zoomAt(vp, clientToLocal(startClient), stepZoom(vp.zoom, out ? -1 : 1)));
    },
    cancel() {
      resetGesture();
    },
  });
}

// ------------------------------------------------------------------ context menu

function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  const f = file();
  if (!f || drag) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest("[data-of-chrome]") || target?.closest("[data-of-editing]")) return;
  const doc = f.store.doc;
  if (e.metaKey || (e.ctrlKey && !e.shiftKey && /Mac/.test(navigator.platform) === false)) {
    // ⌘ + right-click (Ctrl + right-click elsewhere): every layer under the cursor, topmost first
    const ids = hitIds(doc, e.clientX, e.clientY);
    if (ids.length) canvasUi.set({ contextMenu: { x: e.clientX, y: e.clientY, kind: "layers", ids } });
    return;
  }
  const label = target?.closest<HTMLElement>("[data-of-artboard-label]")?.getAttribute("data-of-artboard-label");
  let picked: NodeId | null = label ?? null;
  if (!picked) {
    const innermost = innermostAt(doc, e.clientX, e.clientY);
    picked = innermost ? pickTarget(doc, innermost, f.selection, "normal") : null;
    if (!picked && innermost && pressInsideSelection(f, e as PointerEvent)) picked = f.selection[0] ?? null;
    if (!picked && innermost) {
      // an artboard's own background
      let cur = doc.nodes[innermost];
      while (cur?.parentId && doc.nodes[cur.parentId]?.type !== "Root") cur = doc.nodes[cur.parentId];
      picked = cur?.id ?? null;
    }
  }
  if (picked && !f.selection.includes(picked)) setSelection(f.id, [picked]);
  if (!picked) setSelection(f.id, []);
  canvasUi.set({ contextMenu: { x: e.clientX, y: e.clientY, kind: "canvas", ids: picked ? (f.selection.includes(picked) ? f.selection : [picked]) : [] } });
}

// ------------------------------------------------------------------ pointer down / hover / wheel

/** Is the pointer inside the bounds of the current selection? */
function pressInsideSelection(f: OpenFile, e: PointerEvent): boolean {
  if (f.selection.length === 0) return false;
  const p = screenToWorld({ x: e.clientX, y: e.clientY });
  if (f.selection.length === 1) {
    // a rotated layer only owns the area inside its rotated box
    const b = orientedBox(f.store.doc, f.selection[0]);
    return !!b && boxContains(b, p);
  }
  const rects = f.selection.map((id) => getWorldRect(id)).filter((r): r is Rect => !!r);
  const bounds = unionRects(rects);
  if (!bounds) return false;
  return p.x >= bounds.x && p.x <= bounds.x + bounds.width && p.y >= bounds.y && p.y <= bounds.y + bounds.height;
}

// PointerEvent.detail is always 0, so count clicks ourselves
let lastDown = { t: 0, x: 0, y: 0, n: 0 };
function clickCount(e: PointerEvent): number {
  const now = performance.now();
  const near = Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 5;
  const n = near && now - lastDown.t < 450 ? lastDown.n + 1 : 1;
  lastDown = { t: now, x: e.clientX, y: e.clientY, n };
  return n;
}

function onPointerDown(e: PointerEvent) {
  const f = file();
  if (!f) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest("[data-of-editing]")) return;
  // overlay controls (handles, labels) and floating chrome handle their own events (React runs after us)
  if (target?.closest("[data-of-chrome]") || target?.closest("[data-of-overlay-ui]")) return;
  if (e.button === 2) return;
  const clicks = e.button === 0 ? clickCount(e) : 0;
  commitActiveTextEdit();
  blurFocused();
  e.preventDefault();

  const s = getState();
  if (e.button === 1 || s.tool === "hand" || canvasUi.get().spaceHeld) {
    beginPan(e);
    return;
  }
  if (e.button !== 0) return;
  if (vectorPointerDown(e, clicks)) return;
  switch (s.tool) {
    case "frame":
      return beginDraw(e, "frame");
    case "rect":
      return beginDraw(e, "rect");
    case "shader":
      return beginDraw(e, "shader");
    case "text":
      return placeText(e);
    case "zoom":
      return beginZoomTool(e);
    case "pen":
    case "image":
      setTool("move");
      break;
  }

  const doc = f.store.doc;
  const rootId = rootIdOf(f);
  if (!rootId) return;
  const innermost = innermostAt(doc, e.clientX, e.clientY);
  const deep = e.metaKey || e.ctrlKey;

  if (clicks >= 2 && innermost) {
    const drill = pickTarget(doc, innermost, f.selection, deep ? "deep" : "drill");
    if (drill && vectorDoubleClick(f.id, [drill])) return;
    if (drill) {
      const node = doc.nodes[drill];
      if (node.type === "Text") {
        startTextEdit(drill, { x: e.clientX, y: e.clientY });
        return;
      }
      setSelection(f.id, [drill]);
      beginPress(e, drill, {});
    }
    return;
  }

  const picked = innermost ? pickTarget(doc, innermost, f.selection, deep ? "deep" : "normal") : null;
  if (!picked && !e.shiftKey && !deep && pressInsideSelection(f, e)) {
    // empty space inside the selection (e.g. a selected artboard's background) drags the selection
    beginPress(e, f.selection[0], {});
    return;
  }
  if (!picked) {
    const base = e.shiftKey ? f.selection : [];
    if (!e.shiftKey) setSelection(f.id, []);
    // marquee inside an artboard selects its children, on empty canvas page-level layers
    let scope = rootId;
    if (innermost) {
      let cur = doc.nodes[innermost];
      while (cur?.parentId && cur.parentId !== rootId) cur = doc.nodes[cur.parentId];
      if (cur) scope = cur.id;
    }
    beginMarquee(e, scope, base);
    return;
  }
  const already = f.selection.includes(picked);
  if (e.shiftKey) {
    if (!already) select([picked], { additive: true });
  } else if (!already) {
    setSelection(f.id, [picked]);
  }
  beginPress(e, picked, { toggle: e.shiftKey && already, collapse: !e.shiftKey && already && f.selection.length > 1 });
}

let hoverFrame = 0;
let lastHoverEvent: PointerEvent | null = null;

function updateHover() {
  hoverFrame = 0;
  const e = lastHoverEvent;
  const f = file();
  if (!e || !f || drag) return;
  const s = getState();
  if ((s.tool !== "move" && s.tool !== "scale") || canvasUi.get().spaceHeld) {
    setHover(null);
    return;
  }
  const target = e.target as HTMLElement | null;
  if (target?.closest("[data-of-chrome]") || target?.closest("[data-of-overlay-ui]")) return;
  const doc = f.store.doc;
  const innermost = innermostAt(doc, e.clientX, e.clientY);
  const picked = innermost ? pickTarget(doc, innermost, f.selection, e.metaKey || e.ctrlKey ? "deep" : "normal") : null;
  setHover(picked);
}

function onPointerMove(e: PointerEvent) {
  if (drag) return;
  lastHoverEvent = e;
  if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover);
}

function onPointerLeave() {
  lastHoverEvent = null;
  if (!drag) setHover(null);
}

function onWheel(e: WheelEvent) {
  const target = e.target as HTMLElement | null;
  if (target?.closest("[data-of-scrollable]")) return;
  e.preventDefault();
  const vp = getViewportLive();
  const prefs = getPrefs();
  // trackpad pinch arrives as ctrl+wheel and always zooms; otherwise ⌘/Ctrl flips what the wheel does
  const pinch = e.ctrlKey && !e.metaKey;
  const zoom = pinch || (e.metaKey || e.ctrlKey) !== prefs.scrollZoom;
  if (zoom && !(e.shiftKey && !pinch)) {
    let factor = wheelZoomFactor(wheelPixels(e.deltaY, e.deltaMode), pinch);
    if (prefs.invertZoom) factor = 1 / factor;
    setViewportLive(zoomAt(vp, clientToLocal({ x: e.clientX, y: e.clientY }), vp.zoom * factor));
    return;
  }
  let dx = wheelPixels(e.deltaX, e.deltaMode);
  let dy = wheelPixels(e.deltaY, e.deltaMode);
  if (e.shiftKey && dx === 0) {
    dx = dy;
    dy = 0;
  }
  setViewportLive({ ...vp, x: vp.x - dx, y: vp.y - dy });
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}

function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return;
  if (e.target instanceof Element && e.target.closest("[role=dialog], [role=menu], .of-panel, .of-titlebar")) return;
  if (e.key === "Alt" && !canvasUi.get().altHeld) canvasUi.set({ altHeld: true });
  if (e.code === "Space" && !e.repeat && !isTyping() && !getState().editingTextId) {
    e.preventDefault();
    canvasUi.set({ spaceHeld: true });
    setHover(null);
  } else if (e.code === "Space" && canvasUi.get().spaceHeld) {
    e.preventDefault();
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === "Space") canvasUi.set({ spaceHeld: false });
  if (e.key === "Alt") canvasUi.set({ altHeld: false });
}

function onBlurWindow() {
  canvasUi.set({ spaceHeld: false, altHeld: false });
}

/** Attach canvas pointer handling. Returns a detach function. */
export function attachInteractions(canvas: HTMLElement, id: string): () => void {
  fileId = id;
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  const preventGesture = (e: Event) => e.preventDefault();
  canvas.addEventListener("gesturestart", preventGesture);
  canvas.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlurWindow);
  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("gesturestart", preventGesture);
    canvas.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlurWindow);
    endDrag();
    resetGesture();
    if (fileId === id) fileId = null;
  };
}
