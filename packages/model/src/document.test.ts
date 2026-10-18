import { describe, expect, it } from "vitest";
import { createDocument } from "./document";
import { fnv1a, stableStringify } from "./hash";
import { maxClockInIds, newFileId, nextNodeId } from "./ids";
import { canContain, defaultNodeName, inferNodeType } from "./nodes";

describe("createDocument", () => {
  it("creates one page with its Root", () => {
    const doc = createDocument("My file", { id: "FILE", clientId: "c1", now: 1234 });
    expect(doc).toMatchObject({ formatVersion: 1, id: "FILE", name: "My file", createdAt: 1234, updatedAt: 1234, clientId: "c1" });
    expect(doc.pageList).toHaveLength(1);
    const item = doc.pageList[0];
    expect(item.type).toBe("page");
    const page = doc.pages[item.id];
    expect(page).toEqual({ id: item.id, name: "Page 1", icon: null, rootId: `root_${item.id}` });
    expect(item.id).toBe("p-1-c1");
    expect(doc.nodes).toEqual({
      [page.rootId]: { id: page.rootId, type: "Root", name: "Root", parentId: null, children: [], visible: true, locked: false, styles: {} },
    });
    expect(doc.tokens).toEqual([]);
    expect(doc.assets).toEqual({});
    expect(doc.clock).toBe(1);
  });

  it("defaults id, clientId and name", () => {
    const doc = createDocument("  ");
    expect(doc.name).toBe("Untitled");
    expect(doc.clientId).toBe("0");
    expect(doc.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe("ids", () => {
  it("newFileId is a sortable 26 char Crockford ULID", () => {
    const a = newFileId(1_700_000_000_000);
    const b = newFileId(1_700_000_000_001);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
    expect(newFileId()).not.toBe(newFileId());
  });

  it("node ids use base36 upper-case counters and skip taken ids", () => {
    const doc = createDocument("x", { id: "F", clientId: "0" });
    doc.clock = 34;
    expect(nextNodeId(doc)).toBe("Z-0");
    doc.nodes["10-0"] = { ...doc.nodes[doc.pages[doc.pageList[0].id].rootId] };
    expect(nextNodeId(doc)).toBe("11-0");
  });

  it("maxClockInIds reads counters from generated ids", () => {
    const doc = createDocument("x", { id: "F" });
    doc.nodes["ZZ-0"] = { ...Object.values(doc.nodes)[0], id: "ZZ-0" };
    expect(maxClockInIds(doc)).toBe(parseInt("ZZ", 36));
  });
});

describe("node rules", () => {
  it("canContain", () => {
    expect(canContain("Root", "Frame")).toBe(true);
    expect(canContain("Frame", "SVG")).toBe(true);
    expect(canContain("Frame", "SVGElement")).toBe(false);
    expect(canContain("SVG", "SVGElement")).toBe(true);
    expect(canContain("SVGElement", "SVGElement")).toBe(true);
    expect(canContain("SVG", "Text")).toBe(false);
    for (const leaf of ["Text", "Rectangle", "Image", "Shader"] as const) expect(canContain(leaf, "Frame")).toBe(false);
    expect(canContain("Frame", "Root")).toBe(false);
  });

  it("inferNodeType", () => {
    expect(inferNodeType({})).toBe("Rectangle");
    expect(inferNodeType({ children: [] })).toBe("Rectangle");
    expect(inferNodeType({ children: [{}] })).toBe("Frame");
    expect(inferNodeType({ text: "" })).toBe("Text");
    expect(inferNodeType({ type: "Frame", text: "x" })).toBe("Frame");
  });

  it("defaultNodeName", () => {
    expect(defaultNodeName({ type: "Text", text: "Line one\nline two" })).toBe("Line one line two");
    expect(defaultNodeName({ type: "SVGElement", tag: "circle" })).toBe("Circle");
    expect(defaultNodeName({ type: "Shader", shader: { name: "GrainGradient", params: {} } })).toBe("GrainGradient");
    expect(defaultNodeName({ type: "Frame" })).toBe("Frame");
  });
});

describe("hash helpers", () => {
  it("fnv1a matches reference vectors", () => {
    expect(fnv1a("")).toBe("811c9dc5");
    expect(fnv1a("a")).toBe("e40c292c");
    expect(fnv1a("foobar")).toBe("bf9cf968");
    expect(fnv1a("é")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("stableStringify sorts keys but keeps array order", () => {
    expect(stableStringify({ b: 1, a: { d: [3, 1, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,1,{"y":2,"z":1}]},"b":1}');
  });
});
