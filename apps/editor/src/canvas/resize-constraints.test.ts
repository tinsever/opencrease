import { describe, expect, it } from "vitest";
import { createDocument, DocStore } from "@opencrease/model";
import { resizeConstraintPatches } from "./resize-constraints";

describe("constraints on style writes", () => {
  it("propagates nested resizing and preserves right anchors without a rendered canvas", () => {
    const store = new DocStore(createDocument("Constraints"));
    const root = Object.values(store.doc.pages)[0].rootId;
    const [id] = store.transact("Setup", (tx) => tx.insertTrees(root, [{ type: "Frame", styles: { width: 200, height: 100 }, children: [
      { type: "Frame", styles: { position: "absolute", left: 20, top: 10, width: 100, height: 80 }, constraints: { horizontal: "stretch", vertical: "top" }, children: [
        { type: "Rectangle", styles: { position: "absolute", left: 70, top: 5, width: 20, height: 20 }, constraints: { horizontal: "right", vertical: "top" } },
      ] },
      { type: "Rectangle", styles: { position: "absolute", right: 10, top: 5, width: 20, height: 20 }, constraints: { horizontal: "right", vertical: "top" } },
    ] }]));
    const [frame, anchored] = store.doc.nodes[id].children;
    const inner = store.doc.nodes[frame].children[0];
    expect(resizeConstraintPatches(store.doc, id, { width: 300 }, () => null)).toEqual([
      { id: frame, styles: { width: 200 } }, { id: inner, styles: { left: 170 } },
    ]);
    expect(store.doc.nodes[anchored].styles.right).toBe(10);
  });
});
