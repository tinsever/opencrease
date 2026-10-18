import { describe, expect, it } from "vitest";
import { clipboardTrees } from "./clipboard-data";

describe("clipboard metadata", () => {
  it("preserves constraints, grid cells, hidden state and SVG metadata between files", () => {
    const trees = [{ type: "Frame", name: "Grid", styles: { display: "grid", gridTemplateColumns: "1fr 2fr" }, constraints: { horizontal: "scale", vertical: "bottom" }, visible: false, locked: true, paint: { shader: { name: "MeshGradient", params: {} } }, children: [{ type: "SVG", tag: "svg", attrs: { viewBox: "0 0 24 24" }, styles: { gridColumn: "1 / 3" }, children: [] }] }];
    const html = `<div data-opencrease="1" data-of-trees="${encodeURIComponent(JSON.stringify(trees))}"></div>`;
    expect(clipboardTrees(html)).toEqual(trees);
  });
  it("normalises clipboard styles and falls back to HTML for invalid trees", () => {
    const trees = [{ type: "Rectangle", styles: { width: 20, margin: 20, unknown: "bad" } }];
    expect(clipboardTrees(`<div data-opencrease="1" data-of-trees="${encodeURIComponent(JSON.stringify(trees))}"></div>`)[0].styles).toEqual({ width: 20 });
    expect(clipboardTrees('<div data-opencrease="1" data-of-trees="broken"><div style="width: 30px"></div></div>')[0].styles).toEqual({ width: "30px" });
  });
});
