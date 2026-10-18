import { describe, expect, it } from "vitest";
import { formatNumber, rectFromPoints, rectsIntersect, resizeRect, unionRects } from "./geometry";
import { snapMove, snapResize } from "./snapping";
import { computeInsertSlot } from "./reorder";
import { centredAt, fitSize, placeBesideExisting } from "./placement";

const R = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe("rect helpers", () => {
  it("builds rects from any two corners", () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 0, y: 5 })).toEqual(R(0, 5, 10, 15));
  });
  it("unions and intersects", () => {
    expect(unionRects([R(0, 0, 10, 10), R(20, 5, 10, 10)])).toEqual(R(0, 0, 30, 15));
    expect(unionRects([])).toBeNull();
    expect(rectsIntersect(R(0, 0, 10, 10), R(9, 9, 5, 5))).toBe(true);
    expect(rectsIntersect(R(0, 0, 10, 10), R(10, 0, 5, 5))).toBe(false);
  });
  it("formats badge numbers", () => {
    expect(formatNumber(1440)).toBe("1440");
    expect(formatNumber(421.33)).toBe("421.3");
    expect(formatNumber(99.96)).toBe("100");
  });
});

describe("resizeRect", () => {
  const start = R(100, 100, 200, 100);
  it("moves only the dragged edges", () => {
    expect(resizeRect(start, "se", 20, 10)).toEqual(R(100, 100, 220, 110));
    expect(resizeRect(start, "nw", 20, 10)).toEqual(R(120, 110, 180, 90));
    expect(resizeRect(start, "e", 50, 999)).toEqual(R(100, 100, 250, 100));
    expect(resizeRect(start, "n", 999, -30)).toEqual(R(100, 70, 200, 130));
  });
  it("keeps the aspect ratio with Shift", () => {
    const r = resizeRect(start, "se", 100, 0, { keepAspect: true });
    expect(r.width).toBe(300);
    expect(r.height).toBe(150);
    const e = resizeRect(start, "e", 100, 0, { keepAspect: true });
    expect(e).toEqual(R(100, 75, 300, 150));
  });
  it("resizes around the centre with Alt", () => {
    expect(resizeRect(start, "e", 10, 0, { fromCenter: true })).toEqual(R(90, 100, 220, 100));
  });
  it("clamps instead of flipping", () => {
    const r = resizeRect(start, "w", 500, 0);
    expect(r.width).toBe(1);
    expect(r.x).toBe(299);
  });
});

describe("snapping", () => {
  const targets = [R(0, 0, 100, 100)];
  it("snaps a moving rect's edge to a target edge within the threshold", () => {
    const s = snapMove(R(104, 200, 50, 50), targets, 6);
    expect(s.dx).toBe(-4);
    expect(s.dy).toBe(0);
    expect(s.guides).toHaveLength(1);
    expect(s.guides[0]).toMatchObject({ orientation: "vertical", at: 100 });
  });
  it("snaps centres", () => {
    const s = snapMove(R(23, 300, 50, 50), targets, 6);
    expect(s.dx).toBe(2); // centre 48 -> 50
  });
  it("ignores targets beyond the threshold", () => {
    const s = snapMove(R(120, 120, 10, 10), targets, 6);
    expect(s).toMatchObject({ dx: 0, dy: 0, guides: [] });
  });
  it("snaps only the edges a resize handle moves", () => {
    const { rect, guides } = snapResize(R(10, 10, 87, 40), "se", targets, 6);
    expect(rect).toEqual(R(10, 10, 90, 40));
    expect(guides[0]).toMatchObject({ orientation: "vertical", at: 100 });
    const left = snapResize(R(3, 10, 50, 40), "w", targets, 6);
    expect(left.rect).toEqual(R(0, 10, 53, 40));
  });
});

describe("computeInsertSlot", () => {
  const row = [R(0, 0, 100, 50), R(110, 0, 100, 50), R(220, 0, 100, 50)];
  const container = R(0, 0, 320, 50);
  it("finds the index by main-axis midpoints", () => {
    expect(computeInsertSlot(row, { x: 10, y: 25 }, "row", container).index).toBe(0);
    expect(computeInsertSlot(row, { x: 70, y: 25 }, "row", container).index).toBe(1);
    expect(computeInsertSlot(row, { x: 300, y: 25 }, "row", container).index).toBe(3);
  });
  it("places the line between neighbours", () => {
    const slot = computeInsertSlot(row, { x: 170, y: 25 }, "row", container);
    expect(slot.index).toBe(2);
    expect(slot.line.x1).toBe(215);
    expect(slot.line).toMatchObject({ y1: 0, y2: 50 });
  });
  it("handles columns and empty containers", () => {
    const col = [R(0, 0, 100, 40), R(0, 50, 100, 40)];
    expect(computeInsertSlot(col, { x: 50, y: 60 }, "column", R(0, 0, 100, 90)).index).toBe(1);
    expect(computeInsertSlot([], { x: 5, y: 5 }, "column", R(0, 0, 100, 90)).index).toBe(0);
  });
  it("picks the nearest wrapped line first", () => {
    const wrapped = [R(0, 0, 100, 40), R(110, 0, 100, 40), R(0, 50, 100, 40), R(110, 50, 100, 40)];
    expect(computeInsertSlot(wrapped, { x: 5, y: 70 }, "row", R(0, 0, 210, 90)).index).toBe(2);
    expect(computeInsertSlot(wrapped, { x: 200, y: 70 }, "row", R(0, 0, 210, 90)).index).toBe(4);
  });
});

describe("placement", () => {
  it("keeps a free position and moves overlapping pastes beside the page content", () => {
    expect(placeBesideExisting(R(500, 0, 100, 100), [R(0, 0, 100, 100)])).toEqual({ dx: 0, dy: 0 });
    expect(placeBesideExisting(R(50, 0, 100, 100), [R(0, 0, 100, 100), R(200, 0, 100, 100)])).toEqual({ dx: 330, dy: 0 });
  });
  it("centres and fits sizes", () => {
    expect(centredAt({ x: 100, y: 100 }, { width: 50, height: 21 })).toEqual(R(75, 90, 50, 21));
    expect(fitSize({ width: 2000, height: 1000 }, { width: 800, height: 800 })).toEqual({ width: 800, height: 400 });
    expect(fitSize({ width: 20, height: 10 }, { width: 800, height: 800 })).toEqual({ width: 20, height: 10 });
  });
});
