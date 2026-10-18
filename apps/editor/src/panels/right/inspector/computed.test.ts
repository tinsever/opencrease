import { describe, expect, it } from "vitest";
import { computedColorToHex, primaryFamily } from "./computed";

describe("computed style helpers", () => {
  it("formats computed colours as hex", () => {
    expect(computedColorToHex("rgb(34, 37, 31)")).toBe("#22251F");
    expect(computedColorToHex("rgba(0, 0, 0, 0.5)")).toBe("#00000080");
  });
  it("takes the first family", () => {
    expect(primaryFamily('"Instrument Serif", serif')).toBe("Instrument Serif");
    expect(primaryFamily("Times")).toBe("Times");
    expect(primaryFamily("")).toBe("");
  });
});
