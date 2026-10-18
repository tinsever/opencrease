// Which gradient fill is open in the inspector, so the overlay can draw its on-canvas handles.
import type { NodeId } from "@opencrease/model";
import { createStore } from "./store";

export interface GradientEditState {
  /** null when no gradient editor is open */
  target: { fileId: string; nodeId: NodeId; layer: number } | null;
  /** stop highlighted in the editor and on the canvas */
  stop: number;
}

export const gradientEdit = createStore<GradientEditState>({ target: null, stop: 0 });

export function openGradientEdit(fileId: string, nodeId: NodeId, layer: number) {
  gradientEdit.set({ target: { fileId, nodeId, layer }, stop: 0 });
}

export function closeGradientEdit(nodeId?: NodeId) {
  const t = gradientEdit.get().target;
  if (t && (!nodeId || t.nodeId === nodeId)) gradientEdit.set({ target: null, stop: 0 });
}
