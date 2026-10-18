// Live canvas registry: DOM lookups for nodes, the current viewport and coordinate conversion.
// Used by the canvas itself and by the agent bridge (see docs/ARCHITECTURE.md).
//
// Coordinates: "screen" points are browser client coordinates (MouseEvent.clientX/Y). "World" points are
// document coordinates, unaffected by zoom; page-level layers use them for their left/top.
import type { Point, Rect } from "./geometry";
import { toScreen, toWorld, type ViewportValue } from "./viewport-math";

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Mounted {
  canvas: HTMLElement;
  world: HTMLElement;
  fileId: string;
  pageId: string;
  persist: (vp: ViewportValue, pageId: string) => void;
}

let mounted: Mounted | null = null;
let viewport: ViewportValue = { x: 80, y: 80, zoom: 1 };
const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function applyTransform() {
  if (!mounted) return;
  mounted.world.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
  mounted.canvas.style.setProperty("--of-zoom", String(viewport.zoom));
}

export function registerCanvas(m: Mounted, initial: ViewportValue) {
  frameCache.clear();
  lastKnown.clear();
  mounted = m;
  viewport = initial;
  applyTransform();
  for (const l of [...listeners]) l();
}

export function unregisterCanvas(canvas: HTMLElement) {
  if (mounted?.canvas !== canvas) return;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
    mounted.persist(viewport, mounted.pageId);
  }
  mounted = null;
}

/** Switch the mounted canvas to another page (viewport restored by the caller). */
export function setRegisteredPage(pageId: string, vp: ViewportValue) {
  if (!mounted) return;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
    mounted.persist(viewport, mounted.pageId);
  }
  mounted.pageId = pageId;
  setViewportLive(vp, { persist: false });
}

export function getMountedFileId(): string | null {
  return mounted?.fileId ?? null;
}

export function getCanvasElement(): HTMLElement | null {
  return mounted?.canvas ?? null;
}

export function getWorldElement(): HTMLElement | null {
  return mounted?.world ?? null;
}

export function getViewportLive(): ViewportValue {
  return viewport;
}

export function subscribeViewport(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Set the live viewport. The transform applies synchronously; persistence to workspace state is debounced. */
export function setViewportLive(vp: ViewportValue, opts: { persist?: boolean } = {}) {
  if (!Number.isFinite(vp.x) || !Number.isFinite(vp.y) || !Number.isFinite(vp.zoom) || vp.zoom <= 0) return;
  if (vp.x === viewport.x && vp.y === viewport.y && vp.zoom === viewport.zoom) return;
  viewport = vp;
  applyTransform();
  for (const l of [...listeners]) l();
  if (opts.persist !== false && mounted) {
    const m = mounted;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = undefined;
      m.persist(viewport, m.pageId);
    }, 250);
  }
}

/** Canvas element's client rect origin (0,0 if not mounted). */
export function canvasOrigin(): Point {
  const r = mounted?.canvas.getBoundingClientRect();
  return r ? { x: r.left, y: r.top } : { x: 0, y: 0 };
}

export function canvasSize(): { width: number; height: number } {
  const el = mounted?.canvas;
  return el ? { width: el.clientWidth, height: el.clientHeight } : { width: 0, height: 0 };
}

/** Client point → canvas-local point. */
export function clientToLocal(p: Point): Point {
  const o = canvasOrigin();
  return { x: p.x - o.x, y: p.y - o.y };
}

export function screenToWorld(p: { x: number; y: number }): { x: number; y: number } {
  return toWorld(viewport, clientToLocal(p));
}

export function worldToScreen(p: { x: number; y: number }): { x: number; y: number } {
  const o = canvasOrigin();
  const s = toScreen(viewport, p);
  return { x: s.x + o.x, y: s.y + o.y };
}

// Node elements register themselves (NodeView ref callbacks), so lookups are a map read instead of a
// selector query over a world that can hold 50k elements.
const elements = new Map<string, HTMLElement>();

export function registerNodeElement(id: string, el: HTMLElement | SVGElement | null) {
  frameCache.delete(id);
  if (el) elements.set(id, el as HTMLElement);
  else elements.delete(id);
}

export function unregisterNodeElement(id: string, el: HTMLElement | SVGElement) {
  if (elements.get(id) === el) { elements.delete(id); frameCache.delete(id); }
}

export function getNodeElement(id: string): HTMLElement | null {
  const world = mounted?.world;
  if (!world) return null;
  const el = elements.get(id);
  if (el && el.isConnected && world.contains(el)) return el;
  return null;
}

// ------------------------------------------------------------------ measurement cache
//
// Layout reads are batched per frame (SPEC §4.1): the first read of a node in a frame measures it, later
// reads in the same frame hit the cache. The cache is dropped at the next animation frame and whenever
// the document changes. Hit-testing, snapping, the overlay and the agent's worldX/Y all read through it.
// World rects do not depend on the viewport, so panning and zooming keep the cache valid.

const frameCache = new Map<string, WorldRect | null>();
const lastKnown = new Map<string, WorldRect>();
let clearScheduled = false;
/** after a document change the DOM updates during this frame, so reads skip the cache until the next one */
let bypass = false;
let measureCount = 0;

function scheduleClear() {
  if (clearScheduled) return;
  clearScheduled = true;
  requestAnimationFrame(() => {
    clearScheduled = false;
    bypass = false;
    frameCache.clear();
  });
}

/** Drop cached measurements (call after anything that changes layout outside the document). */
export function invalidateMeasurements() {
  frameCache.clear();
  bypass = true;
  scheduleClear();
}

/** Number of real layout reads so far (for the perf script). */
export function measurementCount(): number {
  return measureCount;
}

/** World-space bounding box of a rendered node (null when it is not rendered or hidden). */
export function getWorldRect(id: string): WorldRect | null {
  if (!bypass) {
    const hit = frameCache.get(id);
    if (hit !== undefined) return hit;
  }
  const el = getNodeElement(id);
  const r = el ? elementWorldRect(el) : null;
  measureCount++;
  if (!bypass) frameCache.set(id, r);
  if (r) lastKnown.set(id, r);
  scheduleClear();
  return r;
}

/** The last rect measured for a node, even if it is not rendered right now (virtualised artboards). */
export function lastKnownRect(id: string): WorldRect | null {
  return lastKnown.get(id) ?? null;
}

export function elementWorldRect(el: Element): Rect | null {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0 && !(el as HTMLElement).isConnected) return null;
  if (r.width === 0 && r.height === 0 && getComputedStyle(el).display === "none") return null;
  const o = canvasOrigin();
  const z = viewport.zoom;
  return { x: (r.left - o.x - viewport.x) / z, y: (r.top - o.y - viewport.y) / z, width: r.width / z, height: r.height / z };
}
