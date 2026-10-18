import { describe, expect, it } from "vitest";
import { clampZoom, fitRect, MAX_ZOOM, MIN_ZOOM, rectToScreen, stepZoom, toScreen, toWorld, wheelPixels, zoomAt } from "./viewport-math";

describe("viewport math", () => {
  const vp = { x: 100, y: 50, zoom: 2 };
  it("converts between world and screen", () => {
    expect(toScreen(vp, { x: 10, y: 10 })).toEqual({ x: 120, y: 70 });
    expect(toWorld(vp, { x: 120, y: 70 })).toEqual({ x: 10, y: 10 });
    expect(rectToScreen(vp, { x: 0, y: 0, width: 10, height: 5 })).toEqual({ x: 100, y: 50, width: 20, height: 10 });
  });
  it("zooms around an anchor without moving the point under it", () => {
    const anchor = { x: 300, y: 200 };
    const before = toWorld(vp, anchor);
    const next = zoomAt(vp, anchor, 5);
    expect(next.zoom).toBe(5);
    const after = toWorld(next, anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
  it("clamps zoom", () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(1e9)).toBe(MAX_ZOOM);
  });
  it("steps through presets", () => {
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1, -1)).toBe(0.667);
    expect(stepZoom(0.41, 1)).toBe(0.5);
    expect(stepZoom(0.41, -1)).toBe(0.333);
  });
  it("fits a rect centred, capped at max zoom", () => {
    const fit = fitRect({ x: 0, y: 0, width: 1000, height: 500 }, { width: 600, height: 400 }, { padding: 50 });
    expect(fit.zoom).toBeCloseTo(0.5);
    expect(fit.x).toBeCloseTo(50);
    expect(fit.y).toBeCloseTo(75);
    const small = fitRect({ x: 10, y: 10, width: 10, height: 10 }, { width: 600, height: 400 }, { maxZoom: 1 });
    expect(small.zoom).toBe(1);
    expect(small.x).toBeCloseTo(285);
  });
  it("normalises wheel deltas", () => {
    expect(wheelPixels(3, 1)).toBe(48);
    expect(wheelPixels(3, 0)).toBe(3);
  });
});
