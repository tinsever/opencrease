// Dragging a component from the Assets tab onto the canvas places an instance where it is dropped.
import { getActiveFile } from "../state/workspace";
import { placeInstance } from "../state/component-actions";
import { containerAt } from "./hit";
import { getCanvasElement, screenToWorld } from "./registry";
import { canvasUi } from "./ui-state";

export const COMPONENT_DRAG_TYPE = "application/x-opencrease-component";

let dragged: { id: string; library?: string } | null = null;
let installed = false;

function overCanvas(e: DragEvent): boolean {
  const canvas = getCanvasElement();
  return !!canvas && e.target instanceof Node && canvas.contains(e.target);
}

/** Call from the drag source's dragstart. */
export function startComponentDrag(e: { dataTransfer: DataTransfer | null }, id: string, library?: string) {
  dragged = { id, library };
  e.dataTransfer?.setData(COMPONENT_DRAG_TYPE, JSON.stringify(dragged));
  e.dataTransfer?.setData("text/plain", id);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
  install();
}

export function endComponentDrag() {
  dragged = null;
  if (canvasUi.get().dropTarget) canvasUi.set({ dropTarget: null });
}

function install() {
  if (installed) return;
  installed = true;
  document.addEventListener("dragover", (e) => {
    if (!dragged || !overCanvas(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    const doc = getActiveFile()?.store.doc;
    const target = doc ? containerAt(doc, e.clientX, e.clientY) : null;
    if (canvasUi.get().dropTarget !== target) canvasUi.set({ dropTarget: target });
  });
  document.addEventListener("drop", (e) => {
    if (!dragged || !overCanvas(e)) return;
    e.preventDefault();
    const doc = getActiveFile()?.store.doc;
    const containerId = doc ? containerAt(doc, e.clientX, e.clientY) : null;
    const item = dragged;
    endComponentDrag();
    placeInstance(item.id, item.library, { world: screenToWorld({ x: e.clientX, y: e.clientY }), containerId });
  });
}
