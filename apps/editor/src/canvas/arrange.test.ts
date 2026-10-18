import { describe, expect, it } from "vitest";
import { alignOffsets, distributeOffsets, tidyOffsets } from "./arrange";

const r = (x: number, y: number, width = 10, height = 10) => ({ x, y, width, height });

describe("align", () => {
  const rects = [r(0, 0, 10, 10), r(30, 5, 20, 30)];
  it.each([
    ["left", [{ x: 0, y: 0 }, { x: -30, y: 0 }]],
    ["right", [{ x: 40, y: 0 }, { x: 0, y: 0 }]],
    ["hcenter", [{ x: 20, y: 0 }, { x: -15, y: 0 }]],
    ["top", [{ x: 0, y: 0 }, { x: 0, y: -5 }]],
    ["bottom", [{ x: 0, y: 25 }, { x: 0, y: 0 }]],
    ["vcenter", [{ x: 0, y: 12.5 }, { x: 0, y: -2.5 }]],
  ] as const)("%s", (kind, expected) => {
    expect(alignOffsets(rects, kind)).toEqual(expected);
  });

  it("aligns a single layer to given bounds (its parent)", () => {
    expect(alignOffsets([r(10, 10)], "right", { x: 0, y: 0, width: 100, height: 100 })).toEqual([{ x: 80, y: 0 }]);
  });
});

describe("distribute", () => {
  it("makes the gaps equal and keeps the outer layers", () => {
    const out = distributeOffsets([r(0, 0), r(100, 0, 20), r(15, 50)], "horizontal");
    // span 0..120, items 10+20+10 = 40, gap 40: 0, 50, 100
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 35, y: 0 }]);
  });

  it("does nothing for two layers", () => {
    expect(distributeOffsets([r(0, 0), r(50, 0)], "vertical")).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }]);
  });
});

describe("tidy up", () => {
  it("snaps a rough row onto even spacing", () => {
    const out = tidyOffsets([r(0, 0), r(23, 2), r(41, -1)]);
    // gaps 13 and 8 → median 10.5 → 11 (rounded); top aligned to the union top (-1)
    expect(out.map((o, i) => [r(0, 0), r(23, 2), r(41, -1)][i].x + o.x)).toEqual([0, 21, 42]);
    expect(new Set(out.map((o, i) => [0, 2, -1][i] + o.y)).size).toBe(1);
  });

  it("keeps rows and columns in reading order", () => {
    const rects = [r(0, 0), r(30, 1), r(1, 31), r(29, 30)];
    const out = tidyOffsets(rects);
    const placed = rects.map((x, i) => ({ x: x.x + out[i].x, y: x.y + out[i].y }));
    expect(placed).toEqual([{ x: 0, y: 0 }, { x: 29, y: 0 }, { x: 0, y: 29 }, { x: 29, y: 29 }]);
  });
});

describe("grid track edges", () => {
  it("turns resolved track sizes and a gap into track spans", async () => {
    const { trackEdges } = await import("./grid-geometry");
    expect(trackEdges("100px 50px 25.5px", 10)).toEqual([[0, 100], [110, 160], [170, 195.5]]);
    expect(trackEdges("none", 8)).toEqual([]);
  });
});
