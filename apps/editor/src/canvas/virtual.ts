// Virtualisation of top-level layers (SPEC §4.1): artboards far outside the viewport render as an empty
// placeholder of the same size, and below 10% zoom every artboard shows a cached raster thumbnail (LOD).
// Selected artboards, artboards an agent is working on and pinned ones always render live.
import { useCallback, useSyncExternalStore } from "react";
import type { FoldDocument, NodeId } from "@opencrease/model";
import { getActiveFile, getState, subscribe as subscribeWorkspace } from "../state/workspace";
import { rectsIntersect, type Rect } from "./geometry";
import { canvasSize, getViewportLive, lastKnownRect, subscribeViewport } from "./registry";
import { boxBounds, boxFromRect, parseAngle } from "./transform";
import { pxValue } from "./selection-logic";

export type LayerMode = "live" | "placeholder" | "thumb";

/** Below this zoom artboards show thumbnails. */
export const LOD_ZOOM = 0.1;
/** Mount margin around the viewport, in viewport sizes; unmounting waits for twice that. */
const MOUNT_MARGIN = 0.2;
const UNMOUNT_MARGIN = 0.4;

let enabled = true;
const modes = new Map<NodeId, LayerMode>();
const listeners = new Map<NodeId, Set<() => void>>();
const pins = new Map<NodeId, number>();
let topIds: NodeId[] = [];
let docRef: FoldDocument | null = null;
let raf = 0;

/** Turn virtualisation off (everything renders live), e.g. for debugging or the perf baseline. */
export function setVirtualisation(on: boolean) {
  enabled = on;
  schedule();
}

export function virtualisationEnabled(): boolean {
  return enabled;
}

function viewportWorld(margin: number): Rect | null {
  const size = canvasSize();
  if (size.width === 0) return null;
  const vp = getViewportLive();
  const w = size.width / vp.zoom;
  const h = size.height / vp.zoom;
  const x = -vp.x / vp.zoom;
  const y = -vp.y / vp.zoom;
  return { x: x - w * margin, y: y - h * margin, width: w * (1 + margin * 2), height: h * (1 + margin * 2) };
}

/** Best guess of a top-level layer's world rect: last measurement, else its own left/top/width/height. */
export function topRect(doc: FoldDocument, id: NodeId): Rect | null {
  const known = lastKnownRect(id);
  const n = doc.nodes[id];
  if (!n) return null;
  const width = pxValue(n.styles.width);
  const height = pxValue(n.styles.height);
  if (width === undefined || height === undefined) return known;
  return boxBounds(boxFromRect({ x: pxValue(n.styles.left) ?? 0, y: pxValue(n.styles.top) ?? 0, width, height }, parseAngle(n.styles.rotate)));
}

function pinnedNow(doc: FoldDocument): Set<NodeId> {
  const out = new Set<NodeId>();
  const now = Date.now();
  for (const [id, until] of pins) {
    if (until < now) pins.delete(id);
    else out.add(id);
  }
  const s = getState();
  const file = getActiveFile();
  const topOf = (id: NodeId): NodeId | null => {
    let cur = doc.nodes[id];
    while (cur?.parentId && doc.nodes[cur.parentId]?.type !== "Root") cur = doc.nodes[cur.parentId];
    return cur?.parentId ? cur.id : null;
  };
  for (const id of file?.selection ?? []) {
    const t = topOf(id);
    if (t) out.add(t);
  }
  if (s.editingTextId) {
    const t = topOf(s.editingTextId);
    if (t) out.add(t);
  }
  if (file) for (const id of Object.keys(s.agentWork[file.id] ?? {})) out.add(id);
  return out;
}

function decide(doc: FoldDocument, id: NodeId, prev: LayerMode | undefined, pinned: Set<NodeId>, near: Rect | null, far: Rect | null, lod: boolean): LayerMode {
  if (!enabled || pinned.has(id) || !near || !far) return "live";
  const r = topRect(doc, id);
  if (!r) return "live";
  if (lod) return rectsIntersect(r, far) ? "thumb" : "placeholder";
  if (prev === "live") return rectsIntersect(r, far) ? "live" : "placeholder";
  return rectsIntersect(r, near) ? "live" : "placeholder";
}

function recompute() {
  raf = 0;
  const doc = docRef;
  if (!doc) return;
  const zoom = getViewportLive().zoom;
  const near = viewportWorld(MOUNT_MARGIN);
  const far = viewportWorld(UNMOUNT_MARGIN);
  const pinned = pinnedNow(doc);
  const lod = enabled && zoom < LOD_ZOOM;
  for (const id of topIds) {
    const prev = modes.get(id) ?? "live";
    const next = decide(doc, id, prev, pinned, near, far, lod);
    if (next !== prev) {
      modes.set(id, next);
      for (const l of [...(listeners.get(id) ?? [])]) l();
    }
  }
}

function schedule() {
  if (!raf) raf = requestAnimationFrame(recompute);
}

subscribeViewport(schedule);
subscribeWorkspace(schedule);

/** Tell the virtualiser which page is showing (called by the canvas on every render). */
export function setVirtualPage(doc: FoldDocument, ids: NodeId[]) {
  const changed = docRef !== doc;
  docRef = doc;
  if (ids !== topIds || changed) {
    if (ids !== topIds) {
      const keep = new Set(ids);
      for (const id of modes.keys()) if (!keep.has(id)) modes.delete(id);
    }
    topIds = ids;
    schedule();
  }
}

/** Keep these top-level layers live for `ms` (agent tools, exports). */
export function pinTopLevel(ids: Iterable<NodeId>, ms = 4000) {
  const until = Date.now() + ms;
  let changed = false;
  for (const id of ids) {
    if ((pins.get(id) ?? 0) < until) {
      pins.set(id, until);
      changed = true;
    }
    if (modes.get(id) && modes.get(id) !== "live") {
      modes.set(id, "live");
      for (const l of [...(listeners.get(id) ?? [])]) l();
    }
  }
  if (changed) setTimeout(schedule, ms + 50);
}

export function layerMode(id: NodeId): LayerMode {
  return modes.get(id) ?? "live";
}

export function useLayerMode(id: NodeId): LayerMode {
  const sub = useCallback(
    (l: () => void) => {
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      set.add(l);
      return () => {
        set!.delete(l);
        if (set!.size === 0) listeners.delete(id);
      };
    },
    [id],
  );
  return useSyncExternalStore(sub, () => modes.get(id) ?? firstMode(id));
}

/** Mode for a layer rendered for the first time: decided right away so a big page does not mount everything once. */
function firstMode(id: NodeId): LayerMode {
  const doc = docRef;
  if (!doc) return "live";
  const mode = decide(doc, id, undefined, pinnedNow(doc), viewportWorld(MOUNT_MARGIN), viewportWorld(UNMOUNT_MARGIN), getViewportLive().zoom < LOD_ZOOM);
  modes.set(id, mode);
  return mode;
}

/** Counts of top-level layers per mode (perf script and debugging). */
export function modeCounts(): Record<LayerMode, number> {
  const out: Record<LayerMode, number> = { live: 0, placeholder: 0, thumb: 0 };
  for (const id of topIds) out[modes.get(id) ?? "live"]++;
  return out;
}

/** Release the closed canvas's page and cached modes without disturbing a newly mounted file. */
export function clearVirtualPage(fileId: string) {
  if (docRef?.id !== fileId) return;
  docRef = null;
  topIds = [];
  modes.clear();
  pins.clear();
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}
