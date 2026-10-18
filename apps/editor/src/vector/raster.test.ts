import { describe, expect, it } from "vitest";
import { rasterPlacement } from "./raster";

describe("raster tracing placement", () => {
  it("crops cover at the requested position", () => {
    expect(rasterPlacement(200, 100, 100, 100, "cover", "right top")).toEqual({ x: -100, y: 0, width: 200, height: 100 });
    expect(rasterPlacement(200, 100, 100, 100, "cover")).toEqual({ x: -50, y: 0, width: 200, height: 100 });
  });
  it("keeps contain letterboxing and percentage offsets", () => {
    expect(rasterPlacement(200, 100, 100, 100, "contain", "50% 80%")).toEqual({ x: 0, y: 40, width: 100, height: 50 });
  });
  it("keeps natural size for none and does not enlarge scale-down images", () => {
    expect(rasterPlacement(20, 10, 100, 100, "none")).toEqual({ x: 40, y: 45, width: 20, height: 10 });
    expect(rasterPlacement(20, 10, 100, 100, "scale-down", "left top")).toEqual({ x: 0, y: 0, width: 20, height: 10 });
    expect(rasterPlacement(200, 100, 100, 100, "scale-down")).toEqual({ x: 0, y: 25, width: 100, height: 50 });
  });
  it("stretches fill and handles one-axis positions", () => {
    expect(rasterPlacement(200, 100, 100, 100, "fill")).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(rasterPlacement(200, 100, 100, 100, "contain", "bottom")).toEqual({ x: 0, y: 50, width: 100, height: 50 });
  });
});
