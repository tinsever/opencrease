import { describe, expect, it } from "vitest";
import { listSystemFonts, normalizeFamilies, parseFcList } from "./system-fonts";

describe("system fonts", () => {
  it("normalizes family lists", () => {
    expect(normalizeFamilies(["Helvetica", " helvetica ", ".SF NS", "", "Arial", "DejaVu Sans"])).toEqual(["Arial", "DejaVu Sans", "Helvetica"]);
  });

  it("parses fc-list output", () => {
    expect(parseFcList("DejaVu Sans\nNoto Sans CJK JP,Noto Sans CJK JP Regular\nFoo\\, Bar,Baz\n")).toEqual(["DejaVu Sans", "Noto Sans CJK JP", "Foo\\, Bar"]);
    expect(normalizeFamilies(parseFcList("Foo\\-Bar\nA\\, B,C\n"))).toEqual(["A, B", "Foo-Bar"]);
  });

  it.runIf(process.platform === "darwin")("lists installed families on macOS", async () => {
    const fonts = await listSystemFonts();
    expect(fonts).toContain("Helvetica");
    expect(fonts.length).toBeGreaterThan(20);
  });
});
