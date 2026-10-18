import { describe, expect, it } from "vitest";
import { createDocument } from "./document";
import { parseFold, serializeFold } from "./format";
import { DocStore } from "./store";

describe("optional node paint", () => {
  it("survives save, clone and undo, and can be removed", () => {
    const store = new DocStore(createDocument("Paint"));
    const root = store.doc.pages[store.doc.pageList[0].id].rootId;
    const paint = { shader: { name: "MeshGradient", params: { colors: ["red", "blue"] } }, shaderHidden: true, hiddenFills: [{ index: 1, css: "red", blend: "multiply" }] };
    let id = "";
    store.transact("Paint", (tx) => { [id] = tx.insertTrees(root, [{ type: "Frame", paint }]); });
    expect(parseFold(serializeFold(store.doc).documentJson).nodes[id].paint).toEqual(paint);
    let clone = "";
    store.transact("Clone", (tx) => { clone = tx.duplicateNode(id).newId; });
    store.transact("Remove", (tx) => tx.updateNode(clone, { paint: undefined }));
    expect(store.doc.nodes[clone].paint).toBeUndefined();
    expect(store.doc.nodes[id].paint).toEqual(paint);
    store.undo();
    expect(store.doc.nodes[clone].paint).toEqual(paint);
  });
  it("loads old files without adding paint metadata", () => {
    const doc = parseFold(serializeFold(createDocument("Old")).documentJson);
    for (const node of Object.values(doc.nodes)) expect(node).not.toHaveProperty("paint");
  });
});
