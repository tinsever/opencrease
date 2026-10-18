import { describe, expect, it } from "vitest";
import { createDocument, DocStore } from "@opencrease/model";
import { parsePath, pathBounds, applyMatrix } from "./path";
import {
  editablePathOf, isFittedSvg, pathAttrsFor, pathTree, polygonPoints, prepareVectorResize, refitSvg, regenerateShapeAttrs,
  shapeParams, shapeTree, starPoints,
} from "./shapes";
import { elementPath, elementToSvgBox, parseTransform, viewBoxMatrix, paintOf } from "./svg-geom";

const near = (a: number, b: number, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(eps);

function setup() {
  const store = new DocStore(createDocument("T", { id: "F", now: 1 }));
  const rootId = store.doc.pages[store.doc.pageList[0].id].rootId;
  return { store, rootId };
}

describe("svg geometry", () => {
  it("maps viewBoxes with preserveAspectRatio", () => {
    expect(viewBoxMatrix({ viewBox: "0 0 24 24" }, 48, 48)).toEqual([2, 0, 0, 2, 0, 0]);
    const meet = viewBoxMatrix({ viewBox: "0 0 10 10" }, 40, 20);
    expect(meet).toEqual([2, 0, 0, 2, 10, 0]);
    expect(viewBoxMatrix({ viewBox: "0 0 10 10", preserveAspectRatio: "none" }, 40, 20)).toEqual([4, 0, 0, 2, 0, 0]);
    expect(viewBoxMatrix({ viewBox: "5 5 10 10", preserveAspectRatio: "xMinYMin slice" }, 40, 20)).toEqual([4, 0, 0, 4, -20, -20]);
  });

  it("parses transforms", () => {
    const m = parseTransform("translate(10 20) scale(2)");
    expect(applyMatrix(m, { x: 1, y: 1 })).toEqual({ x: 12, y: 22 });
    const r = parseTransform("rotate(90 5 5)");
    const p = applyMatrix(r, { x: 10, y: 5 });
    near(p.x, 5);
    near(p.y, 10);
  });

  it("turns primitives into paths", () => {
    const rect = elementPath({ tag: "rect", attrs: { x: "1", y: "2", width: "10", height: "20" } })!;
    expect(pathBounds(rect)).toEqual({ x: 1, y: 2, width: 10, height: 20 });
    const rounded = elementPath({ tag: "rect", attrs: { width: "10", height: "10", rx: "5" } })!;
    expect(rounded[0].anchors).toHaveLength(4);
    const b = pathBounds(elementPath({ tag: "circle", attrs: { cx: "5", cy: "5", r: "5" } })!)!;
    near(b.width, 10);
    expect(elementPath({ tag: "polyline", attrs: { points: "0,0 10,0 10,10" } })![0].closed).toBe(false);
    expect(elementPath({ tag: "g" })).toBeNull();
  });

  it("composes viewBox and group transforms for nested elements", () => {
    const { store, rootId } = setup();
    const [svgId] = store.transact("x", (tx) =>
      tx.insertTrees(rootId, [
        {
          type: "SVG", tag: "svg", attrs: { viewBox: "0 0 10 10" }, styles: { width: 100, height: 100 },
          children: [{ type: "SVGElement", tag: "g", attrs: { transform: "translate(1 1)" }, children: [{ type: "SVGElement", tag: "path", attrs: { d: "M0 0L1 1" } }] }],
        },
      ]),
    );
    const g = store.doc.nodes[svgId].children[0];
    const pathId = store.doc.nodes[g].children[0];
    expect(applyMatrix(elementToSvgBox(store.doc, pathId), { x: 0, y: 0 })).toEqual({ x: 10, y: 10 });
    expect(paintOf(store.doc, store.doc.nodes[pathId]).fill).toBe("#000000");
  });
});

describe("shapes", () => {
  it("fills the box with polygons and stars", () => {
    const box = { x: 0, y: 0, width: 100, height: 80 };
    for (const pts of [polygonPoints(3, box), polygonPoints(7, box), starPoints(5, 0.4, box)]) {
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      near(Math.min(...xs), 0);
      near(Math.max(...xs), 100);
      near(Math.min(...ys), 0);
      near(Math.max(...ys), 80);
    }
    expect(starPoints(5, 0.4, box)).toHaveLength(10);
  });

  it("builds fitted shape layers with editable parameters", () => {
    const t = shapeTree("star", 120, 100);
    expect(t.attrs?.viewBox).toBe("0 0 120 100");
    expect(t.styles).toMatchObject({ width: 120, height: 100, overflow: "visible" });
    const el = t.children![0];
    expect(shapeParams(el)).toEqual({ kind: "star", points: 5, ratio: 0.382 });
    const next = regenerateShapeAttrs(el, { points: 8 })!;
    expect(next["data-points"]).toBe("8");
    expect(next.points.split(" ")).toHaveLength(16);
    expect(shapeParams({ tag: "polygon", attrs: { points: "0,0 1,1 1,0" } })).toEqual({ kind: "path" });
  });

  it("sizes path layers to their bounds", () => {
    const r = pathTree(parsePath("M100 50L150 50L150 90"), { stroke: "#000" })!;
    expect(r.origin).toEqual({ x: 100, y: 50 });
    expect(r.tree.styles).toMatchObject({ width: 50, height: 40 });
    expect(r.tree.children![0].attrs!.d).toBe("M0 0L50 0L50 40");
    // horizontal lines get a 1px box centred on the line
    const line = pathTree(parsePath("M0 10L20 10"), {})!;
    expect(line.bounds).toEqual({ x: 0, y: 9.5, width: 20, height: 1 });
  });

  it("scales fitted shapes on resize instead of letterboxing", () => {
    const { store, rootId } = setup();
    const [id] = store.transact("x", (tx) => tx.insertTrees(rootId, [{ ...shapeTree("ellipse", 100, 50), styles: { ...shapeTree("ellipse", 100, 50).styles, left: 0, top: 0 } }]));
    expect(isFittedSvg(store.doc.nodes[id])).toBe(true);
    const resize = prepareVectorResize(store.doc, id)!;
    store.transact("resize", (tx) => {
      tx.setStyles(id, { width: 200, height: 100 });
      resize(tx, 200, 100);
    });
    const el = store.doc.nodes[store.doc.nodes[id].children[0]];
    expect(el.attrs).toMatchObject({ cx: "100", cy: "50", rx: "100", ry: "50" });
    expect(store.doc.nodes[id].attrs?.viewBox).toBe("0 0 200 100");

    const [icon] = store.transact("x", (tx) =>
      tx.insertTrees(rootId, [{ type: "SVG", tag: "svg", attrs: { viewBox: "0 0 24 24" }, styles: { width: 48, height: 48 }, children: [{ type: "SVGElement", tag: "path", attrs: { d: "M0 0L24 24" } }] }]),
    );
    expect(prepareVectorResize(store.doc, icon)).toBeNull();
  });

  it("refits a positioned SVG to its geometry without moving it on the canvas", () => {
    const { store, rootId } = setup();
    const tree = pathTree(parsePath("M10 10L60 10L60 40Z"), { fill: "#000" })!;
    const [id] = store.transact("x", (tx) => tx.insertTrees(rootId, [{ ...tree.tree, styles: { ...tree.tree.styles, left: 10, top: 10 } }]));
    const pathId = store.doc.nodes[id].children[0];
    // drag a point outside the box
    store.transact("edit", (tx) => tx.updateNode(pathId, { attrs: { ...store.doc.nodes[pathId].attrs, d: "M-10 0L50 0L50 30Z" } }));
    store.transact("refit", (tx) => refitSvg(tx, id));
    const svg = store.doc.nodes[id];
    expect(svg.styles).toMatchObject({ left: 0, top: 10, width: 60, height: 30 });
    expect(svg.attrs?.viewBox).toBe("0 0 60 30");
    expect(store.doc.nodes[pathId].attrs?.d).toBe("M0 0L60 0L60 30Z");
  });

  it("finds the editable path and converts primitive attributes", () => {
    const { store, rootId } = setup();
    const [id] = store.transact("x", (tx) => tx.insertTrees(rootId, [shapeTree("rect", 10, 10)]));
    const rect = editablePathOf(store.doc, id)!;
    expect(rect.tag).toBe("rect");
    const attrs = pathAttrsFor(rect, elementPath(rect)!);
    expect(Object.keys(attrs)[0]).toBe("d");
    expect(attrs).toMatchObject({ fill: "#D9D9D9" });
    expect(attrs.width).toBeUndefined();
  });
});
