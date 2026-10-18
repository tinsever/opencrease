import { describe, expect, it } from "vitest";
import {
  bendSegment, cubicPoint, deleteAnchors, fmt, inferPointType, invert, moveHandle, multiply, nearestSegment, parsePath,
  pathBounds, segmentAt, serializePath, setPointType, splitSegment, transformPath, type Matrix,
} from "./path";

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("parsePath / serializePath", () => {
  it("round-trips absolute lines and curves", () => {
    const d = "M0 0L10 0C15 0 20 5 20 10Z";
    const p = parsePath(d);
    expect(p).toHaveLength(1);
    expect(p[0].closed).toBe(true);
    expect(p[0].anchors).toHaveLength(3);
    expect(p[0].anchors[1].out).toEqual({ x: 15, y: 0 });
    expect(p[0].anchors[2].in).toEqual({ x: 20, y: 5 });
    expect(serializePath(p)).toBe(d);
  });

  it("handles relative commands, H/V and implicit line-tos", () => {
    const p = parsePath("m10 10 h20 v10 l-5 5 -5 0 z");
    expect(p[0].anchors.map((a) => [a.x, a.y])).toEqual([[10, 10], [30, 10], [30, 20], [25, 25], [20, 25]]);
    expect(serializePath(p)).toBe("M10 10L30 10L30 20L25 25L20 25Z");
  });

  it("merges a closing curve that ends on the start point into the first anchor", () => {
    const p = parsePath("M0 0C5 -5 10 -5 10 0C10 5 5 10 0 10C-5 10 -5 0 0 0Z");
    expect(p[0].anchors).toHaveLength(3);
    expect(p[0].anchors[0].in).toEqual({ x: -5, y: 0 });
    expect(serializePath(parsePath(serializePath(p)))).toBe(serializePath(p));
  });

  it("converts S, Q and T to cubics", () => {
    const s = parsePath("M0 0C0 10 10 10 10 0S20 -10 20 0");
    expect(s[0].anchors[1].out).toEqual({ x: 10, y: -10 });
    const q = parsePath("M0 0Q10 10 20 0T40 0");
    const a = q[0].anchors;
    near(a[0].out!.x, 20 / 3);
    near(a[0].out!.y, 20 / 3);
    near(a[1].out!.y, -20 / 3);
  });

  it("converts arcs, including compact flags", () => {
    const p = parsePath("M0 10a10 10 0 0110-10");
    const end = p[0].anchors[p[0].anchors.length - 1];
    near(end.x, 10);
    near(end.y, 0);
    const b = pathBounds(p)!;
    near(b.x, 0, 1e-3);
    near(b.y, 0, 1e-3);
    near(b.width, 10, 1e-3);
    // a quarter circle bulges towards (0,0): its midpoint lies about 2.93 from the corner
    const mid = cubicPoint(segmentAt(p, 0, 0), 0.5);
    near(Math.hypot(mid.x - 10, mid.y - 10), 10, 0.02);
  });

  it("keeps multiple subpaths and drops garbage", () => {
    const p = parsePath("M0 0L1 1ZM5 5L6 6 foo");
    expect(p).toHaveLength(2);
    expect(parsePath("")).toEqual([]);
    expect(parsePath("L 3")).toEqual([]);
  });

  it("formats numbers compactly", () => {
    expect(fmt(1.23456)).toBe("1.235");
    expect(fmt(-0.0001)).toBe("0");
    expect(fmt(10)).toBe("10");
  });
});

describe("bounds", () => {
  it("uses curve extrema, not handles", () => {
    const p = parsePath("M0 0C0 -40 100 -40 100 0");
    const b = pathBounds(p)!;
    near(b.y, -30);
    near(b.height, 30);
    near(b.width, 100);
  });
  it("is null for empty paths", () => {
    expect(pathBounds([])).toBeNull();
  });
});

describe("matrices", () => {
  it("inverts and composes", () => {
    const m: Matrix = [2, 0, 0, 3, 10, 20];
    const id = multiply(m, invert(m));
    id.forEach((v, i) => near(v, [1, 0, 0, 1, 0, 0][i]));
    const t = transformPath(parsePath("M1 1L2 2"), m);
    expect(t[0].anchors[1]).toMatchObject({ x: 14, y: 26 });
  });
});

describe("point types", () => {
  it("infers corner, mirrored, asymmetric and disconnected", () => {
    const p = parsePath("M0 0C0 0 5 10 10 10C15 10 20 0 20 0");
    expect(inferPointType(p[0], 0)).toBe("corner");
    expect(inferPointType(p[0], 1)).toBe("mirrored");
    p[0].anchors[1].out = { x: 20, y: 10 };
    expect(inferPointType(p[0], 1)).toBe("asymmetric");
    p[0].anchors[1].out = { x: 15, y: 15 };
    expect(inferPointType(p[0], 1)).toBe("disconnected");
  });

  it("converts corners to smooth points from their neighbours and back", () => {
    const p = parsePath("M0 0L10 10L20 0");
    setPointType(p[0], 1, "mirrored");
    expect(inferPointType(p[0], 1)).toBe("mirrored");
    near(p[0].anchors[1].in!.y, 10);
    setPointType(p[0], 1, "corner");
    expect(p[0].anchors[1].in).toBeNull();
    const q = parsePath("M0 0L10 10L40 10");
    setPointType(q[0], 1, "asymmetric");
    expect(inferPointType(q[0], 1)).toBe("asymmetric");
    setPointType(q[0], 1, "mirrored");
    expect(inferPointType(q[0], 1)).toBe("mirrored");
  });

  it("moves handles according to the type", () => {
    const p = parsePath("M0 0C0 0 5 10 10 10C15 10 20 0 20 0");
    moveHandle(p[0], 1, "out", { x: 10, y: 20 }, "mirrored");
    expect(p[0].anchors[1].in).toEqual({ x: 10, y: 0 });
    moveHandle(p[0], 1, "out", { x: 30, y: 10 }, "asymmetric");
    near(p[0].anchors[1].in!.x, 0);
    near(p[0].anchors[1].in!.y, 10);
    moveHandle(p[0], 1, "out", { x: 12, y: 3 }, "disconnected");
    near(p[0].anchors[1].in!.x, 0);
  });
});

describe("structural edits", () => {
  it("splits lines and curves without changing the shape", () => {
    const p = parsePath("M0 0L10 0");
    const r = splitSegment(p, 0, 0, 0.5);
    expect(r).toEqual({ sub: 0, index: 1 });
    expect(p[0].anchors[1]).toMatchObject({ x: 5, y: 0, in: null, out: null });

    const c = parsePath("M0 0C0 10 10 10 10 0");
    const before = cubicPoint(segmentAt(c, 0, 0), 0.25);
    splitSegment(c, 0, 0, 0.5);
    const after = cubicPoint(segmentAt(c, 0, 0), 0.5);
    near(before.x, after.x);
    near(before.y, after.y);
  });

  it("deletes anchors and drops degenerate subpaths", () => {
    const p = parsePath("M0 0L10 0L10 10ZM20 20L30 30");
    const out = deleteAnchors(p, [{ sub: 0, index: 1 }, { sub: 1, index: 0 }]);
    expect(out).toHaveLength(1);
    expect(out[0].anchors).toHaveLength(2);
  });

  it("finds the nearest segment", () => {
    const p = parsePath("M0 0L100 0L100 100");
    const hit = nearestSegment(p, { x: 50, y: 4 })!;
    expect(hit.seg.index).toBe(0);
    near(hit.t, 0.5);
    near(hit.d, 4);
  });

  it("bends a segment through the dragged point", () => {
    const p = parsePath("M0 0L90 0");
    bendSegment(p, 0, 0, 0.5, { x: 0, y: 30 });
    const mid = cubicPoint(segmentAt(p, 0, 0), 0.5);
    near(mid.x, 45);
    near(mid.y, 30);
  });
});
