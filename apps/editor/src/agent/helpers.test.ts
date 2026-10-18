import { describe, expect, it } from "vitest";
import type { OFNode } from "@opencrease/model";
import { curateComputedStyles } from "./computed";
import { canvasOrder, clampRatio, exportFileName, parseExportScale, uniqueNames } from "./export-settings";
import { faceStyleName, googleFontsProbeUrl, parseFontFaceCss, primaryFamily } from "./fonts";
import { globMatch, pxNumber } from "./match";
import { findFreeSpot } from "./placement";
import { REVIEW_THRESHOLD, ReviewTracker, reviewReminder } from "./review";

describe("export settings", () => {
  it("parses scales", () => {
    expect(parseExportScale("2x", 100, 50)).toBe(2);
    expect(parseExportScale("1200w", 600, 300)).toBe(2);
    expect(parseExportScale("630h", 1200, 315)).toBe(2);
    expect(parseExportScale("720p", 1440, 360)).toBe(2);
    expect(() => parseExportScale("2", 1, 1)).toThrow(/Invalid export scale/);
    expect(clampRatio(4, 8000, 100)).toBeCloseTo(16384 / 8000);
  });
  it("names files", () => {
    expect(exportFileName("Hero, desktop", { format: "png", scale: "2x" })).toBe("Hero, desktop@2x.png");
    expect(exportFileName("a/b", { format: "jpg", scale: "1x" })).toBe("a-b.jpg");
    expect(exportFileName("Deck", { format: "pdf", scale: "2x" })).toBe("Deck.pdf");
    expect(exportFileName("Logo", { format: "png", scale: "2x", suffix: "-retina" })).toBe("Logo-retina.png");
    expect(uniqueNames(["Card.png", "card.png", "Card.png"])).toEqual(["Card.png", "card (2).png", "Card (3).png"]);
  });
  it("orders pages top to bottom, then left to right", () => {
    expect(canvasOrder([{ id: "c", x: 0, y: 900 }, { id: "b", x: 1500, y: 0 }, { id: "a", x: 0, y: 0.5 }]).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});

describe("fonts", () => {
  it("builds probe urls and parses faces", () => {
    expect(googleFontsProbeUrl("Playfair Display")).toMatch(/^https:\/\/fonts\.googleapis\.com\/css\?family=Playfair\+Display:100,200,.*,900i$/);
    const css = `@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; src: url(a.woff2); }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; src: url(b.woff2); unicode-range: U+0100; }
@font-face { font-family: 'Inter'; font-style: italic; font-weight: 700; src: url(c.woff2); }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 300 500; src: url(d.woff2); }`;
    expect(parseFontFaceCss(css, "Inter")).toEqual([
      { style: "Light", weight: 300, isItalic: false },
      { style: "Regular", weight: 400, isItalic: false },
      { style: "Medium", weight: 500, isItalic: false },
      { style: "Bold Italic", weight: 700, isItalic: true },
    ]);
    expect(faceStyleName(400, true)).toBe("Italic");
    expect(primaryFamily(`"Instrument Serif", serif`)).toBe("Instrument Serif");
  });
});

describe("matching and placement", () => {
  it("globs case-insensitively and parses px", () => {
    expect(globMatch("--color-*", "--COLOR-primary")).toBe(true);
    expect(globMatch("*brand*", "--x-brand-1")).toBe(true);
    expect(globMatch("a.b", "axb")).toBe(false);
    expect(pxNumber("12px")).toBe(12);
    expect(pxNumber("fit-content")).toBeUndefined();
  });
  it("finds free space for artboards", () => {
    expect(findFreeSpot([], { width: 10, height: 10 })).toEqual({ x: 0, y: 0 });
    expect(findFreeSpot([{ x: 0, y: 100, width: 1440, height: 900 }, { x: 0, y: 1100, width: 2000, height: 10 }], { width: 10, height: 10 })).toEqual({ x: 2080, y: 100 });
    const near = { x: 0, y: 0, width: 100, height: 100 };
    expect(findFreeSpot([near], { width: 100, height: 100 }, near)).toEqual({ x: 180, y: 0 });
    expect(findFreeSpot([near, { x: 180, y: 0, width: 100, height: 100 }], { width: 100, height: 100 }, near)).toEqual({ x: 360, y: 0 });
  });
});

describe("review tracker", () => {
  it("nudges from the fifth write until a screenshot", () => {
    const t = new ReviewTracker();
    for (let i = 1; i < REVIEW_THRESHOLD; i++) expect(t.recordWrite("f", ["a"])).toEqual([]);
    expect(t.recordWrite("f", ["a", "a", "b"])).toEqual(["a"]);
    expect(t.recordWrite("f", ["a"])).toEqual(["a"]);
    t.recordScreenshot("f", "a");
    expect(t.count("f", "a")).toBe(0);
    expect(t.count("g", "b")).toBe(0);
    expect(reviewReminder("Hero")).toContain('"Hero"');
  });
});

describe("computed styles", () => {
  it("keeps non-default values, collapses sides and keeps token references", () => {
    const node: OFNode = { id: "1", type: "Frame", name: "F", parentId: "r", children: [], visible: true, locked: false, styles: { backgroundColor: "var(--color-panel)" } };
    const values: Record<string, string> = {
      display: "flex", position: "static", width: "580px", height: "320px", "flex-direction": "column",
      "padding-top": "8px", "padding-right": "16px", "padding-bottom": "8px", "padding-left": "16px",
      "background-color": "rgb(255, 255, 255)", opacity: "1", "row-gap": "12px", "column-gap": "12px",
      "border-top-left-radius": "14px", "border-top-right-radius": "14px", "border-bottom-right-radius": "14px", "border-bottom-left-radius": "14px",
      "border-top-width": "1px", "border-top-style": "solid", "border-top-color": "rgba(0, 0, 0, 0.5)", top: "10px", color: "rgb(0, 0, 0)",
    };
    expect(curateComputedStyles(node, (p) => values[p] ?? "")).toEqual({
      display: "flex", width: "580px", height: "320px", flexDirection: "column", padding: "8px 16px",
      backgroundColor: "var(--color-panel)", gap: "12px", borderRadius: "14px",
      borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "#00000080",
    });
  });
});
