// Level of detail: raster thumbnails of artboards for zoom levels below 10% (SPEC §4.1). Thumbnails are
// captured in idle time, one artboard at a time, from the live canvas element when it is mounted or from a
// hidden off-canvas render otherwise. An edit anywhere inside an artboard marks its thumbnail stale; the
// stale image keeps showing until the new one is ready.
import { useCallback, useSyncExternalStore } from "react";
import type { DocStore, FoldDocument, NodeId } from "@opencrease/model";
import { getNodeElement, lastKnownRect } from "./registry";

interface Thumb {
  url: string;
  version: number;
}

const thumbs = new Map<NodeId, Thumb>();
const versions = new Map<NodeId, number>();
const wanted = new Set<NodeId>();
const listeners = new Map<NodeId, Set<() => void>>();
let busy = false;
let generation = 0;
let idleHandle = 0;
let capturesDone = 0;

/** Renders an artboard off-canvas and resolves its element; installed by the canvas (needs React). */
export type OffscreenRenderer = (id: NodeId) => Promise<{ el: HTMLElement; dispose(): void } | null>;
let renderOffscreen: OffscreenRenderer | null = null;
let docOf: (() => FoldDocument) | null = null;

function notify(id: NodeId) {
  for (const l of [...(listeners.get(id) ?? [])]) l();
}

function topLevelOf(doc: FoldDocument, id: NodeId): NodeId | null {
  let cur = doc.nodes[id];
  while (cur?.parentId && doc.nodes[cur.parentId]?.type !== "Root") cur = doc.nodes[cur.parentId];
  return cur?.parentId ? cur.id : null;
}

/** Track a file: edits bump the version of the artboards they touch. Returns a detach function. */
export function attachLod(store: DocStore, renderer: OffscreenRenderer): () => void {
  generation++;
  renderOffscreen = renderer;
  docOf = () => store.doc;
  const unsub = store.subscribe((doc, change) => {
    if (change.label === "Reset" && change.origin === "system") {
      for (const id of [...thumbs.keys()]) versions.set(id, (versions.get(id) ?? 0) + 1);
    } else {
      const tops = new Set<NodeId>();
      for (const id of change.touched) {
        const t = topLevelOf(doc, id);
        if (t) tops.add(t);
      }
      for (const t of tops) versions.set(t, (versions.get(t) ?? 0) + 1);
    }
    schedule();
  });
  return () => {
    generation++;
    unsub();
    renderOffscreen = null;
    docOf = null;
    cancelIdle();
    for (const t of thumbs.values()) URL.revokeObjectURL(t.url);
    thumbs.clear();
    versions.clear();
    wanted.clear();
  };
}

const requestIdle: (cb: () => void) => number =
  typeof requestIdleCallback === "function" ? (cb) => requestIdleCallback(cb, { timeout: 500 }) : (cb) => window.setTimeout(cb, 50);
const cancelIdleFn: (h: number) => void = typeof cancelIdleCallback === "function" ? cancelIdleCallback : clearTimeout;

function cancelIdle() {
  if (idleHandle) cancelIdleFn(idleHandle);
  idleHandle = 0;
}

function schedule() {
  if (idleHandle || busy || wanted.size === 0) return;
  idleHandle = requestIdle(() => {
    idleHandle = 0;
    void work();
  });
}

function next(): NodeId | null {
  for (const id of wanted) {
    const t = thumbs.get(id);
    if (!t || t.version !== (versions.get(id) ?? 0)) return id;
  }
  return null;
}

async function capture(id: NodeId): Promise<string | null> {
  const doc = docOf?.();
  const node = doc?.nodes[id];
  if (!doc || !node || !node.visible) return null;
  let el = getNodeElement(id);
  let dispose: (() => void) | undefined;
  if (!el || el.hasAttribute("data-of-virtual")) {
    const off = await renderOffscreen?.(id);
    if (!off) return null;
    el = off.el;
    dispose = off.dispose;
  }
  try {
    const known = lastKnownRect(id);
    const width = Math.max(1, Math.round(el.offsetWidth || known?.width || 1));
    const height = Math.max(1, Math.round(el.offsetHeight || known?.height || 1));
    const scale = Math.min(0.25, 512 / Math.max(width, height));
    const { domToCanvas } = await import("modern-screenshot");
    const canvas = await domToCanvas(el, {
      width,
      height,
      scale,
      backgroundColor: null,
      style: { position: "relative", left: "0px", top: "0px", right: "auto", bottom: "auto", margin: "0px", translate: "none", rotate: "none" } as Partial<CSSStyleDeclaration>,
      font: false,
      timeout: 10_000,
    });
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    return blob ? URL.createObjectURL(blob) : null;
  } finally {
    dispose?.();
  }
}

async function work() {
  const id = next();
  if (!id) return;
  busy = true;
  const current = generation;
  const version = versions.get(id) ?? 0;
  try {
    const url = await capture(id);
    if (url && current !== generation) { URL.revokeObjectURL(url); return; }
    if (url) {
      const old = thumbs.get(id);
      if (old) URL.revokeObjectURL(old.url);
      thumbs.set(id, { url, version });
      capturesDone++;
      notify(id);
    } else {
      // nothing to show (hidden or deleted): stop asking for this version
      wanted.delete(id);
    }
  } catch (err) {
    console.warn("Thumbnail capture failed", err);
    wanted.delete(id);
  } finally {
    busy = false;
    schedule();
  }
}

/** The thumbnail of an artboard while `want` is true (null until the first capture). */
export function useThumbnail(id: NodeId, want: boolean): string | null {
  const sub = useCallback(
    (l: () => void) => {
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      set.add(l);
      if (want) {
        wanted.add(id);
        schedule();
      }
      return () => {
        set!.delete(l);
        if (set!.size === 0) listeners.delete(id);
        if (want) wanted.delete(id);
      };
    },
    [id, want],
  );
  return useSyncExternalStore(sub, () => thumbs.get(id)?.url ?? null);
}

/** Thumbnails captured so far and still queued (perf script). */
export function lodStats(): { captured: number; cached: number; wanted: number } {
  return { captured: capturesDone, cached: thumbs.size, wanted: wanted.size };
}
