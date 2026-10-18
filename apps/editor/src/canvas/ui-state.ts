// Canvas-local transient UI state: drag previews, guides, marquee, drawing drafts.
import type { NodeId } from "@opencrease/model";
import type { Point, Rect } from "./geometry";
import type { Guide } from "./snapping";
import type { Measure } from "./spacing";
import { createStore } from "./store";

export type Gesture = "idle" | "move" | "resize" | "rotate" | "marquee" | "pan" | "draw" | "zoom";

export interface CanvasUi {
  gesture: Gesture;
  /** snapping guides, world space */
  guides: Guide[];
  /** marquee rect, world space */
  marquee: Rect | null;
  /** reorder insertion line, world space */
  insertLine: { x1: number; y1: number; x2: number; y2: number } | null;
  /** container that will receive a drop */
  dropTarget: NodeId | null;
  /** rect being drawn with an insertion tool, world space */
  draft: Rect | null;
  /** artboard whose label is being renamed */
  renaming: NodeId | null;
  /** Space held for temporary hand tool */
  spaceHeld: boolean;
  /** client point to place the caret at when text editing starts */
  caret: Point | null;
  /** live value while dragging a flex gap handle */
  gapDrag: { frameId: NodeId; value: number } | null;
  /** show the 1px pixel grid at 800% and above (persisted) */
  pixelGrid: boolean;
  /** layers outlined because a panel points at them (token usages in the Theme tab) */
  highlight: NodeId[];
  /** equal-spacing and distance measurements, world space */
  measures: Measure[];
  /** Alt is held (distance measurement on hover) */
  altHeld: boolean;
  /** live angle while rotating, degrees */
  rotating: number | null;
  /** live factor while the scale tool drags */
  scaling: number | null;
  /** open canvas context menu (client coordinates) */
  contextMenu: { x: number; y: number; kind: "layers" | "canvas"; ids: NodeId[] } | null;
}

const PIXEL_GRID_KEY = "opencrease.pixelGrid";

function readPixelGrid(): boolean {
  try {
    return globalThis.localStorage?.getItem(PIXEL_GRID_KEY) !== "off";
  } catch {
    return true;
  }
}

export const canvasUi = createStore<CanvasUi>({
  gesture: "idle",
  guides: [],
  marquee: null,
  insertLine: null,
  dropTarget: null,
  draft: null,
  renaming: null,
  spaceHeld: false,
  caret: null,
  gapDrag: null,
  pixelGrid: readPixelGrid(),
  highlight: [],
  measures: [],
  altHeld: false,
  rotating: null,
  scaling: null,
  contextMenu: null,
});

export function togglePixelGrid() {
  const next = !canvasUi.get().pixelGrid;
  canvasUi.set({ pixelGrid: next });
  try {
    globalThis.localStorage?.setItem(PIXEL_GRID_KEY, next ? "on" : "off");
  } catch {
    // storage unavailable: keep the in-memory value
  }
}

export function resetGesture() {
  canvasUi.set({ gesture: "idle", guides: [], marquee: null, insertLine: null, dropTarget: null, draft: null, measures: [], rotating: null, scaling: null });
}
