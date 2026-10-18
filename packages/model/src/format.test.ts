import { describe, expect, it } from "vitest";
import { createDocument } from "./document";
import { ModelError } from "./errors";
import { FORMAT_VERSION, parseFold, serializeFold } from "./format";
import { DocStore } from "./store";

function sample() {
  const store = new DocStore(createDocument("Sample", { id: "01ABC", now: 100 }), { now: () => 200 });
  const rootId = store.doc.pages[store.doc.pageList[0].id].rootId;
  store.transact("build", (tx) => {
    const [hero] = tx.insertTrees(rootId, [
      {
        name: "Hero",
        styles: { width: 1440, height: 640, backgroundColor: "var(--color-bg)", display: "flex" },
        children: [
          { text: "Fired slow.", styles: { fontSize: 64, color: "#111" } },
          { type: "SVG", attrs: { viewBox: "0 0 24 24" }, children: [{ type: "SVGElement", tag: "path", attrs: { d: "M0 0L24 24" } }] },
          { type: "Image", src: "asset://abc" },
          { type: "Shader", shader: { name: "MeshGradient", params: { speed: 1, colors: ["#f00", "#00f"] } } },
        ],
      },
    ]);
    tx.updateNode(hero, { exports: [{ format: "png", scale: "2x" }] });
    tx.createToken({ type: "color", name: "--color-bg", value: "#fff", description: "Background" });
    tx.createPage("Second", "design");
    tx.arrangePages([...store.doc.pageList.map((i) => i.id), { type: "divider" }]);
    tx.addAsset({ hash: "abc", mime: "image/png", size: 3 });
  });
  return store.doc;
}

describe("serializeFold", () => {
  it("writes a manifest and deterministic, sorted, indented JSON", () => {
    const doc = sample();
    const { manifest, documentJson } = serializeFold(doc);
    expect(manifest).toEqual({ formatVersion: FORMAT_VERSION, id: "01ABC", name: "Sample", app: "opencrease 0.1.0" });
    expect(documentJson.endsWith("}\n")).toBe(true);
    expect(documentJson.split("\n")[1]).toBe('  "assets": {');
    const topKeys = [...documentJson.matchAll(/^ {2}"([^"]+)":/gm)].map((m) => m[1]);
    expect(topKeys).toEqual([...topKeys].sort());
    expect(topKeys).toContain("formatVersion");
  });

  it("is independent of key insertion order", () => {
    const doc = sample();
    const reordered = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(doc))).reverse());
    expect(serializeFold(reordered as unknown as typeof doc).documentJson).toBe(serializeFold(doc).documentJson);
  });

  it("keeps array order (children, tokens, pageList)", () => {
    const doc = sample();
    const parsed = JSON.parse(serializeFold(doc).documentJson);
    expect(parsed.pageList).toEqual(doc.pageList);
    expect(parsed.tokens).toEqual(doc.tokens);
    for (const node of Object.values(doc.nodes)) expect(parsed.nodes[node.id].children).toEqual(node.children);
  });
});

describe("parseFold", () => {
  it("round trips", () => {
    const doc = sample();
    const json = serializeFold(doc).documentJson;
    const parsed = parseFold(json);
    expect(parsed).toEqual(JSON.parse(JSON.stringify(doc)));
    expect(serializeFold(parsed).documentJson).toBe(json);
  });

  it("rejects bad input", () => {
    const err = (json: string) => {
      try {
        parseFold(json);
      } catch (e) {
        return (e as ModelError).code;
      }
      return "ok";
    };
    expect(err("{")).toBe("invalid_format");
    expect(err("[]")).toBe("invalid_format");
    expect(err("{}")).toBe("invalid_format");
    expect(err('{"formatVersion":2}')).toBe("unsupported_version");
  });

  it("fills defaults for a minimal document", () => {
    const doc = parseFold('{"formatVersion":1,"id":"X"}');
    expect(doc).toMatchObject({ formatVersion: 1, id: "X", name: "Untitled", tokens: [], assets: {}, clientId: "0" });
    expect(doc.pageList).toHaveLength(1);
    const page = doc.pages[doc.pageList[0].id];
    expect(page.name).toBe("Page 1");
    expect(doc.nodes[page.rootId].type).toBe("Root");
  });

  it("repairs nodes, pages and clock", () => {
    const raw = {
      formatVersion: 1,
      id: "X",
      name: "Repair",
      createdAt: 1,
      updatedAt: 2,
      clock: 0,
      clientId: "0",
      pageList: [{ type: "page", id: "p-missing-0" }, { type: "divider", id: "d-1-0" }],
      pages: { "p-2-0": { id: "p-2-0", name: "Main", rootId: "root_p-2-0" } },
      nodes: {
        "root_p-2-0": { id: "root_p-2-0", type: "Root", children: ["A-0", "gone", "B-0"] },
        "A-0": { type: "Frame", children: ["C-0"], styles: { width: 10, bad: { x: 1 } } },
        "B-0": { type: "Text", text: "Hello", parentId: "wrong" },
        "C-0": { type: "Text", children: ["B-0"] },
        "Z-0": { type: "Frame", parentId: "nowhere" },
        "Y-0": { type: "Banana" },
      },
      tokens: [{ type: "color", name: "primary", value: "red" }, { type: "color", name: "--primary", value: "blue" }, { name: "--x" }],
    };
    const doc = parseFold(JSON.stringify(raw));
    expect(doc.pageList).toEqual([{ type: "divider", id: "d-1-0" }, { type: "page", id: "p-2-0" }]);
    expect(doc.pages["p-2-0"].icon).toBeNull();
    expect(Object.keys(doc.nodes).sort()).toEqual(["A-0", "B-0", "C-0", "root_p-2-0"]);
    expect(doc.nodes["root_p-2-0"]).toMatchObject({ name: "Root", parentId: null, children: ["A-0", "B-0"] });
    expect(doc.nodes["A-0"]).toMatchObject({ name: "Frame", parentId: "root_p-2-0", visible: true, locked: false, styles: { width: 10 } });
    expect(doc.nodes["B-0"]).toMatchObject({ name: "Hello", parentId: "root_p-2-0" });
    expect(doc.nodes["C-0"]).toMatchObject({ children: [], text: "", parentId: "A-0" });
    expect(doc.tokens).toHaveLength(1);
    expect(doc.tokens[0]).toMatchObject({ name: "--primary", value: "red" });
    expect(doc.tokens[0].id).toMatch(/^t-/);
    expect(doc.clock).toBeGreaterThanOrEqual(parseInt("C", 36));
  });

  it("loads into a store that keeps generating unique ids", () => {
    const doc = parseFold(serializeFold(sample()).documentJson);
    const store = new DocStore(doc);
    const rootId = doc.pages[doc.pageList[0].id].rootId;
    const before = new Set(Object.keys(doc.nodes));
    const [id] = store.transact("x", (tx) => tx.insertTrees(rootId, [{}]));
    expect(before.has(id)).toBe(false);
  });
});
