// Repeat duplicate: after ⌥-drag (or ⌘D) makes copies and you move or rotate them, ⌘D makes the next
// copies with the same offset and the same extra rotation, so rotations compound (a dial, a fan of
// cards) the way design tools do it.
import type { FoldDocument, NodeId } from "@opencrease/model";
import { getActiveFile, setSelection } from "../state/workspace";
import { pxValue } from "./selection-logic";
import { nextStep, parseAngle, type StepTransform } from "./transform";

interface Step {
  fileId: string;
  sources: NodeId[];
  copies: NodeId[];
}

let last: Step | null = null;

/** Remember that `copies` were just made from `sources` (same order). */
export function recordDuplicate(fileId: string, sources: NodeId[], copies: NodeId[]) {
  last = sources.length === copies.length && sources.length > 0 ? { fileId, sources: [...sources], copies: [...copies] } : null;
}

export function forgetDuplicate() {
  last = null;
}

function transformOf(doc: FoldDocument, id: NodeId): StepTransform {
  const s = doc.nodes[id]?.styles ?? {};
  return { left: pxValue(s.left), top: pxValue(s.top), angle: parseAngle(s.rotate) };
}

/**
 * ⌘D on the copies of the last duplicate: make the next copies one step further. Returns false when the
 * selection is not those copies (the caller then duplicates normally).
 */
export function repeatDuplicate(): boolean {
  const file = getActiveFile();
  if (!file || !last || last.fileId !== file.id) return false;
  const doc = file.store.doc;
  const sel = new Set(file.selection);
  if (sel.size !== last.copies.length || !last.copies.every((id) => sel.has(id) && doc.nodes[id])) return false;
  if (!last.sources.every((id) => doc.nodes[id])) return false;
  const step = last;
  const patches = step.copies.map((id, i) => nextStep(transformOf(doc, step.sources[i]), transformOf(doc, id)));
  if (patches.every((p) => p === null)) return false;
  const created = file.store.transact("Duplicate", (tx) =>
    step.copies.map((id, i) => {
      const { newId } = tx.duplicateNode(id);
      const p = patches[i];
      if (p) tx.setStyles(newId, { ...p, right: null, bottom: null });
      return newId;
    }),
  );
  recordDuplicate(file.id, step.copies, created);
  setSelection(file.id, created);
  return true;
}
