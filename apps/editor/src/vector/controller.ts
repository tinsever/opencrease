// Glue between the canvas and vector editing: pointer routing, keyboard shortcuts (P, L, O, Enter,
// Esc, Delete, arrows, ⇧⌘') and keeping path edit mode in sync with the selection and the document.
import type { NodeId } from "@opencrease/model";
import { getActiveFile, getOpenFile, getState, setTool, subscribe, type Tool } from "../state/workspace";
import { isDragging } from "../canvas/interactions";
import { canvasUi } from "../canvas/ui-state";
import { canEditPath, deleteSelectedPoints, editPointerDown, enterPathEdit, exitPathEdit, nudgeSelectedPoints, selectAllPoints } from "./edit";
import { beginShapeDraw, cancelPen, finishPen, isSvgShapeTool, penPointerDown, penPointerMove, penUndoPoint } from "./pen";
import { toggleSnapHalf, vectorUi } from "./state";

/** Called first by the canvas pointer handler. Returns true when vector editing took the press. */
export function vectorPointerDown(e: PointerEvent, clicks: number): boolean {
  const tool = getState().tool;
  if (tool === "pen") {
    penPointerDown(e);
    return true;
  }
  if (isSvgShapeTool(tool)) {
    beginShapeDraw(e, tool);
    return true;
  }
  if (vectorUi.get().edit) return editPointerDown(e, clicks);
  return false;
}

/** Double-click on a layer: enter path edit mode when it is (or holds a single) path or shape. */
export function vectorDoubleClick(fileId: string, ids: Array<NodeId | null>): boolean {
  const file = getOpenFile(fileId);
  if (!file) return false;
  for (const id of ids) {
    if (!id) continue;
    const node = file.store.doc.nodes[id];
    // a shape element is only entered directly once its SVG (or itself) is selected
    if (node?.type === "SVGElement" && !file.selection.includes(id) && !file.selection.includes(node.parentId ?? "")) continue;
    if (canEditPath(file.store.doc, id)) return enterPathEdit(fileId, id);
  }
  return false;
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}

const TOOL_KEYS: Record<string, Tool> = { p: "pen", l: "line", o: "ellipse" };

function stop(e: KeyboardEvent) {
  e.preventDefault();
  e.stopPropagation();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return;
  if (e.target instanceof Element && e.target.closest("[role=dialog], [role=menu], .of-panel, .of-titlebar")) return;
  const s = getState();
  if (s.route.kind !== "file" || !getActiveFile()) return;
  if (s.editingTextId || isTyping() || canvasUi.get().renaming) return;
  const meta = e.metaKey || e.ctrlKey;
  const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();

  // ⇧⌘' toggles half-pixel snapping everywhere
  if (meta && e.shiftKey && (e.code === "Quote" || key === "'" || key === '"')) {
    stop(e);
    toggleSnapHalf();
    return;
  }
  if (isDragging()) return;

  const ui = vectorUi.get();
  if (ui.pen && s.tool === "pen") {
    if (e.key === "Enter" || e.key === "Escape") {
      stop(e);
      finishPen(false);
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      stop(e);
      penUndoPoint();
      return;
    }
  }

  if (ui.edit) {
    if (e.key === "Escape" || (e.key === "Enter" && !meta)) {
      stop(e);
      exitPathEdit();
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      stop(e);
      deleteSelectedPoints();
      return;
    }
    if (e.key.startsWith("Arrow")) {
      stop(e);
      const n = e.shiftKey ? 10 : 1;
      nudgeSelectedPoints(e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0, e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0);
      return;
    }
    if (meta && key === "a") {
      stop(e);
      selectAllPoints();
      return;
    }
    if (e.key === "Tab") {
      stop(e);
      return;
    }
  }

  if (!meta && !e.altKey && !e.shiftKey && TOOL_KEYS[key]) {
    stop(e);
    exitPathEdit();
    setTool(TOOL_KEYS[key]);
    return;
  }

  // Enter on a selected path or shape layer starts editing its points
  if (e.key === "Enter" && !e.shiftKey && !meta && !ui.edit) {
    const file = getActiveFile()!;
    if (file.selection.length === 1 && canEditPath(file.store.doc, file.selection[0])) {
      stop(e);
      enterPathEdit(file.id, file.selection[0]);
    }
  }
}

/** Leave path edit mode when the edited layer disappears, the selection moves on or another tool is picked. */
function checkSession() {
  const ui = vectorUi.get();
  const s = getState();
  if (ui.pen && (s.tool !== "pen" || s.activeFileId !== ui.pen.fileId)) cancelPen();
  const edit = ui.edit;
  if (!edit) return;
  const file = getOpenFile(edit.fileId);
  const doc = file?.store.doc;
  const ok =
    !!file &&
    !!doc &&
    s.activeFileId === edit.fileId &&
    s.route.kind === "file" &&
    !!doc.nodes[edit.pathId] &&
    !!doc.nodes[edit.svgId] &&
    (s.tool === "move" || s.tool === "hand") &&
    file.selection.length === 1 &&
    (file.selection[0] === edit.svgId || file.selection[0] === edit.pathId) &&
    doc.pages[file.activePageId] !== undefined;
  if (!ok) exitPathEdit();
}

/** Install keyboard and pointer handling for vector editing. Returns an uninstall function. */
export function installVectorController(canvas: HTMLElement, fileId: string): () => void {
  window.addEventListener("keydown", onKeyDown, true);
  canvas.addEventListener("pointermove", penPointerMove);
  const unsubWorkspace = subscribe(checkSession);
  const store = getOpenFile(fileId)?.store;
  // undo can remove the edited path; stale point selections are filtered where they are read
  const unsubDoc = store?.subscribe(checkSession);
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    canvas.removeEventListener("pointermove", penPointerMove);
    unsubWorkspace();
    unsubDoc?.();
    exitPathEdit();
    cancelPen();
  };
}
