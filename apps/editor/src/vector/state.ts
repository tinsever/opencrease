// Transient vector editing state shared by the canvas overlay, interactions and the inspector:
// the pen tool's draft path, path edit mode and the half-pixel snapping preference.
import type { NodeId } from "@opencrease/model";
import { createStore } from "../canvas/store";
import type { Anchor, PointType, Pt } from "./path";
import type { ShapeKind } from "./shapes";

export interface PenDraft {
  fileId: string;
  /** world coordinates */
  anchors: Anchor[];
  /** pointer position (world) for the rubber band, null while the pointer is away */
  cursor: Pt | null;
  /** the pointer is over the first anchor and a click would close the path */
  closing: boolean;
  /** container under the first click */
  containerId: NodeId | null;
}

export type PathEditTool = "bend" | "add";

export interface PathEdit {
  fileId: string;
  svgId: NodeId;
  pathId: NodeId;
  /** selected anchors as "subpath:index" keys */
  selected: string[];
  tool: PathEditTool;
  /** point types the user picked explicitly; geometry alone cannot tell asymmetric from mirrored when lengths match */
  types: Record<string, PointType>;
}

export interface ShapeDraft {
  kind: ShapeKind;
  /** world points: a line runs from a to b, other shapes fill the box spanned by a and b */
  a: Pt;
  b: Pt;
}

export interface VectorUi {
  pen: PenDraft | null;
  edit: PathEdit | null;
  /** snap pen and path points to half pixels (persisted) */
  snapHalf: boolean;
  /** live readout next to the point being dragged, screen (canvas-local) coordinates */
  readout: { x: number; y: number; text: string } | null;
  /** point marquee, canvas-local screen rect */
  marquee: { x: number; y: number; width: number; height: number } | null;
  /** shape being dragged out with a shape tool */
  shape: ShapeDraft | null;
  /** shape shown on the toolbar's shape button */
  lastShape: ShapeKind;
}

const SNAP_KEY = "opencrease.snapHalfPixel";

function readSnap(): boolean {
  try {
    return globalThis.localStorage?.getItem(SNAP_KEY) === "on";
  } catch {
    return false;
  }
}

export const vectorUi = createStore<VectorUi>({
  pen: null,
  edit: null,
  snapHalf: readSnap(),
  readout: null,
  marquee: null,
  shape: null,
  lastShape: "rect",
});

export function toggleSnapHalf() {
  const next = !vectorUi.get().snapHalf;
  vectorUi.set({ snapHalf: next });
  try {
    globalThis.localStorage?.setItem(SNAP_KEY, next ? "on" : "off");
  } catch {
    // storage unavailable
  }
}

export function snapValue(v: number, on = vectorUi.get().snapHalf): number {
  return on ? Math.round(v * 2) / 2 : v;
}

export function isEditingPath(fileId?: string | null): boolean {
  const e = vectorUi.get().edit;
  return !!e && (!fileId || e.fileId === fileId);
}
