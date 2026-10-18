import { expect, it } from "vitest";
import { createDocument, DocStore } from "@opencrease/model";
import { restoreDocument } from "./restore";
it("restores removed optional metadata and structure as one undo step without reusing ids", () => {
  const original = createDocument("Before");
  const store = new DocStore(structuredClone(original));
  store.transact("Change", (tx) => { tx.doc.clock = 123; tx.doc.briefs = [{ id: "b", artboardId: null, mood: "New", palette: "Ink", type: "Serif", direction: "New", createdAt: 1 }]; tx.setDocName("After"); });
  store.transact("Restore", (tx) => restoreDocument(tx.doc, original));
  expect(store.doc.briefs).toBeUndefined();
  expect(store.doc.name).toBe("Before");
  expect(store.doc.clock).toBe(123);
  store.undo();
  expect(store.doc.name).toBe("After");
  expect(store.doc.briefs).toHaveLength(1);
});
