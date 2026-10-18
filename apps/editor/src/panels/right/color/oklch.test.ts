import { describe, expect, it } from "vitest";
import { inP3, inSrgb, maxChroma, oklchCss, oklchToSrgbBytes } from "./oklch";

describe("oklch math", () => {
  it("converts white, black and a known colour", () => {
    expect(oklchToSrgbBytes(1, 0, 0)).toEqual([255, 255, 255]);
    expect(oklchToSrgbBytes(0, 0, 0)).toEqual([0, 0, 0]);
    // #ff0000 is about oklch(0.628 0.2577 29.23)
    const [r, g, b] = oklchToSrgbBytes(0.628, 0.2577, 29.23);
    expect(r).toBeGreaterThan(250);
    expect(g).toBeLessThan(6);
    expect(b).toBeLessThan(6);
  });
  it("knows the gamuts", () => {
    expect(inSrgb(0.5, 0.05, 50)).toBe(true);
    expect(inSrgb(0.7, 0.3, 150)).toBe(false);
    expect(inP3(0.7, 0.2, 150)).toBe(true);
    const s = maxChroma(0.6, 30, "srgb");
    const p = maxChroma(0.6, 30, "p3");
    expect(p).toBeGreaterThan(s);
    expect(s).toBeGreaterThan(0.15);
  });
  it("formats", () => {
    expect(oklchCss({ l: 0.52, c: 0.11, h: 50, a: 1 })).toBe("oklch(0.52 0.11 50)");
    expect(oklchCss({ l: 0.52, c: 0.11, h: 50, a: 0.5 })).toBe("oklch(0.52 0.11 50 / 0.5)");
  });
});
