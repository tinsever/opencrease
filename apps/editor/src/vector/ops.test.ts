import { describe, expect, it } from "vitest";
import { createDocument, DocStore, type NodeId } from "@opencrease/model";
import { parsePath, pathBounds } from "./path";
import { booleanOp, convertToPath, flatten, outlineStroke, VectorOpError, type OpsEnv } from "./ops";
import { shapeTree } from "./shapes";

const near = (a: number, b: number, eps = 0.05) => expect(Math.abs(a - b)).toBeLessThan(eps);

function setup() {
  const store = new DocStore(createDocument("T", { id: "F", now: 1 }));
  const rootId = store.doc.pages[store.doc.pageList[0].id].rootId;
  const place = (tree: ReturnType<typeof shapeTree>, left: number, top: number): NodeId =>
    store.transact("add", (tx) => tx.insertTrees(rootId, [{ ...tree, styles: { ...tree.styles, left, top } }]))[0];
  // world rects straight from left/top/width/height (page-level layers)
  const env = (): OpsEnv => ({
    doc: store.doc,
    measure: (id) => {
      const n = store.doc.nodes[id];
      if (!n) return null;
      return { x: Number(n.styles.left ?? 0), y: Number(n.styles.top ?? 0), width: Number(n.styles.width ?? 0), height: Number(n.styles.height ?? 0) };
    },
    origin: () => ({ x: 0, y: 0 }),
  });
  return { store, rootId, place, env };
}

function boundsOf(store: DocStore, id: NodeId) {
  const svg = store.doc.nodes[id];
  const path = store.doc.nodes[svg.children[0]];
  return { svg, path, b: pathBounds(parsePath(path.attrs!.d)) };
}

describe("boolean operations", () => {
  it("unites two rectangles into one path layer at the right place", () => {
    const { store, rootId, place, env } = setup();
    const a = place(shapeTree("rect", 100, 100), 0, 0);
    const b = place(shapeTree("rect", 100, 100), 50, 50);
    const res = store.transact("Union", (tx) => booleanOp(env(), tx, [a, b], "union"));
    expect(res.created).toHaveLength(1);
    expect(res.removed.sort()).toEqual([a, b].sort());
    expect(store.doc.nodes[rootId].children).toEqual(res.created);
    const { svg, path, b: bounds } = boundsOf(store, res.created[0]);
    expect(svg.name).toBe("Union");
    expect(svg.styles).toMatchObject({ left: 0, top: 0, width: 150, height: 150 });
    expect(svg.attrs?.viewBox).toBe("0 0 150 150");
    expect(path.attrs?.fill).toBe("#D9D9D9");
    near(bounds!.width, 150);
  });

  it("subtracts the upper layers from the bottom one, keeping curves", () => {
    const { store, place, env } = setup();
    const a = place(shapeTree("rect", 100, 100), 0, 0);
    const b = place(shapeTree("ellipse", 100, 100), 50, 0);
    const res = store.transact("Subtract", (tx) => booleanOp(env(), tx, [b, a], "subtract"));
    const { svg, path } = boundsOf(store, res.created[0]);
    expect(svg.styles).toMatchObject({ left: 0, top: 0, width: 100, height: 100 });
    expect(path.attrs?.d).toContain("C");
  });

  it("intersects and excludes", () => {
    const { store, place, env } = setup();
    const a = place(shapeTree("rect", 100, 100), 0, 0);
    const b = place(shapeTree("rect", 100, 100), 50, 50);
    const res = store.transact("Intersect", (tx) => booleanOp(env(), tx, [a, b], "intersect"));
    expect(boundsOf(store, res.created[0]).svg.styles).toMatchObject({ left: 50, top: 50, width: 50, height: 50 });

    const c = place(shapeTree("rect", 100, 100), 0, 300);
    const d = place(shapeTree("rect", 100, 100), 50, 350);
    const ex = store.transact("Exclude", (tx) => booleanOp(env(), tx, [c, d], "exclude"));
    const { path } = boundsOf(store, ex.created[0]);
    expect(path.attrs?.["fill-rule"]).toBe("evenodd");
  });

  it("rejects empty results and single operands", () => {
    const { store, place, env } = setup();
    const a = place(shapeTree("rect", 10, 10), 0, 0);
    const b = place(shapeTree("rect", 10, 10), 100, 100);
    expect(() => store.transact("x", (tx) => booleanOp(env(), tx, [a, b], "intersect"))).toThrow(VectorOpError);
    expect(() => store.transact("x", (tx) => booleanOp(env(), tx, [a], "union"))).toThrow(VectorOpError);
    expect(store.doc.nodes[a]).toBeDefined();
  });

  it("treats rectangle boxes as operands", () => {
    const { store, rootId, place, env } = setup();
    const box = store.transact("box", (tx) => tx.insertTrees(rootId, [{ type: "Rectangle", styles: { left: 0, top: 0, width: 40, height: 40, backgroundColor: "#ff0000" } }]))[0];
    const e = place(shapeTree("ellipse", 40, 40), 20, 0);
    const res = store.transact("Union", (tx) => booleanOp(env(), tx, [box, e], "union"));
    const { path, svg } = boundsOf(store, res.created[0]);
    expect(path.attrs?.fill).toBe("#ff0000");
    expect(svg.styles).toMatchObject({ width: 60, height: 40 });
  });
});

describe("flatten, outline stroke, convert to path", () => {
  it("flattens several layers into one path", () => {
    const { store, place, env } = setup();
    const a = place(shapeTree("rect", 10, 10), 0, 0);
    const b = place(shapeTree("star", 10, 10), 20, 0);
    const res = store.transact("Flatten", (tx) => flatten(env(), tx, [a, b]));
    const { svg, path } = boundsOf(store, res.created[0]);
    expect(svg.styles).toMatchObject({ width: 30, height: 10 });
    expect(parsePath(path.attrs!.d)).toHaveLength(2);
  });

  it("outlines a stroked line into a filled shape", () => {
    const { store, place, env } = setup();
    const line = place(shapeTree("line", 100, 1, { a: { x: 0, y: 0.5 }, b: { x: 100, y: 0.5 } }), 0, 10);
    const res = store.transact("Outline", (tx) => outlineStroke(env(), tx, [line]));
    const { svg, path } = boundsOf(store, res.created[0]);
    expect(path.attrs?.fill).toBe("#000000");
    expect(path.attrs?.stroke).toBeUndefined();
    near(Number(svg.styles.height), 1.5);
    near(Number(svg.styles.width), 100);
  });

  it("converts primitives to paths in place", () => {
    const { store, place, env } = setup();
    const s = place(shapeTree("ellipse", 20, 10), 0, 0);
    store.transact("Convert", (tx) => convertToPath(env(), tx, [s]));
    const el = store.doc.nodes[store.doc.nodes[s].children[0]];
    expect(el.tag).toBe("path");
    expect(el.name).toBe("Path");
    expect(el.attrs?.rx).toBeUndefined();
    const b = pathBounds(parsePath(el.attrs!.d))!;
    near(b.width, 20, 1e-3);
  });
});

describe("stroke fidelity and safe operations", () => {
  function stroke(cap: string, dash?: string, matrix?: [number, number, number, number, number, number]) {
    const ctx = setup();
    const id = ctx.place(shapeTree("line", 100, 1, { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }), 0, 0);
    const pathId = ctx.store.doc.nodes[id].children[0];
    ctx.store.transact("Stroke", (tx) => tx.updateNode(pathId, { attrs: { ...tx.doc.nodes[pathId].attrs, "stroke-width": "10", "stroke-linecap": cap, ...(dash ? { "stroke-dasharray": dash } : {}) } }));
    const env = ctx.env();
    if (matrix) env.matrix = () => matrix;
    const before = ctx.store.doc;
    const res = ctx.store.transact("Outline", (tx) => outlineStroke(env, tx, [id]));
    return { ...ctx, id: res.created[0], before };
  }
  it("keeps square and round cap extents", () => {
    for (const cap of ["square", "round"]) {
      const { store, id } = stroke(cap);
      const { svg } = boundsOf(store, id);
      near(Number(svg.styles.left), -5);
      near(Number(svg.styles.width), 110);
      near(Number(svg.styles.height), 10);
    }
  });
  it("outlines dashes separately and supports zero-length round dots", () => {
    const dashed = stroke("butt", "20 10");
    const { path } = boundsOf(dashed.store, dashed.id);
    expect(parsePath(path.attrs!.d)).toHaveLength(4);
    const dotted = stroke("round", "0 20");
    expect(parsePath(boundsOf(dotted.store, dotted.id).path.attrs!.d)).toHaveLength(5);
  });
  it("expands strokes before applying nonuniform transforms, and undoes atomically", () => {
    const { store, id, before } = stroke("square", undefined, [2, 0, 0, 3, 20, 40]);
    const { svg } = boundsOf(store, id);
    near(Number(svg.styles.left), 10);
    near(Number(svg.styles.top), 25);
    near(Number(svg.styles.width), 220);
    near(Number(svg.styles.height), 30);
    store.undo();
    expect(store.doc.nodes).toEqual(before.nodes);
  });
  it("rejects locked layers and clipping references without deleting anything", () => {
    const { store, place, env } = setup();
    const a = place(shapeTree("rect", 20, 20), 0, 0);
    const b = place(shapeTree("rect", 20, 20), 10, 10);
    store.transact("Lock", (tx) => tx.updateNode(a, { locked: true }));
    const before = store.doc;
    expect(() => store.transact("Union", (tx) => booleanOp(env(), tx, [a, b], "union"))).toThrow(/locked/);
    expect(store.doc).toBe(before);
    store.transact("Clip", (tx) => tx.updateNode(a, { locked: false, attrs: { ...tx.doc.nodes[a].attrs, "clip-path": "url(#clip)" } }));
    expect(() => store.transact("Union", (tx) => booleanOp(env(), tx, [a, b], "union"))).toThrow(/references/);
    expect(store.doc.nodes[a]).toBeDefined();
    expect(store.doc.nodes[b]).toBeDefined();
  });
});
