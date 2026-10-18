import { describe, expect, it } from "vitest";
import { createDocument } from "./document";
import { ModelError } from "./errors";
import { parseFold, serializeFold } from "./format";
import { DocStore } from "./store";

function setup() {
  const store = new DocStore(createDocument("Test", { id: "F", now: 1000 }), { now: () => 2000 });
  const rootId = store.doc.pages[store.doc.pageList[0].id].rootId;
  const [frame] = store.transact("build", (tx) => tx.insertTrees(rootId, [{ type: "Frame", children: [{ type: "Rectangle", styles: { position: "absolute" } }] }]));
  const child = store.doc.nodes[frame].children[0];
  return { store, frame, child };
}

describe("node constraints", () => {
  it("are stored by updateNode and default left/top removes the field", () => {
    const { store, child } = setup();
    store.transact("c", (tx) => tx.updateNode(child, { constraints: { horizontal: "stretch", vertical: "bottom" } }));
    expect(store.doc.nodes[child].constraints).toEqual({ horizontal: "stretch", vertical: "bottom" });
    store.transact("c", (tx) => tx.updateNode(child, { constraints: { horizontal: "left", vertical: "top" } }));
    expect(store.doc.nodes[child].constraints).toBeUndefined();
    store.transact("c", (tx) => tx.updateNode(child, { constraints: { horizontal: "center", vertical: "top" } }));
    store.transact("c", (tx) => tx.updateNode(child, { constraints: undefined }));
    expect("constraints" in store.doc.nodes[child]).toBe(false);
  });

  it("reject unknown values", () => {
    const { store, child } = setup();
    expect(() =>
      store.transact("c", (tx) => tx.updateNode(child, { constraints: { horizontal: "middle" as never, vertical: "top" } })),
    ).toThrow(ModelError);
  });

  it("are undoable and survive duplicate and a save round trip", () => {
    const { store, child } = setup();
    store.transact("c", (tx) => tx.updateNode(child, { constraints: { horizontal: "scale", vertical: "center" } }));
    const dup = store.transact("d", (tx) => tx.duplicateNode(child).newId);
    expect(store.doc.nodes[dup].constraints).toEqual({ horizontal: "scale", vertical: "center" });
    const back = parseFold(serializeFold(store.doc).documentJson);
    expect(back.nodes[child].constraints).toEqual({ horizontal: "scale", vertical: "center" });
    store.undo();
    store.undo();
    expect(store.doc.nodes[child].constraints).toBeUndefined();
  });

  it("normalise junk in files and accept files without them", () => {
    const { store, child, frame } = setup();
    const doc = JSON.parse(serializeFold(store.doc).documentJson);
    doc.nodes[child].constraints = { horizontal: "bogus", vertical: "bottom" };
    doc.nodes[frame].constraints = "nope";
    const back = parseFold(JSON.stringify(doc));
    expect(back.nodes[child].constraints).toEqual({ horizontal: "left", vertical: "bottom" });
    expect(back.nodes[frame].constraints).toBeUndefined();
  });
});
