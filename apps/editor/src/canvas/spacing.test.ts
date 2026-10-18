import { describe, expect, it } from "vitest";
import { equalSpacingAxis, measureBetween, smartSnapMove } from "./spacing";

const r = (x: number, y: number, width = 20, height = 20) => ({ x, y, width, height });

describe("equal spacing", () => {
  it("centres a rect between its two neighbours", () => {
    // gap 0..20 and 80..100: a 20 wide rect fits centred at 40
    const c = equalSpacingAxis(r(43, 0), [r(0, 0), r(80, 0)], "x", 6);
    expect(c?.offset).toBe(-3);
    const s = smartSnapMove(r(43, 0), [r(0, 0), r(80, 0)], 6);
    expect(s.dx).toBe(-3);
    expect(s.measures.map((m) => m.value)).toEqual([20, 20]);
  });

  it("repeats an existing gap next to the last item of a row", () => {
    // 0..20, gap 10, 30..50; moving rect near 62 should land at 60
    const targets = [r(0, 0), r(30, 0)];
    const s = smartSnapMove(r(62, 3), targets, 6);
    expect(s.dx).toBe(-2);
    expect(s.measures).toHaveLength(2);
    expect(s.measures.every((m) => m.value === 10)).toBe(true);
  });

  it("ignores layers that do not share the row", () => {
    expect(equalSpacingAxis(r(62, 100), [r(0, 0), r(30, 0)], "x", 6)).toBeNull();
  });

  it("works vertically", () => {
    const s = smartSnapMove(r(0, 61), [r(0, 0), r(0, 30)], 6);
    expect(s.dy).toBe(-1);
  });

  it("prefers edge alignment when it is as close", () => {
    // left edge 30 aligns with the target above at x=30 (offset 0); spacing would want 60
    const s = smartSnapMove(r(30, 40), [r(0, 0), r(30, 0)], 6);
    expect(s.dx).toBe(0);
    expect(s.guides.some((g) => g.orientation === "vertical" && g.at === 30)).toBe(true);
  });
});

describe("measureBetween", () => {
  it("measures the insets to a containing layer", () => {
    const m = measureBetween(r(10, 20, 30, 30), r(0, 0, 100, 100));
    expect(m.map((x) => x.value)).toEqual([10, 60, 20, 50]);
  });

  it("measures the gaps to a separate layer", () => {
    const m = measureBetween(r(0, 0), r(50, 60));
    expect(m.map((x) => x.value)).toEqual([30, 40]);
  });
});
