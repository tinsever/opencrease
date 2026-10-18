import { describe, expect, it } from "vitest";
import { createDocument } from "./document";
import { parseFold, serializeFold } from "./format";
import { DocStore } from "./store";

describe("gen spec on nodes", () => {
  it("is optional, round-trips and drops junk fields", () => {
    const store = new DocStore(createDocument("Gen", { id: "01GEN" }));
    const rootId = store.doc.pages[store.doc.pageList[0].id].rootId;
    const [img] = store.transact("insert", (tx) => tx.insertTrees(rootId, [{ type: "Image", src: "asset://abc", styles: { width: 400, height: 300 } }]));
    store.transact("gen", (tx) => tx.updateNode(img, { gen: { prompt: "Clay vase on linen", target: "src", model: "m1", seed: 42, width: 400, height: 300 } }));
    const back = parseFold(serializeFold(store.doc).documentJson);
    expect(back.nodes[img].gen).toEqual({ prompt: "Clay vase on linen", target: "src", model: "m1", seed: 42, width: 400, height: 300 });

    const raw = JSON.parse(serializeFold(store.doc).documentJson);
    raw.nodes[img].gen = { prompt: "x", target: "weird", seed: "7", extra: true, edit: true };
    expect(parseFold(JSON.stringify(raw)).nodes[img].gen).toEqual({ prompt: "x", target: "src", edit: true });
    delete raw.nodes[img].gen;
    expect(parseFold(JSON.stringify(raw)).nodes[img].gen).toBeUndefined();
    raw.nodes[img].gen = { prompt: "" };
    expect(parseFold(JSON.stringify(raw)).nodes[img].gen).toBeUndefined();
  });

  it("can be set on frames (fill target) and cleared", () => {
    const store = new DocStore(createDocument("Gen"));
    const rootId = store.doc.pages[store.doc.pageList[0].id].rootId;
    const [frame] = store.transact("insert", (tx) => tx.insertTrees(rootId, [{ type: "Frame", styles: { width: 100, height: 100 } }]));
    store.transact("gen", (tx) => tx.updateNode(frame, { gen: { prompt: "Dusk", target: "fill" } }));
    expect(store.doc.nodes[frame].gen?.target).toBe("fill");
    store.transact("clear", (tx) => tx.updateNode(frame, { gen: undefined }));
    expect(store.doc.nodes[frame].gen).toBeUndefined();
  });
});
