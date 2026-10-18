import { describe, expect, it } from "vitest";
import type { FoldDocument, OFNode } from "@opencrease/model";
import { cropPatch, imageRect } from "./crop";

describe("image fill crop", () => {
  it("computes the rendered image rect for cover, contain, explicit sizes and positions", () => {
    expect(imageRect({ size: "cover", position: "center" }, 200, 100, 100, 100)).toEqual({ x: 0, y: -50, width: 200, height: 200 });
    expect(imageRect({ size: "contain", position: "center" }, 200, 100, 100, 100)).toEqual({ x: 50, y: 0, width: 100, height: 100 });
    expect(imageRect({ size: "50%", position: "0% 0%" }, 200, 100, 100, 50)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(imageRect({ size: "80px 40px", position: "10px 20px" }, 200, 100, 100, 50)).toEqual({ x: 10, y: 20, width: 80, height: 40 });
  });
  it("keeps the image fixed in world space while the box changes", () => {
    const doc = { assets: { abcdef0123456789: { hash: "abcdef0123456789", mime: "image/png", size: 1, width: 100, height: 100 } } } as unknown as FoldDocument;
    const node = {
      id: "n", type: "Frame", name: "n", parentId: null, children: [], visible: true, locked: false,
      styles: { backgroundImage: 'url("/api/files/f/assets/abcdef0123456789")', backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" },
    } as OFNode;
    // box 200×100 at (0,0): cover image is 200×200 at (0,-50); the left edge moves right by 40
    const patch = cropPatch(doc, node, { x: 0, y: 0, width: 200, height: 100 }, { x: 40, y: 0, width: 160, height: 100 });
    expect(patch).toMatchObject({ backgroundSize: "200px 200px", backgroundPosition: "-40px -50px", backgroundRepeat: "no-repeat" });
    expect(cropPatch(doc, { ...node, styles: { backgroundColor: "red" } }, { x: 0, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 2, height: 2 })).toBeNull();
  });
});
