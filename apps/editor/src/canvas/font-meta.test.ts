import { describe, expect, it } from "vitest";
import { parseVariations, sortAxes, variableFontQuery, variationsToCss } from "./font-meta";

describe("font metadata helpers", () => {
  const fraunces = {
    family: "Fraunces",
    styles: ["400", "400i"],
    axes: [
      { tag: "wght", min: 100, max: 900, defaultValue: 400 },
      { tag: "SOFT", min: 0, max: 100, defaultValue: 0 },
      { tag: "opsz", min: 9, max: 144, defaultValue: 14 },
    ],
  };
  it("orders axes the way the css2 API wants", () => {
    expect(sortAxes(fraunces.axes).map((a) => a.tag)).toEqual(["opsz", "wght", "SOFT"]);
  });
  it("builds full-range variable font queries", () => {
    expect(variableFontQuery(fraunces, false)).toBe("family=Fraunces:opsz,wght,SOFT@9..144,100..900,0..100&display=swap");
    expect(variableFontQuery(fraunces, true)).toBe("family=Fraunces:ital,opsz,wght,SOFT@0,9..144,100..900,0..100;1,9..144,100..900,0..100&display=swap");
    expect(variableFontQuery({ ...fraunces, styles: ["400"] }, true)).not.toContain("ital");
  });
  it("parses and writes font-variation-settings", () => {
    expect(parseVariations(`"wght" 650, 'opsz' 48`)).toEqual({ wght: 650, opsz: 48 });
    expect(parseVariations("normal")).toEqual({});
    expect(variationsToCss({ SOFT: 50.123 })).toBe(`"SOFT" 50.12`);
    expect(variationsToCss({})).toBeNull();
  });
});
