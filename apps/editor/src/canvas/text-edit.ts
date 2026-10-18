// In-place text editing: start, live sync, rich formatting of the selected range, commit and cancel.
import type { NodeId, StyleMap, StyleValue } from "@opencrease/model";
import { getActiveFile, getState, setEditingText, setSelection } from "../state/workspace";
import type { Point } from "./geometry";
import { buildEditableDom, readEditableDom, restoreSelection, richText, selectionOffsets, styleState, type RichState } from "./rich-edit";
import { canvasUi } from "./ui-state";

/** Read plain text from the contentEditable element. */
export function readEditableText(el: HTMLElement): string {
  return readEditableDom(el).text;
}

/** Key of a text state, to tell our own syncs from outside changes. */
export function richKey(state: { text?: string; spans?: unknown }): string {
  return JSON.stringify([state.text ?? "", state.spans ?? null]);
}

/** What the editable DOM last wrote to (or read from) the store, per node. */
export const lastSynced = new Map<NodeId, string>();
let session = 0;

export function editingElement(id?: NodeId | null): HTMLElement | null {
  const nodeId = id ?? getState().editingTextId;
  if (!nodeId) return null;
  return document.querySelector<HTMLElement>(`[data-of-editing][data-of-id="${CSS.escape(nodeId)}"]`);
}

export function startTextEdit(id: NodeId, caret?: Point) {
  const file = getActiveFile();
  const node = file?.store.doc.nodes[id];
  if (!file || !node || node.type !== "Text" || node.locked) return;
  setSelection(file.id, [id]);
  canvasUi.set({ caret: caret ?? null });
  session++;
  richText.set({ range: null });
  setEditingText(id);
}

/** Write the editable's current content to the store as part of this edit session's single undo step. */
export function syncTextEdit(id: NodeId, state?: RichState): void {
  const file = getActiveFile();
  const node = file?.store.doc.nodes[id];
  const el = editingElement(id);
  if (!file || !node || (!el && !state)) return;
  const next = state ?? readEditableDom(el!);
  const key = richKey(next);
  lastSynced.set(id, key);
  if (key === richKey(node)) return;
  file.store.transact("Edit text", (tx) => tx.updateNode(id, { text: next.text, spans: next.spans }), { mergeKey: `edit-text:${id}:${session}` });
}

/** Commit the edit. Empty text nodes are removed. Safe to call twice (blur after Escape). */
export function commitTextEdit(id: NodeId, el?: HTMLElement | null) {
  if (getState().editingTextId !== id) return;
  const file = getActiveFile();
  const element = el ?? editingElement(id);
  const state = element ? readEditableDom(element) : null;
  canvasUi.set({ caret: null });
  richText.set({ range: null });
  setEditingText(null);
  lastSynced.delete(id);
  if (!file) return;
  const node = file.store.doc.nodes[id];
  if (!node) return;
  const text = state ? state.text : (node.text ?? "");
  if (text.trim() === "") {
    file.store.transact("Delete empty text", (tx) => {
      if (tx.doc.nodes[id]) tx.deleteNode(id);
    });
    setSelection(file.id, file.selection.filter((s) => s !== id));
    return;
  }
  if (state && richKey(state) !== richKey(node)) {
    file.store.transact("Edit text", (tx) => tx.updateNode(id, { text: state.text, spans: state.spans }), { mergeKey: `edit-text:${id}:${session}` });
  }
}

/** Commit whatever text edit is in progress. */
export function commitActiveTextEdit() {
  const id = getState().editingTextId;
  if (id) commitTextEdit(id);
}

/** The selected character range of the text being edited, if it is not collapsed. */
export function activeTextRange(): { id: NodeId; start: number; end: number } | null {
  const id = getState().editingTextId;
  if (!id) return null;
  const el = editingElement(id);
  if (el && document.activeElement === el) {
    const sel = selectionOffsets(el);
    return sel && sel.end > sel.start ? { id, ...sel } : null;
  }
  const range = richText.get().range;
  return range && range.nodeId === id && range.end > range.start ? { id, start: range.start, end: range.end } : null;
}

/**
 * Applies span styles to the selected range of the text being edited. The patch can depend on the
 * current state (for toggles). Returns false when there is no non-empty range (callers then style the node).
 */
export function formatTextRange(
  label: string,
  patch: Record<string, StyleValue | null> | ((state: RichState, start: number, end: number, nodeStyles: StyleMap) => Record<string, StyleValue | null>),
  mergeKey?: string,
): boolean {
  const range = activeTextRange();
  const file = getActiveFile();
  if (!range || !file) return false;
  const el = editingElement(range.id);
  const node = file.store.doc.nodes[range.id];
  if (!node) return false;
  const state = el ? readEditableDom(el) : { text: node.text ?? "", spans: node.spans };
  const p = typeof patch === "function" ? patch(state, range.start, range.end, node.styles) : patch;
  const next = styleState(state, range.start, range.end, p);
  lastSynced.set(range.id, richKey(next));
  file.store.transact(label, (tx) => tx.updateNode(range.id, { text: next.text, spans: next.spans }), { mergeKey: mergeKey ? `${mergeKey}:${range.id}` : undefined });
  if (el) {
    buildEditableDom(el, next);
    if (document.activeElement === el) restoreSelection(el, range.start, range.end);
  }
  richText.set({ range: { nodeId: range.id, start: range.start, end: range.end } });
  return true;
}
