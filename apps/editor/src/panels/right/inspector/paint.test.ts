import * as Shaders from "@paper-design/shaders-react";
import { describe, expect, it } from "vitest";
import { convertGradient, gradientToCss, insertStop, linearLine, moveStop, parseGradient, parsePosition, radialRadius, resolvedStops } from "./gradient";
import { imageFit, moveLayer, parseFills, withImageFit, writeFills, type FillLayer } from "./fills";
import { filtersToCss, moveItem, parseFilters, parseShadows, shadowsToCss } from "./effects";
import { bordersDiffer, hasOutline, readBorder, readOutline, writeBorder, writeOutline } from "./box";
import { collectColors, colorKey, replaceInValue } from "./selection-colors";
import { otherStyles, parseRawStyle } from "./other-styles";
import { shaderDefs, shaderDef } from "./shader-schema";
import type { FoldDocument, OFNode } from "@opencrease/model";

/** parse → serialise → parse gives the same structure */
const roundTrip = (css: string) => {
  const g = parseGradient(css)!;
  expect(g).not.toBeNull();
  expect(parseGradient(gradientToCss(g))).toEqual(g);
  return g;
};

describe("gradients", () => {
  it("parses linear gradients with sides, units and repeating", () => {
    expect(roundTrip("linear-gradient(45deg, red 0%, blue 100%)")).toEqual({ kind: "linear", angle: 45, stops: [{ color: "red", position: 0 }, { color: "blue", position: 100 }] });
    expect(parseGradient("linear-gradient(to top left, red, blue)")).toMatchObject({ angle: 315 });
    expect(parseGradient("linear-gradient(0.25turn, red, blue)")).toMatchObject({ angle: 90 });
    expect(roundTrip("repeating-linear-gradient(90deg, #000 0%, #fff 10%)")).toMatchObject({ repeating: true });
    expect(parseGradient("linear-gradient(red, blue)")).toMatchObject({ angle: 180 });
  });
  it("parses radial shape, size and position", () => {
    expect(roundTrip("radial-gradient(circle closest-side at 30% 40%, red 0%, blue 100%)")).toEqual({
      kind: "radial", shape: "circle", radialSize: "closest-side", at: { x: 30, y: 40 }, stops: [{ color: "red", position: 0 }, { color: "blue", position: 100 }],
    });
    expect(parseGradient("radial-gradient(at top left, red, blue)")).toMatchObject({ at: { x: 0, y: 0 } });
    expect(parseGradient("radial-gradient(ellipse at center, red, blue)")).toMatchObject({ shape: "ellipse", at: { x: 50, y: 50 } });
    // centre is the default, so it is not written
    expect(gradientToCss(parseGradient("radial-gradient(circle at 50% 50%, red, blue)")!)).toBe("radial-gradient(circle, red, blue)");
  });
  it("parses conic gradients with from, at and degree stops", () => {
    const g = roundTrip("conic-gradient(from 90deg at 25% 75%, red 0deg, blue 180deg, red 360deg)");
    expect(g).toMatchObject({ kind: "conic", angle: 90, at: { x: 25, y: 75 } });
    expect(g.stops.map((s) => s.position)).toEqual([0, 50, 100]);
    expect(gradientToCss(g)).toBe("conic-gradient(from 90deg at 25% 75%, red 0deg, blue 180deg, red 360deg)");
  });
  it("keeps interpolation and var() colours", () => {
    expect(roundTrip("linear-gradient(90deg in oklch, var(--a) 0%, color-mix(in srgb, var(--b) 40%, transparent) 100%)")).toMatchObject({ interpolation: "in oklch" });
  });
  it("rejects what it cannot represent", () => {
    expect(parseGradient("linear-gradient(calc(1deg * 3), red, blue)")).toBeNull();
    expect(parseGradient("radial-gradient(circle at 10px calc(1px), red, blue)")).toBeNull();
    expect(parseGradient("url(a.png)")).toBeNull();
  });
  it("converts between kinds and resolves stops", () => {
    const lin = parseGradient("linear-gradient(30deg, red, green, blue)")!;
    expect(convertGradient(lin, "conic")).toMatchObject({ kind: "conic", angle: 30 });
    expect(convertGradient(lin, "radial")).toMatchObject({ kind: "radial", shape: "circle" });
    expect(resolvedStops(lin.stops).map((s) => s.position)).toEqual([0, 50, 100]);
    const r = insertStop(lin.stops, "white", 25);
    expect(r.index).toBe(1);
    expect(r.stops.map((s) => s.position)).toEqual([0, 25, 50, 100]);
  });
  it("reorders a dragged stop when it crosses a neighbour", () => {
    const stops = [{ color: "red", position: 0 }, { color: "green", position: 50 }, { color: "blue", position: 100 }];
    const moved = moveStop(stops, 0, 75);
    expect(moved.index).toBe(1);
    expect(moved.stops.map((s) => s.color)).toEqual(["green", "red", "blue"]);
    expect(moved.stops.map((s) => s.position)).toEqual([50, 75, 100]);
  });
  it("positions and geometry", () => {
    expect(parsePosition("right 20%")).toEqual({ x: 100, y: 20 });
    expect(parsePosition("bottom")).toEqual({ x: 50, y: 100 });
    const l = linearLine(90, 200, 100);
    expect([l.x1, l.y1, l.x2, l.y2].map(Math.round)).toEqual([0, 50, 200, 50]);
    const d = linearLine(180, 200, 100);
    expect(Math.abs(Math.round(d.y1))).toBe(0);
    expect(Math.round(d.y2)).toBe(100);
    expect(radialRadius({ kind: "radial", shape: "circle", radialSize: "closest-side", stops: [] }, 200, 100).rx).toBe(50);
    expect(radialRadius({ kind: "radial", shape: "circle", radialSize: "40px", stops: [] }, 200, 100).rx).toBe(40);
  });
});

describe("fill stack", () => {
  it("reads per-layer size, position, repeat and blend", () => {
    const layers = parseFills({
      backgroundImage: "url(a.png), linear-gradient(red, blue)",
      backgroundSize: "cover, auto",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat, repeat",
      backgroundBlendMode: "multiply, normal",
      backgroundColor: "#fff",
    });
    expect(layers[0]).toMatchObject({ kind: "image", size: "cover", position: "center", repeat: "no-repeat", blend: "multiply" });
    expect(layers[1]).toMatchObject({ kind: "linear", position: "center" });
    expect(layers[1].size).toBeUndefined();
    expect(layers[2]).toEqual({ kind: "solid", color: "#fff" });
    const w = writeFills(layers);
    expect(w.styles).toMatchObject({ backgroundSize: "cover, auto", backgroundRepeat: "no-repeat, repeat", backgroundBlendMode: "multiply, normal" });
    expect(parseFills(w.styles as Record<string, string>)).toEqual(layers);
  });
  it("splits a shorthand layer into image, position, size and repeat", () => {
    const layers = parseFills({ background: "url(x.png) center / contain no-repeat #fafafa" });
    expect(layers).toEqual([
      { kind: "image", url: "x.png", raw: "url(x.png)", position: "center", size: "contain", repeat: "no-repeat" },
      { kind: "solid", color: "#fafafa" },
    ]);
    expect(writeFills(layers).styles).toMatchObject({ background: null, backgroundImage: "url(x.png)", backgroundSize: "contain", backgroundColor: "#fafafa" });
  });
  it("keeps hidden layers in paint, at their place", () => {
    const layers: FillLayer[] = [
      { kind: "linear", angle: 90, stops: [{ color: "red" }, { color: "blue" }] },
      { kind: "solid", color: "#00ff00", hidden: true },
      { kind: "solid", color: "#ffffff" },
    ];
    const w = writeFills(layers);
    expect(w.styles.backgroundImage).toBe("linear-gradient(90deg, red, blue)");
    expect(w.styles.backgroundColor).toBe("#ffffff");
    expect(w.paint).toEqual({ hiddenFills: [{ index: 1, css: "#00ff00" }] });
    expect(parseFills(w.styles as Record<string, string>, w.paint)).toEqual(layers);
    // showing it again writes it back into the CSS
    const shown = writeFills(layers.map((l) => ({ ...l, hidden: undefined }) as FillLayer));
    expect(shown.paint).toBeUndefined();
    expect(shown.styles.backgroundImage).toBe("linear-gradient(90deg, red, blue), linear-gradient(#00ff00, #00ff00)");
  });
  it("keeps radial radius separate from CSS background sizing", () => {
    const layers = parseFills({ backgroundImage: "radial-gradient(circle closest-side at 20% 30%, red, blue)", backgroundSize: "200px 100px" });
    expect(layers[0]).toMatchObject({ kind: "radial", radialSize: "closest-side", size: "200px 100px" });
    const w = writeFills(layers);
    expect(w.styles.backgroundImage).toBe("radial-gradient(circle closest-side at 20% 30%, red, blue)");
    expect(w.styles.backgroundSize).toBe("200px 100px");
    expect(parseFills(w.styles as Record<string, string>)).toEqual(layers);
  });
  it("keeps advanced gradient syntax raw rather than changing its meaning", () => {
    for (const css of ["linear-gradient(red 10px, blue 30px)", "linear-gradient(red, 25%, blue)"]) {
      expect(parseGradient(css)).toBeNull();
      expect(writeFills(parseFills({ backgroundImage: css })).styles.backgroundImage).toBe(css);
    }
  });
  it("keeps the shader fill on top of the stack", () => {
    const spec = { name: "MeshGradient", params: { speed: 1 } };
    const paint = { shader: spec, shaderHidden: true };
    const layers = parseFills({ backgroundColor: "red" }, paint);
    expect(layers).toEqual([{ kind: "shader", spec, hidden: true }, { kind: "solid", color: "red" }]);
    expect(writeFills(layers, paint).paint).toEqual(paint);
    expect(moveLayer(layers, 1, 0)).toEqual(layers);
    expect(moveLayer(layers, 0, 1)).toEqual(layers);
  });
  it("reorders layers", () => {
    const a: FillLayer = { kind: "solid", color: "a" };
    const b: FillLayer = { kind: "solid", color: "b" };
    const c: FillLayer = { kind: "solid", color: "c" };
    expect(moveLayer([a, b, c], 2, 0)).toEqual([c, a, b]);
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
  });
  it("switches image fit", () => {
    const img: FillLayer = { kind: "image", url: "a", raw: "url(a)" };
    expect(imageFit(img)).toBe("tile");
    expect(imageFit(withImageFit(img, "fill"))).toBe("fill");
    expect(withImageFit(img, "crop")).toMatchObject({ size: "120%", repeat: "no-repeat" });
    expect(imageFit({ size: "300px 200px" })).toBe("crop");
  });
});

describe("shadows and filters", () => {
  it("round trips shadows with inset", () => {
    const css = "inset 0 0 0 1px #0000001f, 0 12px 32px -4px rgb(0 0 0 / 0.2)";
    const list = parseShadows(css);
    expect(list).toEqual([
      { inset: true, x: 0, y: 0, blur: 0, spread: 1, color: "#0000001f" },
      { inset: false, x: 0, y: 12, blur: 32, spread: -4, color: "rgb(0 0 0 / 0.2)" },
    ]);
    expect(parseShadows(shadowsToCss(list)!)).toEqual(list);
    expect(shadowsToCss(list, { text: true })).toBe("0 0 0 #0000001f, 0 12px 32px rgb(0 0 0 / 0.2)");
  });
  it("preserves non-pixel shadows and nested filter expressions", () => {
    const shadows = "var(--shadow), 0 1em 2em red, 0 2px 4px";
    const list = parseShadows(shadows);
    expect(list[0].raw).toBe("var(--shadow)");
    expect(list[1].raw).toBe("0 1em 2em red");
    expect(list[2].color).toBe("currentColor");
    expect(parseShadows(shadowsToCss(list)!)).toEqual(list);
    const filter = "blur(calc(var(--blur) * 2)) hue-rotate(100grad) drop-shadow(0 2px 4px rgb(0 0 0 / .2))";
    const entries = parseFilters(filter);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ name: "raw", raw: "blur(calc(var(--blur) * 2))" });
    expect(entries[1]).toEqual({ name: "hue-rotate", value: 90 });
    expect(parseFilters(filtersToCss(entries)!)).toEqual(entries);
  });
  it("round trips every filter function and keeps unknown ones raw", () => {
    const css = "blur(4px) brightness(120%) contrast(1.5) saturate(140%) grayscale(1) sepia(50%) invert(100%) hue-rotate(0.5turn) drop-shadow(0 2px 4px red)";
    const list = parseFilters(css);
    expect(list.map((e) => e.name)).toEqual(["blur", "brightness", "contrast", "saturate", "grayscale", "sepia", "invert", "hue-rotate", "raw"]);
    expect(list[2]).toEqual({ name: "contrast", value: 150 });
    expect(list[7]).toEqual({ name: "hue-rotate", value: 180 });
    const out = filtersToCss(list)!;
    expect(out).toBe("blur(4px) brightness(120%) contrast(150%) saturate(140%) grayscale(100%) sepia(50%) invert(100%) hue-rotate(180deg) drop-shadow(0 2px 4px red)");
    expect(parseFilters(out)).toEqual(list);
  });
});

describe("borders and outline", () => {
  it("reads per-side borders from shorthands and longhands", () => {
    const b = readBorder({ borderBottom: "2px dashed #eee" });
    expect(b).toMatchObject({ style: "dashed", color: "#eee", widths: [undefined, undefined, 2, undefined] });
    const c = readBorder({ border: "1px solid red", borderLeftWidth: 4 });
    expect(c.widths).toEqual([1, 1, 1, 4]);
    expect(bordersDiffer(c)).toBe(true);
    expect(readBorder({ borderWidth: "1px 2px" }).widths).toEqual([1, 2, 1, 2]);
  });
  it("writes uniform or per-side widths and reads them back", () => {
    const uni = writeBorder({ width: 2, style: "dotted", color: "blue" });
    expect(uni).toMatchObject({ border: null, borderWidth: 2, borderStyle: "dotted", borderColor: "blue", borderTopWidth: null });
    const sides = writeBorder({ style: "solid", color: "red", widths: [1, 0, 3, 0] });
    expect(sides).toMatchObject({ borderWidth: null, borderTopWidth: 1, borderRightWidth: 0, borderBottomWidth: 3, borderLeftWidth: 0 });
    const clean = Object.fromEntries(Object.entries(sides).filter(([, v]) => v !== null)) as Record<string, string | number>;
    expect(readBorder(clean)).toMatchObject({ style: "solid", color: "red", widths: [1, 0, 3, 0] });
  });
  it("reads and writes outlines", () => {
    expect(readOutline({ outline: "2px dashed var(--focus)", outlineOffset: 3 })).toEqual({ width: 2, style: "dashed", color: "var(--focus)", offset: 3 });
    expect(hasOutline({ outline: "none" })).toBe(false);
    expect(writeOutline({ width: 1, style: "solid", color: "red", offset: 0 })).toEqual({ outline: null, outlineWidth: 1, outlineStyle: "solid", outlineColor: "red", outlineOffset: null });
  });
});

function doc(nodes: OFNode[]): FoldDocument {
  return { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) } as unknown as FoldDocument;
}
const n = (id: string, patch: Partial<OFNode>): OFNode => ({ id, type: "Frame", name: id, parentId: null, children: [], visible: true, locked: false, styles: {}, ...patch });

describe("selection colours", () => {
  it("collects colours from styles, SVG attributes and shaders, grouped across notations", () => {
    const d = doc([
      n("a", { children: ["b", "c"], styles: { backgroundColor: "#ffffff", boxShadow: "0 1px 2px #00000033", border: "1px solid var(--line)" } }),
      n("b", { type: "Text", styles: { color: "white" } }),
      n("c", { type: "SVGElement", attrs: { fill: "#FF0000", stroke: "none" }, styles: {} }),
      n("d", { paint: { shader: { name: "MeshGradient", params: { colors: ["#ff0000", "#00f"] } } } }),
    ]);
    const groups = collectColors(d, ["a", "d"]);
    const white = groups.find((g) => g.key === colorKey("#fff"))!;
    expect(white.uses.map((u) => u.nodeId).sort()).toEqual(["a", "b"]);
    const red = groups.find((g) => g.key === colorKey("red"))!;
    expect(red.uses.map((u) => u.kind).sort()).toEqual(["attr", "shader"]);
    expect(groups.some((g) => g.key === "var:--line")).toBe(true);
  });
  it("keeps different wide-gamut colours distinct and includes hidden fills", () => {
    expect(colorKey("color(display-p3 1 0 0)")).not.toBe(colorKey("red"));
    const d = doc([n("a", { paint: { hiddenFills: [{ index: 0, css: "linear-gradient(red, blue)" }] } })]);
    expect(collectColors(d, ["a"]).map((g) => g.uses[0].kind)).toEqual(["hidden", "hidden"]);
  });
  it("replaces a colour inside composite values", () => {
    const key = colorKey("#000000");
    expect(replaceInValue("0 1px 2px #000, inset 0 0 0 1px black", key, "#123456")).toBe("0 1px 2px #123456, inset 0 0 0 1px #123456");
    expect(replaceInValue("linear-gradient(90deg, var(--a), rgb(0 0 0) 50%)", key, "red")).toBe("linear-gradient(90deg, var(--a), red 50%)");
    expect(replaceInValue("1px solid var(--line)", "var:--line", "var(--edge)")).toBe("1px solid var(--edge)");
  });
});

describe("other styles", () => {
  it("lists only properties without a panel", () => {
    expect(otherStyles({ width: 10, zIndex: 2, aspectRatio: "16 / 9", color: "red" })).toEqual([["zIndex", 2], ["aspectRatio", "16 / 9"]]);
  });
  it("validates raw entries", () => {
    expect(parseRawStyle("z-index", "3")).toEqual({ key: "zIndex", value: 3 });
    expect(parseRawStyle("cursor", "pointer")).toHaveProperty("error");
    expect(parseRawStyle("aspect-ratio", "")).toHaveProperty("error");
  });
});

describe("shader schema", () => {
  it("covers every shader component with typed params", () => {
    const defs = shaderDefs();
    const components = Object.keys(Shaders).filter((k) => /^[A-Z]/.test(k) && k !== "ShaderMount");
    expect(defs.map((d) => d.name).sort()).toEqual(components.sort());
    for (const name of ["MeshGradient", "GrainGradient", "LiquidMetal", "HalftoneCmyk", "FlutedGlass", "GodRays", "PaperTexture", "Water", "DotGrid"]) {
      expect(defs.some((d) => d.name === name)).toBe(true);
    }
    const grain = shaderDef("GrainGradient")!;
    expect(grain.params.find((p) => p.key === "shape")).toMatchObject({ kind: "enum", options: expect.arrayContaining(["wave", "corners"]) });
    expect(grain.params.find((p) => p.key === "colors")).toMatchObject({ kind: "colors", max: 7 });
    expect(grain.params.find((p) => p.key === "rotation")).toMatchObject({ kind: "angle", group: "placement" });
    expect(shaderDef("ImageDithering")!.params[0]).toMatchObject({ kind: "image", required: true });
    expect(shaderDef("HalftoneDots")!.params.find((p) => p.key === "inverted")).toMatchObject({ kind: "boolean" });
    for (const d of defs) {
      for (const p of d.params) {
        if (p.kind === "number") expect(p.default >= p.min && p.default <= p.max, `${d.name}.${p.key}`).toBe(true);
      }
    }
  });
});
