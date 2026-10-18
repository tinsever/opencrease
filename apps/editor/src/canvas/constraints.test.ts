import { describe, expect, it } from "vitest";
import { createDocument, DocStore } from "@opencrease/model";
import { boxPatch, constrainAxis, constrainBox, constraintPatches, type ChildBox } from "./constraints";

describe("constraint math", () => {
  // child at 20..60 inside a parent going from 100 to 200
  it.each([
    ["left", 20, 40],
    ["right", 120, 40],
    ["center", 70, 40],
    ["scale", 40, 80],
    ["stretch", 20, 140],
  ] as const)("%s", (c, start, size) => {
    expect(constrainAxis(c, 20, 40, 100, 200)).toEqual({ start, size });
  });

  it("works per axis and never goes negative when stretching", () => {
    const box: ChildBox = { left: 10, top: 10, width: 30, height: 30 };
    expect(constrainBox(box, { horizontal: "right", vertical: "bottom" }, { width: 100, height: 100 }, { width: 150, height: 80 })).toEqual({
      left: 60, top: -10, width: 30, height: 30,
    });
    expect(constrainAxis("stretch", 0, 10, 100, 50)).toEqual({ start: 0, size: 0 });
  });
});

function docWith(children: Array<{ styles: Record<string, string | number>; constraints?: { horizontal: "left" | "right" | "center" | "scale" | "stretch"; vertical: "top" | "bottom" | "center" | "scale" | "stretch" } }>) {
  const store = new DocStore(createDocument("C"));
  const rootId = store.doc.pages[store.doc.pageList[0].id].rootId;
  const [parent] = store.transact("p", (tx) => tx.insertTrees(rootId, [{ type: "Frame", styles: { width: 200, height: 100 }, children: children.map((c) => ({ type: "Frame", styles: c.styles })) }]));
  const ids = store.doc.nodes[parent].children;
  store.transact("c", (tx) => ids.forEach((id, i) => children[i].constraints && tx.updateNode(id, { constraints: children[i].constraints })));
  return { store, parent, ids };
}

describe("constraintPatches", () => {
  it("moves and resizes constrained absolute children only", () => {
    const { store, parent, ids } = docWith([
      { styles: { position: "absolute", left: 10, top: 10, width: 50, height: 20 }, constraints: { horizontal: "right", vertical: "top" } },
      { styles: { position: "absolute", left: 10, top: 40, width: 50, height: 20 } },
      { styles: { width: 50, height: 20 }, constraints: { horizontal: "stretch", vertical: "top" } },
      { styles: { position: "absolute", left: 20, top: 70, width: 160, height: 20 }, constraints: { horizontal: "stretch", vertical: "bottom" } },
    ]);
    const boxes: Record<string, ChildBox> = {
      [ids[0]]: { left: 10, top: 10, width: 50, height: 20 },
      [ids[3]]: { left: 20, top: 70, width: 160, height: 20 },
    };
    const patches = constraintPatches(store.doc, parent, { width: 200, height: 100 }, { width: 300, height: 150 }, (id) => boxes[id] ?? null);
    expect(patches).toEqual([
      { id: ids[0], styles: { left: 110 } },
      { id: ids[3], styles: { top: 120, width: 260 } },
    ]);
  });

  it("keeps a child anchored with right and bottom in that anchoring", () => {
    const { store, ids } = docWith([{ styles: { position: "absolute", right: 10, bottom: 10, width: 50, height: 20 }, constraints: { horizontal: "center", vertical: "scale" } }]);
    const node = store.doc.nodes[ids[0]];
    const before = { left: 140, top: 70, width: 50, height: 20 };
    const after = constrainBox(before, node.constraints!, { width: 200, height: 100 }, { width: 300, height: 200 });
    expect(boxPatch(node, before, after, { width: 300, height: 200 })).toEqual({ right: 60, bottom: 20, height: 40 });
  });

  it("leaves both-sided insets to the browser for stretch", () => {
    const { store, ids } = docWith([{ styles: { position: "absolute", left: 10, right: 10, top: 0, height: 20 }, constraints: { horizontal: "stretch", vertical: "top" } }]);
    const node = store.doc.nodes[ids[0]];
    const before = { left: 10, top: 0, width: 180, height: 20 };
    const after = constrainBox(before, node.constraints!, { width: 200, height: 100 }, { width: 400, height: 100 });
    expect(boxPatch(node, before, after, { width: 400, height: 100 })).toEqual({});
  });

  it("passes size changes on to nested constrained children", () => {
    const store = new DocStore(createDocument("N"));
    const rootId = store.doc.pages[store.doc.pageList[0].id].rootId;
    const [outer] = store.transact("p", (tx) =>
      tx.insertTrees(rootId, [
        { type: "Frame", styles: { width: 100, height: 100 }, children: [{ type: "Frame", styles: { position: "absolute", left: 0, top: 0, width: 100, height: 50 }, children: [{ type: "Frame", styles: { position: "absolute", left: 80, top: 0, width: 20, height: 20 } }] }] },
      ]),
    );
    const mid = store.doc.nodes[outer].children[0];
    const leaf = store.doc.nodes[mid].children[0];
    store.transact("c", (tx) => {
      tx.updateNode(mid, { constraints: { horizontal: "stretch", vertical: "top" } });
      tx.updateNode(leaf, { constraints: { horizontal: "right", vertical: "top" } });
    });
    const boxes: Record<string, ChildBox> = { [mid]: { left: 0, top: 0, width: 100, height: 50 }, [leaf]: { left: 80, top: 0, width: 20, height: 20 } };
    const patches = constraintPatches(store.doc, outer, { width: 100, height: 100 }, { width: 150, height: 100 }, (id) => boxes[id] ?? null);
    expect(patches).toEqual([
      { id: mid, styles: { width: 150 } },
      { id: leaf, styles: { left: 130 } },
    ]);
  });
});
