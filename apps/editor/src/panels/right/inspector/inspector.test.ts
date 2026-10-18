import { describe, expect, it } from "vitest";
import type { OFNode } from "@opencrease/model";
import { colorAlpha, colorLabel, fillsToStyles, parseFills, parseGradient, withAlpha } from "./fills";
import { filtersToCss, parseFilters, parseShadows, shadowsToCss } from "./effects";
import { readBorder, readCorners, readSides, writeCorners, writeSides } from "./box";
import { sizeIntent, sizePatch } from "./sizing";

describe("fills", () => {
  it("parses a single background colour", () => {
    expect(parseFills({ backgroundColor: "#F3EEE6" })).toEqual([{ kind: "solid", color: "#F3EEE6" }]);
    expect(parseFills({ background: "var(--surface)" })).toEqual([{ kind: "solid", color: "var(--surface)" }]);
  });
  it("parses gradients with angles, sides and interpolation", () => {
    expect(parseGradient("linear-gradient(90deg, #fff 0%, #000 100%)")).toEqual({
      kind: "linear", angle: 90, interpolation: undefined, stops: [{ color: "#fff", position: 0 }, { color: "#000", position: 100 }],
    });
    expect(parseGradient("linear-gradient(to right, red, blue)")).toMatchObject({ angle: 90 });
    expect(parseGradient("linear-gradient(in oklab 180deg, oklab(19.1% 0 0 / 0%) 40%, oklab(19.1% 0 0 / 12%) 100%)")).toMatchObject({
      kind: "linear", angle: 180, interpolation: "in oklab",
    });
    expect(parseGradient("radial-gradient(circle at 50% 38%, #eee 0%, #999 100%)")).toMatchObject({ kind: "radial", shape: "circle", at: { x: 50, y: 38 } });
  });
  it("orders layers top first with the colour at the bottom", () => {
    const layers = parseFills({ backgroundImage: "linear-gradient(180deg, transparent 40%, #0002 100%), url(a.png)", backgroundColor: "#fff" });
    expect(layers.map((l) => l.kind)).toEqual(["linear", "image", "solid"]);
  });
  it("splits a shorthand with image and colour", () => {
    const layers = parseFills({ background: "url(x.png) center / cover no-repeat #fafafa" });
    expect(layers.map((l) => l.kind)).toEqual(["image", "solid"]);
  });
  it("round trips through fillsToStyles", () => {
    const styles = { backgroundImage: "linear-gradient(90deg, red 0%, blue 100%)", backgroundColor: "#ffffff" };
    const patch = fillsToStyles(parseFills(styles));
    expect(patch).toMatchObject({ background: null, backgroundColor: "#ffffff", backgroundImage: "linear-gradient(90deg, red 0%, blue 100%)", backgroundSize: null });
    const two = fillsToStyles([{ kind: "solid", color: "red" }, { kind: "solid", color: "blue" }]);
    expect(two.backgroundImage).toBe("linear-gradient(red, red)");
    expect(parseFills(two as Record<string, string>).map((l) => (l.kind === "solid" ? l.color : ""))).toEqual(["red", "blue"]);
    expect(Object.values(fillsToStyles([])).every((v) => v === null)).toBe(true);
  });
  it("handles alpha", () => {
    expect(colorAlpha("#00000080")).toBeCloseTo(0.5, 2);
    expect(colorAlpha("var(--x)")).toBe(1);
    expect(withAlpha("var(--x)", 0.4)).toBe("color-mix(in srgb, var(--x) 40%, transparent)");
    expect(colorAlpha(withAlpha("var(--x)", 0.4))).toBeCloseTo(0.4);
    expect(withAlpha("#ff0000", 0.5)).toBe("#ff000080");
    expect(withAlpha("color-mix(in srgb, var(--x) 40%, transparent)", 1)).toBe("var(--x)");
    expect(colorLabel("var(--surface-bone)")).toBe("surface-bone");
    expect(colorLabel("#f3eee6")).toBe("#F3EEE6");
  });
});

describe("effects", () => {
  it("parses shadows in any order", () => {
    expect(parseShadows("#00000014 0px 1px 2px")).toEqual([{ inset: false, x: 0, y: 1, blur: 2, spread: 0, color: "#00000014" }]);
    const two = parseShadows("inset 0 0 0 1px rgb(0 0 0 / 8%), 0 12px 32px #0003");
    expect(two).toHaveLength(2);
    expect(two[0]).toMatchObject({ inset: true, spread: 1 });
    expect(shadowsToCss(two)).toBe("inset 0 0 0 1px rgb(0 0 0 / 8%), 0 12px 32px 0 #0003");
    expect(shadowsToCss([])).toBeNull();
  });
  it("parses filters with unit normalisation", () => {
    expect(parseFilters("blur(4px) brightness(1.2) contrast(90%) drop-shadow(0 1px 2px red)")).toEqual([
      { name: "blur", value: 4 }, { name: "brightness", value: 120 }, { name: "contrast", value: 90 }, { name: "raw", raw: "drop-shadow(0 1px 2px red)" },
    ]);
    expect(filtersToCss([{ name: "blur", value: 8 }, { name: "grayscale", value: 50 }])).toBe("blur(8px) grayscale(50%)");
    expect(filtersToCss([])).toBeNull();
  });
});

describe("box", () => {
  it("expands padding shorthands", () => {
    expect(readSides({ padding: "12px 24px" }, "padding")).toEqual(["12px", "24px", "12px", "24px"]);
    expect(readSides({ padding: 8, paddingLeft: 20 }, "padding")).toEqual([8, 8, 8, 20]);
    expect(readSides({ paddingInline: 12, paddingBlock: "4px 6px" }, "padding")).toEqual(["4px", 12, "6px", 12]);
  });
  it("writes longhands and clears shorthands", () => {
    expect(writeSides("padding", [1, 2, 0, 4])).toEqual({ padding: null, paddingInline: null, paddingBlock: null, paddingTop: 1, paddingRight: 2, paddingBottom: null, paddingLeft: 4 });
  });
  it("reads and writes corners", () => {
    expect(readCorners({ borderRadius: "4px 8px" })).toEqual(["4px", "8px", "4px", "8px"]);
    expect(writeCorners([6, 6, 6, 6])).toMatchObject({ borderRadius: 6, borderTopLeftRadius: null });
    expect(writeCorners([6, 0, 6, 6])).toMatchObject({ borderRadius: null, borderTopLeftRadius: 6, borderTopRightRadius: null });
  });
  it("reads border shorthand", () => {
    expect(readBorder({ border: "1px solid var(--line)" })).toMatchObject({ width: 1, style: "solid", color: "var(--line)" });
    expect(readBorder({ borderWidth: 2, borderColor: "red" })).toMatchObject({ width: 2, color: "red", widths: [2, 2, 2, 2] });
  });
});

function node(id: string, styles: Record<string, string | number>, type: OFNode["type"] = "Frame", parentId: string | null = "p"): OFNode {
  return { id, type, name: id, parentId, children: [], visible: true, locked: false, styles };
}

describe("sizing", () => {
  const root = node("root", {}, "Root", null);
  const row = node("row", { display: "flex", flexDirection: "row" });
  const col = node("col", { display: "flex", flexDirection: "column" });
  const block = node("block", {});
  it("detects intents", () => {
    expect(sizeIntent(node("a", { width: 100 }), row, "width")).toBe("fixed");
    expect(sizeIntent(node("a", { width: "fit-content" }), row, "width")).toBe("hug");
    expect(sizeIntent(node("a", { flexGrow: 1 }), row, "width")).toBe("fill");
    expect(sizeIntent(node("a", {}), row, "width")).toBe("hug");
    expect(sizeIntent(node("a", {}), row, "height")).toBe("fill");
    expect(sizeIntent(node("a", {}), col, "width")).toBe("fill");
    expect(sizeIntent(node("a", {}), { ...col, styles: { ...col.styles, alignItems: "center" } }, "width")).toBe("hug");
    expect(sizeIntent(node("a", {}), root, "width")).toBe("hug");
    expect(sizeIntent(node("a", {}), block, "width")).toBe("fill");
    expect(sizeIntent(node("a", { width: "100%" }), root, "width")).toBe("fill");
  });
  it("builds patches", () => {
    expect(sizePatch("fill", node("a", { width: 100 }), row, "width", 100)).toEqual({ flexGrow: 1, flexBasis: 0, width: null, flexShrink: null });
    expect(sizePatch("fill", node("a", { width: 100 }), col, "width", 100)).toEqual({ width: null, alignSelf: "stretch" });
    expect(sizePatch("fill", node("a", {}), block, "width", 100)).toEqual({ width: "100%" });
    expect(sizePatch("fixed", node("a", {}), root, "height", 640.4)).toEqual({ height: 640 });
    expect(sizePatch("hug", node("a", { flexGrow: 1 }), row, "width", 10)).toEqual({ flexGrow: null, flexBasis: null, width: "fit-content", flexShrink: null });
  });
});
