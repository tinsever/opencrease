import { describe, expect, it } from "vitest";
import { createDocument, DocStore } from "@opencrease/model";
import { PAINT, paintTargets, readPaint, writePaint } from "./paint";
import { paintOf } from "./svg-geom";

function setup() {
  const store = new DocStore(createDocument("Paint"));
  const root = Object.values(store.doc.pages)[0].rootId;
  const [svg] = store.transact("Insert", (tx) => tx.insertTrees(root, [{ type: "SVG", attrs: { fill: "red", "stroke-linecap": "round", "stroke-dasharray": "4 2" }, children: [
    { type: "SVGElement", tag: "g", styles: { stroke: "blue" }, children: [
      { type: "SVGElement", tag: "path", attrs: { d: "M0 0L10 10", fill: "green", "stroke-width": "0" }, styles: { fill: "purple" } },
      { type: "SVGElement", tag: "rect", attrs: { width: "10", height: "10" } },
    ] },
    { type: "SVGElement", tag: "defs", children: [{ type: "SVGElement", tag: "path", attrs: { d: "M0 0L1 1" } }] },
  ] }]));
  const group = store.doc.nodes[svg].children[0];
  const [path, rect] = store.doc.nodes[group].children;
  return { store, svg, group, path, rect };
}

describe("SVG paint", () => {
  it("finds drawable targets once and excludes definitions", () => {
    const { store, svg, group, path, rect } = setup();
    expect(paintTargets(store.doc, [svg, group, path]).map((n) => n.id)).toEqual([path, rect]);
  });
  it("reads style precedence, inherited paint and zero width", () => {
    const { store, path, rect } = setup();
    expect(readPaint(store.doc, store.doc.nodes[path], PAINT.fill)).toBe("purple");
    expect(readPaint(store.doc, store.doc.nodes[rect], PAINT.fill)).toBe("red");
    expect(paintOf(store.doc, store.doc.nodes[path])).toMatchObject({ stroke: "blue", strokeWidth: 0, strokeLinecap: "round" });
  });
  it("edits paint and tokens without leaving a winning old style or attribute", () => {
    const { store, path } = setup();
    const original = store.doc;
    store.transact("Paint", (tx) => {
      writePaint(tx, path, PAINT.fill, "orange");
      writePaint(tx, path, PAINT.stroke, "var(--brand)");
      writePaint(tx, path, PAINT.strokeLinecap, "butt");
      writePaint(tx, path, PAINT.strokeDasharray, "none");
    });
    const n = store.doc.nodes[path];
    expect(n.attrs?.fill).toBeUndefined();
    expect(n.styles.fill).toBe("orange");
    expect(n.styles.stroke).toBe("var(--brand)");
    expect(readPaint(store.doc, n, PAINT.strokeLinecap)).toBe("butt");
    expect(readPaint(store.doc, n, PAINT.strokeDasharray)).toBe("none");
    store.undo();
    expect(store.doc.nodes).toEqual(original.nodes);
  });
});
