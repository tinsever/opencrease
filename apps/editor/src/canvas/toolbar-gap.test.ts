import { describe, expect, it } from "vitest";
import { bandAt, GAP_CENTRE_BAND, GAP_MIN_BAND, gapGrabBand, gapHandlesApply, gapStrips } from "./gap";
import { pixelGrid, toolbarLayout, toolbarWidth } from "./toolbar-layout";

const R = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe("gap handles", () => {
  it("only applies when gap drives the spacing", () => {
    expect(gapHandlesApply({ display: "flex" })).toBe(true);
    expect(gapHandlesApply({ display: "flex", justifyContent: "center" })).toBe(true);
    expect(gapHandlesApply({ display: "flex", justifyContent: "space-between" })).toBe(false);
    expect(gapHandlesApply({ display: "flex", justifyContent: "space-evenly" })).toBe(false);
  });
  it("finds strips between children on the same line", () => {
    const kids = [R(0, 0, 100, 50), R(124, 0, 100, 50), R(0, 70, 100, 50)];
    expect(gapStrips(kids, "row")).toEqual([R(100, 0, 24, 50)]);
    expect(gapStrips([R(0, 0, 100, 40), R(0, 60, 80, 40)], "column")).toEqual([R(0, 40, 100, 20)]);
  });
  it("makes narrow strips fully grabbable and wide strips only in a centre band", () => {
    expect(gapGrabBand(R(100, 0, 20, 50), "row")).toEqual(R(100, 0, 20, 50));
    expect(gapGrabBand(R(100, 0, 2, 50), "row")).toEqual(R(100 - (GAP_MIN_BAND - 2) / 2, 0, GAP_MIN_BAND, 50));
    const wide = gapGrabBand(R(0, 0, 300, 40), "row");
    expect(wide.width).toBe(GAP_CENTRE_BAND);
    expect(wide.x).toBe(150 - GAP_CENTRE_BAND / 2);
    const tall = gapGrabBand(R(0, 100, 200, 400), "column");
    expect(tall).toEqual(R(0, 300 - GAP_CENTRE_BAND / 2, 200, GAP_CENTRE_BAND));
  });
  it("hit tests bands", () => {
    const bands = [R(0, 0, 10, 10), R(50, 0, 10, 10)];
    expect(bandAt(bands, { x: 55, y: 5 })).toBe(1);
    expect(bandAt(bands, { x: 30, y: 5 })).toBeNull();
  });
});

describe("toolbar layout", () => {
  it("uses the full toolbar on wide canvases", () => {
    const l = toolbarLayout(928);
    expect(l.mode).toBe("full");
    expect(l.overflow).toEqual([]);
    expect(l.askLabel).toBe(true);
    expect(toolbarWidth(l)).toBeGreaterThan(355);
    expect(toolbarWidth(l)).toBeLessThan(370);
  });
  it("drops labels and spacing, then collapses tools, as space shrinks", () => {
    expect(toolbarLayout(480).mode).toBe("compact");
    const tight = toolbarLayout(400);
    expect(tight.mode).toBe("tight");
    expect(tight.overflow).toEqual(["pen", "image", "shader"]);
    expect(tight.inline).toEqual(["move", "frame", "rect", "text"]);
  });
  it("moves zoom into the overflow menu on very narrow canvases and still fits", () => {
    const l = toolbarLayout(288); // 800px window with both panels
    expect(l.mode).toBe("minimal");
    expect(l.zoomPill).toBe(false);
    expect(toolbarWidth(l)).toBeLessThanOrEqual(288 - 16);
  });
  it("never overlaps the zoom pill when both are shown", () => {
    for (let w = 200; w <= 1400; w += 7) {
      const l = toolbarLayout(w);
      if (!l.zoomPill) continue;
      const toolbarRight = (w + toolbarWidth(l)) / 2;
      expect(toolbarRight).toBeLessThanOrEqual(w - 16 - 56);
    }
  });
});

describe("pixel grid", () => {
  it("appears at 800% and aligns lines to world pixels", () => {
    expect(pixelGrid({ x: 0, y: 0, zoom: 6 })).toBeNull();
    expect(pixelGrid({ x: 21, y: -3, zoom: 8 })).toEqual({ size: 8, offsetX: 5, offsetY: 5 });
  });
});
