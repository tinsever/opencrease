import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyMatch } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches subsequences case-insensitively", () => {
    expect(fuzzyMatch("wif", "Wrap in frame")).not.toBeNull();
    expect(fuzzyMatch("xyz", "Wrap in frame")).toBeNull();
  });
  it("returns match indices", () => {
    expect(fuzzyMatch("wr", "Wrap")?.indices).toEqual([0, 1]);
  });
  it("prefers prefix and substring matches", () => {
    const a = fuzzyMatch("fr", "Frame")!;
    const b = fuzzyMatch("fr", "Wrap in frame")!;
    const c = fuzzyMatch("fr", "Fill rows")!;
    expect(a.score).toBeGreaterThan(b.score);
    expect(b.score).toBeGreaterThan(c.score);
  });
});

describe("fuzzyFilter", () => {
  const items = ["Wrap in flex row", "Wrap in flex column", "Wrap in frame", "Delete", "Duplicate"];
  it("keeps order for an empty query", () => {
    expect(fuzzyFilter(items, "", (s) => s)).toEqual(items);
  });
  it("filters and ranks", () => {
    expect(fuzzyFilter(items, "wrap in fl", (s) => s)).toEqual(["Wrap in flex row", "Wrap in flex column"]);
    expect(fuzzyFilter(items, "dup", (s) => s)[0]).toBe("Duplicate");
  });
  it("supports several keys", () => {
    expect(fuzzyFilter([{ a: "Undo", k: ["history"] }], "hist", (x) => [x.a, ...x.k])).toHaveLength(1);
  });
});
