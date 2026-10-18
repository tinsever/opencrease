import { describe, expect, it } from "vitest";
import { colorsEqual, findColorsInValue, formatColor, parseColor } from "./index";

describe("parseColor", () => {
  it("parses many syntaxes", () => {
    for (const c of [
      "#fff", "#ffffff80", "rgb(1 2 3)", "rgba(1, 2, 3, 0.5)", "hsl(120 50% 50%)", "hwb(0 0% 0%)",
      "lab(50% 20 30)", "lch(50% 30 120)", "oklab(0.5 0.1 0.1)", "oklch(0.7 0.1 200)",
      "color(display-p3 1 0 0)", "rebeccapurple", "transparent",
    ]) {
      expect(parseColor(c), c).toBeDefined();
    }
    expect(parseColor("#fff")?.mode).toBe("rgb");
  });

  it("returns undefined for non-colours", () => {
    expect(parseColor("var(--x)")).toBeUndefined();
    expect(parseColor("solid")).toBeUndefined();
    expect(parseColor("")).toBeUndefined();
  });
});

describe("colorsEqual", () => {
  it("matches hex, rgb, hsl and named colours", () => {
    expect(colorsEqual("#ff0000", "rgb(255, 0, 0)")).toBe(true);
    expect(colorsEqual("#F00", "red")).toBe(true);
    expect(colorsEqual("hsl(0 100% 50%)", "#ff0000")).toBe(true);
    expect(colorsEqual("white", "#FFFFFF")).toBe(true);
    expect(colorsEqual("rebeccapurple", "#663399")).toBe(true);
  });

  it("matches oklch with hex within a small epsilon", () => {
    expect(colorsEqual("oklch(0.628 0.2577 29.23)", "#ff0000")).toBe(true);
    expect(colorsEqual("oklch(62.8% 0.2577 29.23)", "red")).toBe(true);
    expect(colorsEqual(formatColor("#3366cc", "oklch"), "#3366cc")).toBe(true);
  });

  it("distinguishes different colours", () => {
    expect(colorsEqual("#ff0000", "#fe0000")).toBe(false);
    expect(colorsEqual("#f00", "#f01")).toBe(false);
    expect(colorsEqual("red", "blue")).toBe(false);
  });

  it("is alpha-aware", () => {
    expect(colorsEqual("rgba(0, 0, 0, 0.5)", "#00000080")).toBe(true);
    expect(colorsEqual("rgb(0 0 0 / 50%)", "rgba(0,0,0,.5)")).toBe(true);
    expect(colorsEqual("rgba(0, 0, 0, 0.5)", "#000")).toBe(false);
    expect(colorsEqual("transparent", "rgba(255, 0, 0, 0)")).toBe(true);
  });

  it("compares non-colour values textually", () => {
    expect(colorsEqual("var(--color-primary)", "var( --color-primary )")).toBe(true);
    expect(colorsEqual("var(--a)", "var(--b)")).toBe(false);
    expect(colorsEqual("var(--a)", "red")).toBe(false);
  });
});

describe("formatColor", () => {
  it("formats in each mode", () => {
    expect(formatColor("red", "hex")).toBe("#ff0000");
    expect(formatColor("rgb(255 0 0 / 0.5)", "hex")).toBe("#ff000080");
    expect(formatColor("#ff0000", "rgb")).toBe("rgb(255, 0, 0)");
    expect(formatColor("#ff0000", "hsl")).toBe("hsl(0, 100%, 50%)");
    expect(formatColor("#ff0000", "oklch")).toBe("oklch(0.628 0.2577 29.23)");
    expect(formatColor("rgba(255,0,0,0.25)", "oklch")).toBe("oklch(0.628 0.2577 29.23 / 0.25)");
    expect(formatColor("#ffffff", "oklch")).toMatch(/^oklch\(1 0 /);
  });

  it("returns unparseable input unchanged", () => {
    expect(formatColor("var(--x)", "hex")).toBe("var(--x)");
  });
});

describe("findColorsInValue", () => {
  it("finds colours in gradients", () => {
    expect(findColorsInValue("linear-gradient(90deg, #FFF 0%, rgb(0 0 0 / 0.5) 50%, var(--color-primary) 100%)")).toEqual([
      "#FFF",
      "rgb(0 0 0 / 0.5)",
      "var(--color-primary)",
    ]);
  });

  it("finds colours in borders and shadows", () => {
    expect(findColorsInValue("1px solid red")).toEqual(["red"]);
    expect(findColorsInValue("0 1px 2px #0000001a, inset 0 0 0 1px hsl(0 0% 0% / .1)")).toEqual([
      "#0000001a",
      "hsl(0 0% 0% / .1)",
    ]);
  });

  it("looks inside color-mix and var fallbacks", () => {
    expect(findColorsInValue("color-mix(in oklch, var(--color-primary) 40%, transparent)")).toEqual([
      "var(--color-primary)",
      "transparent",
    ]);
    expect(findColorsInValue("var(--accent, #123456)")).toEqual(["var(--accent)", "#123456"]);
  });

  it("skips urls, strings, keywords and invalid hex", () => {
    expect(findColorsInValue("url(red.png), url('#fff')")).toEqual([]);
    expect(findColorsInValue("none")).toEqual([]);
    expect(findColorsInValue("#12345")).toEqual([]);
    expect(findColorsInValue("drop-shadow(0 0 4px oklch(0.5 0.1 20))")).toEqual(["oklch(0.5 0.1 20)"]);
  });

  it("dedupes and handles a plain colour", () => {
    expect(findColorsInValue("#fff")).toEqual(["#fff"]);
    expect(findColorsInValue("radial-gradient(#fff, #fff 50%, black)")).toEqual(["#fff", "black"]);
  });
});
