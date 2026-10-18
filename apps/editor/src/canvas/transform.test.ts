import { describe, expect, it } from "vitest";
import {
  angleStyle, nextStep, boxBounds, boxContains, boxCorners, handlePoint, normAngle, parseAngle, resizeBox, rotatedHandleCursor,
  rotationFromDrag, topLeftDelta, type OrientedBox,
} from "./transform";

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe("angles", () => {
  it("parses CSS angles and normalises them", () => {
    expect(parseAngle("15deg")).toBe(15);
    expect(parseAngle(30)).toBe(30);
    expect(parseAngle("0.25turn")).toBe(90);
    close(parseAngle(`${Math.PI}rad`), 180);
    expect(parseAngle("nope")).toBe(0);
    expect(normAngle(270)).toBe(-90);
    expect(normAngle(-180)).toBe(180);
    expect(normAngle(720)).toBe(0);
    expect(angleStyle(360)).toBeNull();
    expect(angleStyle(-45.004)).toBe("-45deg");
  });

  it("rotates by the drag angle and snaps to 15 degrees with Shift", () => {
    const c = { x: 0, y: 0 };
    // from the right (0°) to below (90°, clockwise on screen)
    close(rotationFromDrag(c, { x: 10, y: 0 }, { x: 0, y: 10 }, 0), 90);
    close(rotationFromDrag(c, { x: 10, y: 0 }, { x: 10, y: 2 }, 0), (Math.atan2(2, 10) * 180) / Math.PI);
    expect(rotationFromDrag(c, { x: 10, y: 0 }, { x: 10, y: 2 }, 0, 15)).toBe(15);
    expect(rotationFromDrag(c, { x: 10, y: 0 }, { x: -10, y: 1 }, 170, 15)).toBe(-15);
  });
});

describe("rotated boxes", () => {
  const box: OrientedBox = { cx: 50, cy: 50, width: 100, height: 20, angle: 90 };

  it("hit tests in the box's own frame", () => {
    // rotated 90°: a tall thin box
    expect(boxContains(box, { x: 50, y: 5 })).toBe(true);
    expect(boxContains(box, { x: 95, y: 50 })).toBe(false);
    expect(boxContains({ ...box, angle: 0 }, { x: 95, y: 50 })).toBe(true);
    expect(boxContains(box, { x: 62, y: 50 }, 3)).toBe(true);
  });

  it("puts handles at the rotated corners and edges", () => {
    const ne = handlePoint(box, "ne");
    close(ne.x, 60);
    close(ne.y, 100);
    const e = handlePoint(box, "e");
    close(e.x, 50);
    close(e.y, 100);
    const b = boxBounds(box);
    close(b.width, 20);
    close(b.height, 100);
    expect(boxCorners(box)).toHaveLength(4);
  });

  it("resizes in the box's own frame and keeps the opposite edge fixed", () => {
    // drag the east handle (which points down on screen) down by 30
    const out = resizeBox(box, "e", 0, 30);
    close(out.width, 130);
    close(out.height, 20);
    const w0 = handlePoint(box, "w");
    const w1 = handlePoint(out, "w");
    close(w0.x, w1.x);
    close(w0.y, w1.y);
    // sideways motion does not change the width
    close(resizeBox(box, "e", 40, 0).width, 100);
  });

  it("matches plain resizing at 0 degrees", () => {
    const flat: OrientedBox = { cx: 50, cy: 10, width: 100, height: 20, angle: 0 };
    const out = resizeBox(flat, "nw", -10, -5);
    close(out.width, 110);
    close(out.height, 25);
    const d = topLeftDelta(flat, out);
    close(d.x, -10);
    close(d.y, -5);
  });

  it("picks resize cursors that follow the rotation", () => {
    expect(rotatedHandleCursor("e", 0)).toBe("ew-resize");
    expect(rotatedHandleCursor("e", 90)).toBe("ns-resize");
    expect(rotatedHandleCursor("e", 45)).toBe("nwse-resize");
    expect(rotatedHandleCursor("ne", 0)).toBe("nesw-resize");
    expect(rotatedHandleCursor("n", -90)).toBe("ew-resize");
  });
});

describe("repeat duplicate", () => {
  it("repeats the offset and compounds the rotation", () => {
    expect(nextStep({ left: 0, top: 0, angle: 0 }, { left: 100, top: 0, angle: 0 })).toEqual({ left: 200, top: 0 });
    const turn = nextStep({ left: 0, top: 0, angle: 0 }, { left: 100, top: 0, angle: 90 });
    expect(turn).toEqual({ left: 100, top: 100, rotate: "180deg" });
    expect(nextStep({ left: 5, top: 5, angle: 10 }, { left: 5, top: 5, angle: 10 })).toBeNull();
  });
});
