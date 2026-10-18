import type { FoldDocument } from "@opencrease/model";

/** Used inside one DocStore transaction so restore is undoable, including optional metadata. */
export function restoreDocument(draft: FoldDocument, snapshot: FoldDocument): void {
  if (draft.id !== snapshot.id) throw new Error("Snapshot belongs to another file");
  const clock = Math.max(draft.clock, snapshot.clock);
  const target = draft as unknown as Record<string, unknown>;
  for (const key of Object.keys(target)) if (!(key in snapshot)) delete target[key];
  Object.assign(draft, structuredClone(snapshot), { clock });
}
