// Path edit mode: entering and leaving, the screen mapping of the edited path, and every edit
// (drag anchors and handles, bend segments, add and delete points, change point types, marquee).
// Each edit is one undo step; drags merge into one step with a mergeKey.
import { artboardOf, type FoldDocument, type NodeId, type OFNode } from "@opencrease/model";
import { getOpenFile, getState, setSelection, setTool, type OpenFile } from "../state/workspace";
import { beginDrag } from "../canvas/interactions";
import { clientToLocal, getViewportLive, getWorldRect } from "../canvas/registry";
import { isLockedDeep } from "../canvas/selection-logic";
import {
  anchorCount, applyMatrix, bendSegment, clonePath, deleteAnchors, enforceType, fmt, inferPointType, invert, moveAnchor, moveHandle,
  multiply, nearestSegment, parseRefKey, refKey, setPointType, splitSegment, transformPath, type Matrix, type PathModel, type PointRef,
  type PointType, type Pt,
} from "./path";
import { editablePathOf, pathAttrsFor, refitSvg } from "./shapes";
import { elementPath, elementToSvgBox, ownerSvg } from "./svg-geom";
import { snapValue, vectorUi, type PathEdit, type PathEditTool } from "./state";
import { svgScreenMatrix } from "./dom";

const DRAG_THRESHOLD = 3;
const SEGMENT_HIT_PX = 6;

// ------------------------------------------------------------------ session

function session(): { edit: PathEdit; file: OpenFile; doc: FoldDocument; node: OFNode } | null {
  const edit = vectorUi.get().edit;
  if (!edit) return null;
  const file = getOpenFile(edit.fileId);
  const node = file?.store.doc.nodes[edit.pathId];
  if (!file || !node) return null;
  return { edit, file, doc: file.store.doc, node };
}

/** Can `id` be edited as a path (a shape element, or an SVG holding exactly one)? */
export function canEditPath(doc: FoldDocument, id: NodeId): boolean {
  const el = editablePathOf(doc, id);
  return !!el && !isLockedDeep(doc, el.id) && !!ownerSvg(doc, el.id);
}

export function enterPathEdit(fileId: string, id: NodeId): boolean {
  const file = getOpenFile(fileId);
  if (!file) return false;
  const doc = file.store.doc;
  if (!canEditPath(doc, id)) return false;
  const el = editablePathOf(doc, id)!;
  const svg = ownerSvg(doc, el.id)!;
  if (getState().tool !== "move") setTool("move");
  const selected = file.selection;
  if (!(selected.length === 1 && (selected[0] === svg.id || selected[0] === el.id))) setSelection(fileId, [svg.id]);
  vectorUi.set({ edit: { fileId, svgId: svg.id, pathId: el.id, selected: [], tool: "bend", types: {} }, readout: null, marquee: null, pen: null });
  return true;
}

export function exitPathEdit() {
  if (!vectorUi.get().edit) return;
  vectorUi.set({ edit: null, readout: null, marquee: null });
}

export function setEditTool(tool: PathEditTool) {
  const e = vectorUi.get().edit;
  if (e) vectorUi.set({ edit: { ...e, tool } });
}

function setEditSelection(selected: string[]) {
  const e = vectorUi.get().edit;
  if (e) vectorUi.set({ edit: { ...e, selected: [...new Set(selected)] } });
}

/** Remember an explicitly chosen type (or clear remembered types after structural edits). */
function setTypes(types: Record<string, PointType>) {
  const e = vectorUi.get().edit;
  if (e) vectorUi.set({ edit: { ...e, types } });
}

// ------------------------------------------------------------------ model and mapping

export function editModel(doc: FoldDocument, pathId: NodeId): PathModel {
  const node = doc.nodes[pathId];
  return node ? (elementPath(node) ?? []) : [];
}

/** Matrix from the path's user space to canvas-local screen px. */
export function pathToScreen(doc: FoldDocument, pathId: NodeId): Matrix | null {
  const live = svgScreenMatrix(pathId);
  if (live) return live;
  const svg = ownerSvg(doc, pathId);
  if (!svg) return null;
  const r = getWorldRect(svg.id);
  if (!r) return null;
  const vp = getViewportLive();
  return multiply([vp.zoom, 0, 0, vp.zoom, vp.x + r.x * vp.zoom, vp.y + r.y * vp.zoom], elementToSvgBox(doc, pathId, { width: r.width, height: r.height }));
}

/** World origin that point coordinates in the inspector are relative to: the artboard, or the page. */
export function coordinateOrigin(doc: FoldDocument, svgId: NodeId): Pt {
  const board = artboardOf(doc, svgId);
  if (!board || board.id === svgId) return { x: 0, y: 0 };
  const r = getWorldRect(board.id);
  return r ? { x: r.x, y: r.y } : { x: 0, y: 0 };
}

const toWorld = (p: Pt): Pt => {
  const vp = getViewportLive();
  return { x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom };
};
const toLocal = (p: Pt): Pt => {
  const vp = getViewportLive();
  return { x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y };
};

export function typeOf(edit: PathEdit, model: PathModel, ref: PointRef): PointType {
  const s = model[ref.sub];
  if (!s || !s.anchors[ref.index]) return "corner";
  const inferred = inferPointType(s, ref.index);
  const remembered = edit.types[refKey(ref)];
  // a remembered type only holds while the geometry still allows it
  if (remembered && (remembered === inferred || (remembered === "asymmetric" && inferred === "mirrored") || (remembered === "disconnected" && inferred !== "corner"))) return remembered;
  return inferred;
}

export function validRefs(model: PathModel, keys: string[]): PointRef[] {
  return keys.map(parseRefKey).filter((r) => !!model[r.sub]?.anchors[r.index]);
}

/** Write a new path (always as a <path>), optionally refitting the SVG to the geometry. */
function commit(model: PathModel, label: string, opts: { mergeKey?: string; refit?: boolean } = {}) {
  const s = session();
  if (!s) return;
  const { file, edit } = s;
  file.store.transact(
    label,
    (tx) => {
      const node = tx.doc.nodes[edit.pathId];
      if (!node) return;
      const attrs = pathAttrsFor(node, model);
      tx.updateNode(edit.pathId, node.tag === "path" ? { attrs } : { tag: "path", attrs });
      if (opts.refit) refitSvg(tx, edit.svgId);
    },
    { mergeKey: opts.mergeKey },
  );
}

function refitAfter(mergeKey: string, label: string) {
  const s = session();
  if (!s) return;
  s.file.store.transact(label, (tx) => refitSvg(tx, s.edit.svgId), { mergeKey });
}

// ------------------------------------------------------------------ point commands (inspector, keys)

export function deleteSelectedPoints() {
  const s = session();
  if (!s) return;
  const model = editModel(s.doc, s.edit.pathId);
  const refs = validRefs(model, s.edit.selected);
  if (!refs.length) return;
  const next = deleteAnchors(model, refs);
  setEditSelection([]);
  setTypes({});
  if (next.length === 0) {
    // nothing left: remove the path (and its SVG when it has no other content)
    const { file, edit } = s;
    file.store.transact("Delete path", (tx) => {
      const svg = tx.doc.nodes[edit.svgId];
      if (svg && svg.children.length <= 1) tx.deleteNode(edit.svgId);
      else if (tx.doc.nodes[edit.pathId]) tx.deleteNode(edit.pathId);
    });
    exitPathEdit();
    setSelection(file.id, []);
    return;
  }
  commit(next, refs.length > 1 ? "Delete points" : "Delete point", { refit: true });
}

export function setSelectedPointType(type: PointType) {
  const s = session();
  if (!s) return;
  const model = clonePath(editModel(s.doc, s.edit.pathId));
  const refs = validRefs(model, s.edit.selected);
  if (!refs.length) return;
  const types = { ...s.edit.types };
  for (const r of refs) {
    setPointType(model[r.sub], r.index, type);
    types[refKey(r)] = type;
  }
  setTypes(types);
  commit(model, "Change point type", { refit: true });
}

/** Move the selected points so the first one lands on (x, y), in inspector coordinates. */
export function setSelectedPointPosition(axis: "x" | "y", value: number, mergeKey?: string) {
  const s = session();
  if (!s) return;
  const model = clonePath(editModel(s.doc, s.edit.pathId));
  const refs = validRefs(model, s.edit.selected);
  const M = pathToScreen(s.doc, s.edit.pathId);
  if (!refs.length || !M) return;
  const inv = invert(M);
  const origin = coordinateOrigin(s.doc, s.edit.svgId);
  const first = model[refs[0].sub].anchors[refs[0].index];
  const w = toWorld(applyMatrix(M, first));
  const target = { ...w, [axis]: origin[axis] + value };
  const u = applyMatrix(inv, toLocal(target));
  const dx = u.x - first.x;
  const dy = u.y - first.y;
  for (const r of refs) moveAnchor(model[r.sub].anchors[r.index], dx, dy);
  commit(model, "Move point", { refit: true, mergeKey });
}

/** Nudge the selected points by screen-independent world pixels. */
export function nudgeSelectedPoints(dxWorld: number, dyWorld: number) {
  const s = session();
  if (!s) return;
  const model = clonePath(editModel(s.doc, s.edit.pathId));
  const refs = validRefs(model, s.edit.selected);
  const M = pathToScreen(s.doc, s.edit.pathId);
  if (!refs.length || !M) return;
  const inv = invert(M);
  const z = getViewportLive().zoom;
  const o = applyMatrix(inv, { x: 0, y: 0 });
  const d = applyMatrix(inv, { x: dxWorld * z, y: dyWorld * z });
  for (const r of refs) moveAnchor(model[r.sub].anchors[r.index], d.x - o.x, d.y - o.y);
  commit(model, "Nudge points", { mergeKey: `nudge-points:${s.edit.pathId}`, refit: true });
}

export function selectAllPoints() {
  const s = session();
  if (!s) return;
  const model = editModel(s.doc, s.edit.pathId);
  setEditSelection(model.flatMap((sp, si) => sp.anchors.map((_, i) => refKey({ sub: si, index: i }))));
}

/** Inspector readout: position of a point relative to the artboard. */
export function pointPosition(doc: FoldDocument, edit: PathEdit, ref: PointRef): Pt | null {
  const model = editModel(doc, edit.pathId);
  const a = model[ref.sub]?.anchors[ref.index];
  const M = pathToScreen(doc, edit.pathId);
  if (!a || !M) return null;
  const w = toWorld(applyMatrix(M, a));
  const o = coordinateOrigin(doc, edit.svgId);
  return { x: w.x - o.x, y: w.y - o.y };
}

export function pointCount(doc: FoldDocument, pathId: NodeId): number {
  return anchorCount(editModel(doc, pathId));
}

// ------------------------------------------------------------------ drags

function readout(local: Pt, worldPt: Pt, type?: PointType) {
  const s = session();
  if (!s) return;
  const o = coordinateOrigin(s.doc, s.edit.svgId);
  const text = `x ${fmt(worldPt.x - o.x, 1)} y ${fmt(worldPt.y - o.y, 1)}${type ? ` ${type}` : ""}`;
  vectorUi.set({ readout: { x: local.x + 14, y: local.y - 10, text } });
}

function snapWorld(p: Pt): Pt {
  return { x: snapValue(p.x), y: snapValue(p.y) };
}

let lastAnchorDown = { t: 0, key: "" };

/** Pointer down on an anchor in the overlay. */
export function pressAnchor(e: PointerEvent, ref: PointRef, addMergeKey?: string) {
  const s = session();
  if (!s || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const key = refKey(ref);
  const now = performance.now();
  const double = !addMergeKey && lastAnchorDown.key === key && now - lastAnchorDown.t < 400;
  lastAnchorDown = { t: now, key };
  const model0 = editModel(s.doc, s.edit.pathId);
  if (double) {
    // double-click toggles between a sharp corner and a smooth point
    const type = typeOf(s.edit, model0, ref);
    setEditSelection([key]);
    const model = clonePath(model0);
    const next: PointType = type === "corner" ? "mirrored" : "corner";
    setPointType(model[ref.sub], ref.index, next);
    setTypes({ ...s.edit.types, [key]: next });
    commit(model, "Change point type", { refit: true });
    return;
  }
  let selected = s.edit.selected;
  if (e.shiftKey) {
    selected = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    setEditSelection(selected);
    if (!selected.includes(key)) return;
  } else if (!selected.includes(key)) {
    selected = [key];
    setEditSelection(selected);
  }
  const M = pathToScreen(s.doc, s.edit.pathId);
  if (!M) return;
  const inv = invert(M);
  const refs = validRefs(model0, selected);
  const a0 = model0[ref.sub].anchors[ref.index];
  const anchorWorld = toWorld(applyMatrix(M, a0));
  const startLocal = clientToLocal({ x: e.clientX, y: e.clientY });
  const startWorld = toWorld(startLocal);
  const mergeKey = addMergeKey ?? `move-points:${now}`;
  const type = typeOf(s.edit, model0, ref);
  let moved = false;
  beginDrag({
    move(ev) {
      const local = clientToLocal({ x: ev.clientX, y: ev.clientY });
      if (!moved && Math.hypot(local.x - startLocal.x, local.y - startLocal.y) < DRAG_THRESHOLD) return;
      moved = true;
      const w = toWorld(local);
      let target = { x: anchorWorld.x + w.x - startWorld.x, y: anchorWorld.y + w.y - startWorld.y };
      if (ev.shiftKey) {
        if (Math.abs(target.x - anchorWorld.x) > Math.abs(target.y - anchorWorld.y)) target.y = anchorWorld.y;
        else target.x = anchorWorld.x;
      }
      target = snapWorld(target);
      const u = applyMatrix(inv, toLocal(target));
      const dx = u.x - a0.x;
      const dy = u.y - a0.y;
      const model = clonePath(model0);
      for (const r of refs) moveAnchor(model[r.sub].anchors[r.index], dx, dy);
      commit(model, refs.length > 1 ? "Move points" : "Move point", { mergeKey });
      readout(toLocal(target), target, type);
    },
    up() {
      vectorUi.set({ readout: null });
      if (moved) refitAfter(mergeKey, "Move point");
    },
    cancel() {
      vectorUi.set({ readout: null });
      if (moved) getOpenFile(s.file.id)?.store.undo();
    },
  });
}

/** Pointer down on a bézier handle in the overlay. Alt breaks the handles apart. */
export function pressHandle(e: PointerEvent, ref: PointRef, side: "in" | "out") {
  const s = session();
  if (!s || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const model0 = editModel(s.doc, s.edit.pathId);
  const M = pathToScreen(s.doc, s.edit.pathId);
  const a0 = model0[ref.sub]?.anchors[ref.index];
  const h0 = a0?.[side];
  if (!M || !a0 || !h0) return;
  const inv = invert(M);
  const key = refKey(ref);
  if (!s.edit.selected.includes(key)) setEditSelection([key]);
  let type = typeOf(s.edit, model0, ref);
  const startLocal = clientToLocal({ x: e.clientX, y: e.clientY });
  const startWorld = toWorld(startLocal);
  const handleWorld = toWorld(applyMatrix(M, h0));
  const mergeKey = `move-handle:${performance.now()}`;
  let moved = false;
  beginDrag({
    move(ev) {
      const local = clientToLocal({ x: ev.clientX, y: ev.clientY });
      if (!moved && Math.hypot(local.x - startLocal.x, local.y - startLocal.y) < DRAG_THRESHOLD) return;
      moved = true;
      if (ev.altKey && type !== "disconnected") {
        type = "disconnected";
        setTypes({ ...(vectorUi.get().edit?.types ?? {}), [key]: "disconnected" });
      }
      const w = toWorld(local);
      const target = snapWorld({ x: handleWorld.x + w.x - startWorld.x, y: handleWorld.y + w.y - startWorld.y });
      const u = applyMatrix(inv, toLocal(target));
      const model = clonePath(model0);
      moveHandle(model[ref.sub], ref.index, side, u, type);
      commit(model, "Move handle", { mergeKey });
      readout(toLocal(target), target, type);
    },
    up() {
      vectorUi.set({ readout: null });
      if (moved) refitAfter(mergeKey, "Move handle");
    },
    cancel() {
      vectorUi.set({ readout: null });
      if (moved) getOpenFile(s.file.id)?.store.undo();
    },
  });
}

/**
 * Pointer down on the canvas while editing a path. Returns false when the press is outside the edited
 * layer and should be handled normally (which also leaves edit mode).
 */
export function editPointerDown(e: PointerEvent, clicks: number): boolean {
  const s = session();
  if (!s) return false;
  const M = pathToScreen(s.doc, s.edit.pathId);
  if (!M) return false;
  const local = clientToLocal({ x: e.clientX, y: e.clientY });
  const model0 = editModel(s.doc, s.edit.pathId);
  const screen = transformPath(model0, M);
  const hit = nearestSegment(screen, local);
  const onSegment = !!hit && hit.d <= SEGMENT_HIT_PX;

  if (onSegment && hit && (s.edit.tool === "add" || clicks >= 2)) {
    const model = clonePath(model0);
    const ref = splitSegment(model, hit.seg.sub, hit.seg.index, hit.t);
    // indices after the new point shift by one: forget remembered types
    setTypes({});
    setEditSelection([refKey(ref)]);
    const mergeKey = `add-point:${performance.now()}`;
    commit(model, "Add point", { mergeKey });
    pressAnchor(e, ref, mergeKey);
    return true;
  }
  if (onSegment && hit) {
    beginBend(e, hit.seg.sub, hit.seg.index, hit.t);
    return true;
  }

  // outside the layer (with some slack): leave edit mode and let the canvas handle the click
  const svgRect = getWorldRect(s.edit.svgId);
  const vp = getViewportLive();
  const pad = 12;
  const inside =
    !!svgRect &&
    local.x >= svgRect.x * vp.zoom + vp.x - pad &&
    local.x <= (svgRect.x + svgRect.width) * vp.zoom + vp.x + pad &&
    local.y >= svgRect.y * vp.zoom + vp.y - pad &&
    local.y <= (svgRect.y + svgRect.height) * vp.zoom + vp.y + pad;
  if (!inside && !e.shiftKey) {
    exitPathEdit();
    return false;
  }
  beginPointMarquee(e, screen);
  return true;
}

function beginBend(e: PointerEvent, subIndex: number, index: number, t: number) {
  const s = session();
  if (!s) return;
  const model0 = editModel(s.doc, s.edit.pathId);
  const M = pathToScreen(s.doc, s.edit.pathId);
  if (!M) return;
  const inv = invert(M);
  const startLocal = clientToLocal({ x: e.clientX, y: e.clientY });
  const startUser = applyMatrix(inv, startLocal);
  const n = model0[subIndex].anchors.length;
  const aRef = { sub: subIndex, index };
  const bRef = { sub: subIndex, index: (index + 1) % n };
  const aType = typeOf(s.edit, model0, aRef);
  const bType = typeOf(s.edit, model0, bRef);
  const mergeKey = `bend:${performance.now()}`;
  let moved = false;
  beginDrag({
    move(ev) {
      const local = clientToLocal({ x: ev.clientX, y: ev.clientY });
      if (!moved && Math.hypot(local.x - startLocal.x, local.y - startLocal.y) < DRAG_THRESHOLD) return;
      moved = true;
      const u = applyMatrix(inv, local);
      const model = clonePath(model0);
      bendSegment(model, subIndex, index, t, { x: u.x - startUser.x, y: u.y - startUser.y });
      enforceType(model[subIndex], aRef.index, "out", aType === "corner" ? "disconnected" : aType);
      enforceType(model[subIndex], bRef.index, "in", bType === "corner" ? "disconnected" : bType);
      commit(model, "Bend segment", { mergeKey });
    },
    up() {
      if (moved) refitAfter(mergeKey, "Bend segment");
      else setEditSelection([]);
    },
    cancel() {
      if (moved) getOpenFile(s.file.id)?.store.undo();
    },
  });
}

function beginPointMarquee(e: PointerEvent, screen: PathModel) {
  const s = session();
  if (!s) return;
  const start = clientToLocal({ x: e.clientX, y: e.clientY });
  const base = e.shiftKey ? s.edit.selected : [];
  if (!e.shiftKey) setEditSelection([]);
  let active = false;
  beginDrag({
    move(ev) {
      const p = clientToLocal({ x: ev.clientX, y: ev.clientY });
      if (!active && Math.hypot(p.x - start.x, p.y - start.y) < DRAG_THRESHOLD) return;
      active = true;
      const r = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) };
      vectorUi.set({ marquee: r });
      const hits: string[] = [];
      screen.forEach((sp, si) =>
        sp.anchors.forEach((a, i) => {
          if (a.x >= r.x && a.x <= r.x + r.width && a.y >= r.y && a.y <= r.y + r.height) hits.push(refKey({ sub: si, index: i }));
        }),
      );
      setEditSelection([...base, ...hits]);
    },
    up() {
      vectorUi.set({ marquee: null });
    },
    cancel() {
      vectorUi.set({ marquee: null });
      setEditSelection(base);
    },
  });
}
