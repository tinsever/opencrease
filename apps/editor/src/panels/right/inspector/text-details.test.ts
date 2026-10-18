import { describe, expect, it } from "vitest";
import { featuresToCss, gradientTextStyles, lineClampStyles, parseFeatures } from "./text-details-logic";

describe("text details", () => {
  it("round-trips OpenType features, including explicit offs", () => {
    const f = parseFeatures(`"tnum", "liga" 0, "ss01" on`);
    expect(f).toEqual({ tnum: true, liga: false, ss01: true });
    expect(featuresToCss(f)).toBe(`"tnum", "liga" 0, "ss01"`);
    expect(featuresToCss({})).toBeNull();
  });
  it("writes gradient text with background-clip and clears it", () => {
    expect(gradientTextStyles({ angle: 90, from: "#000", to: "var(--color-accent)" })).toEqual({
      backgroundImage: "linear-gradient(90deg, #000, var(--color-accent))", backgroundClip: "text", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
    });
    expect(Object.values(gradientTextStyles(null)).every((v) => v === null)).toBe(true);
  });
  it("clamps lines with the webkit box model", () => {
    expect(lineClampStyles(2)).toMatchObject({ display: "-webkit-box", WebkitLineClamp: 2, overflow: "hidden" });
    expect(lineClampStyles(0).WebkitLineClamp).toBeNull();
  });
});
