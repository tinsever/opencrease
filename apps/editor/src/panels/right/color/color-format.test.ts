import { describe, expect, it } from "vitest";
import { formatPicker, literalToOklch, modeOf } from "./color-format";
import { formatColor } from "@opencrease/css";
import { resolveColor, toOklchValue } from "./color-value";
import { withAlpha } from "../inspector/fills";

describe("picker notations", () => {
  it("detects the notation of a value", () => {
    expect(modeOf("#fff")).toBe("hex");
    expect(modeOf("white")).toBe("hex");
    expect(modeOf("oklab(0.5 0.1 0)")).toBe("oklab");
    expect(modeOf("color(display-p3 1 0 0)")).toBe("p3");
    expect(modeOf("lab(50% 20 30)")).toBe("oklch");
  });
  it("formats in every mode", () => {
    const red = literalToOklch("#ff0000")!;
    expect(formatPicker(red, "hex")).toBe("#ff0000");
    expect(formatPicker(red, "rgb")).toBe("rgb(255, 0, 0)");
    expect(formatPicker(red, "oklab")).toMatch(/^oklab\(0\.628 0\.22[45] 0\.126\)$/);
    expect(formatPicker(red, "p3")).toMatch(/^color\(display-p3 0\.917\d 0\.200\d 0\.138\d\)$/);
    expect(formatPicker({ ...red, a: 0.5 }, "oklch")).toMatch(/ \/ 0\.5\)$/);
  });
  it("never clips a wide-gamut colour into an sRGB notation", () => {
    const p3Green = literalToOklch("color(display-p3 0 1 0)")!;
    expect(formatPicker(p3Green, "hex")).toMatch(/^color\(display-p3 /);
  });
  it("parses lab, lch, hwb and named colours", () => {
    for (const c of ["lab(54.29% 80.8 69.89)", "lch(54.29% 106.8 40.86)", "hwb(0 0% 0%)", "red", "oklab(0.628 0.2249 0.1258)"]) {
      const o = literalToOklch(c)!;
      expect(formatColor(formatPicker(o, "oklch"), "hex")).toBe("#ff0000");
    }
  });
  it("reads alpha once for literals and resolves token opacity", () => {
    expect(toOklchValue(undefined, "rgb(255 0 0 / 0.5)")?.a).toBe(0.5);
    const doc = { tokens: [{ id: "t", name: "--red", type: "color" as const, value: "#ff000080" }] };
    expect(resolveColor(doc as never, "color-mix(in oklch, var(--red) 30%, blue)")).toBe("color-mix(in oklch, #ff000080 30%, blue)");
    expect(toOklchValue(doc as never, "var(--red)")?.a).toBeCloseTo(0.502, 3);
    expect(toOklchValue(doc as never, "color-mix(in srgb, var(--red) 50%, transparent)")?.a).toBeCloseTo(0.251, 3);
  });
  it("sets alpha in any notation", () => {
    expect(withAlpha("#ff0000", 0.5)).toBe("#ff000080");
    expect(withAlpha("color(display-p3 1 0 0)", 0.25)).toBe("color(display-p3 1 0 0 / 0.25)");
    expect(withAlpha("oklab(0.5 0.1 0 / 0.3)", 1)).toBe("oklab(0.5 0.1 0)");
    expect(withAlpha("oklch(0.5 0.1 30)", 0.5)).toBe("oklch(0.5 0.1 30 / 0.5)");
  });
});
