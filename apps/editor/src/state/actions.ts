// Common document actions used by the canvas, panels and keyboard shortcuts.
// Each action is one undo step on the active file.
import { artboardOf, type NodeId, type NodeTree } from "@opencrease/model";
import { tryAction } from "../ui/Notice";
import { getActiveFile, setSelection } from "./workspace";

function active() {
  const file = getActiveFile();
  if (!file) throw new Error("No active file");
  return file;
}

export function undo() {
  getActiveFile()?.store.undo();
}

export function redo() {
  getActiveFile()?.store.redo();
}

export function deleteSelection() {
  const file = getActiveFile();
  if (!file || file.selection.length === 0) return;
  const ids = file.selection.filter((id) => !file.store.doc.nodes[id]?.locked);
  // layers inside an instance cannot be deleted (hide them instead); the notice explains why
  const ok = tryAction(() => file.store.transact("Delete", (tx) => {
    for (const id of ids) if (tx.doc.nodes[id]) tx.deleteNode(id);
    return true;
  }));
  if (ok) setSelection(file.id, []);
}

export function duplicateSelection() {
  const file = getActiveFile();
  if (!file || file.selection.length === 0) return;
  const created = tryAction(() => file.store.transact("Duplicate", (tx) => file.selection.map((id) => tx.duplicateNode(id).newId)));
  if (created) setSelection(file.id, created);
}

export function insertTrees(parentId: NodeId, trees: NodeTree[], label = "Insert", index?: number): NodeId[] {
  const file = active();
  const ids = file.store.transact(label, (tx) => tx.insertTrees(parentId, trees, index));
  setSelection(file.id, ids);
  return ids;
}

export function setStyles(ids: NodeId[], styles: Record<string, string | number | null>, label = "Change style", mergeKey?: string) {
  const file = getActiveFile();
  if (!file || ids.length === 0) return;
  file.store.transact(label, (tx) => {
    for (const id of ids) if (tx.doc.nodes[id]) tx.setStyles(id, styles);
  }, { mergeKey });
}

export function renameNode(id: NodeId, name: string) {
  active().store.transact("Rename", (tx) => tx.updateNode(id, { name }));
}

export function toggleVisible(id: NodeId) {
  const file = active();
  const node = file.store.doc.nodes[id];
  if (node) file.store.transact(node.visible ? "Hide" : "Show", (tx) => tx.updateNode(id, { visible: !node.visible }));
}

export function toggleLocked(id: NodeId) {
  const file = active();
  const node = file.store.doc.nodes[id];
  if (node) file.store.transact(node.locked ? "Unlock" : "Lock", (tx) => tx.updateNode(id, { locked: !node.locked }));
}

/** Wrap the selection in a new flex frame (Shift+A) or a plain frame (Cmd+G). */
export function wrapSelection(kind: "flex-row" | "flex-column" | "frame") {
  const file = getActiveFile();
  if (!file || file.selection.length === 0) return;
  const doc = file.store.doc;
  const first = doc.nodes[file.selection[0]];
  if (!first?.parentId) return;
  const parent = doc.nodes[first.parentId];
  const index = parent.children.indexOf(first.id);
  const styles: Record<string, string | number> =
    kind === "frame" ? { display: "flex" } : { display: "flex", flexDirection: kind === "flex-row" ? "row" : "column", gap: 8 };
  const wrapperId = tryAction(() => file.store.transact(kind === "frame" ? "Wrap in frame" : "Add flex layout", (tx) => {
    const [id] = tx.insertTrees(parent.id, [{ type: "Frame", name: "Frame", styles }], index);
    for (const childId of file.selection) tx.moveNode(childId, id);
    return id;
  }));
  if (wrapperId) setSelection(file.id, [wrapperId]);
}

export { artboardOf };
