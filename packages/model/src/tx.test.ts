import { describe, expect, it } from "vitest";
import { createDocument } from "./document";
import { ModelError } from "./errors";
import { DocStore } from "./store";
import type { Tx } from "./contracts";
import type { FoldDocument, NodeTree } from "./types";

function setup() {
  const store = new DocStore(createDocument("Test", { id: "F", now: 1000 }), { now: () => 2000 });
  const pageId = store.doc.pageList[0].id;
  const rootId = store.doc.pages[pageId].rootId;
  return { store, pageId, rootId };
}

function run<T>(store: DocStore, fn: (tx: Tx) => T): T {
  return store.transact("test", fn);
}

function expectModelError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).code).toBe(code);
    return;
  }
  throw new Error(`expected ModelError ${code}`);
}

const names = (doc: FoldDocument, ids: string[]) => ids.map((id) => doc.nodes[id].name);

describe("insertTrees", () => {
  it("inserts nested trees with defaults and returns one root id per tree", () => {
    const { store, rootId } = setup();
    const trees: NodeTree[] = [
      {
        name: "Hero",
        styles: { width: 1440, display: "flex" },
        children: [{ text: "Hello\nworld" }, { styles: { height: 1 } }],
      },
      { type: "Frame" },
    ];
    const ids = run(store, (tx) => tx.insertTrees(rootId, trees));
    const doc = store.doc;
    expect(ids).toHaveLength(2);
    expect(doc.nodes[rootId].children).toEqual(ids);
    const hero = doc.nodes[ids[0]];
    expect(hero).toMatchObject({ type: "Frame", name: "Hero", parentId: rootId, visible: true, locked: false });
    expect(hero.styles).toEqual({ width: 1440, display: "flex" });
    const [text, rect] = hero.children.map((id) => doc.nodes[id]);
    expect(text).toMatchObject({ type: "Text", name: "Hello world", text: "Hello\nworld", parentId: hero.id, children: [] });
    expect(rect).toMatchObject({ type: "Rectangle", name: "Rectangle", styles: { height: 1 } });
    expect(doc.nodes[ids[1]]).toMatchObject({ type: "Frame", name: "Frame", styles: {}, children: [] });
  });

  it("allocates ids in document order from the clock", () => {
    const { store, rootId } = setup();
    const clock = store.doc.clock;
    const [a] = run(store, (tx) => tx.insertTrees(rootId, [{ children: [{ text: "x" }] }]));
    expect(a).toBe(`${(clock + 1).toString(36).toUpperCase()}-0`);
    expect(store.doc.nodes[a].children[0]).toBe(`${(clock + 2).toString(36).toUpperCase()}-0`);
    expect(store.doc.clock).toBe(clock + 2);
  });

  it("inserts at an index, clamping out of range values", () => {
    const { store, rootId } = setup();
    const [a, b] = run(store, (tx) => tx.insertTrees(rootId, [{ name: "a" }, { name: "b" }]));
    const [c] = run(store, (tx) => tx.insertTrees(rootId, [{ name: "c" }], 1));
    const [d] = run(store, (tx) => tx.insertTrees(rootId, [{ name: "d" }], -5));
    const [e] = run(store, (tx) => tx.insertTrees(rootId, [{ name: "e" }], 99));
    expect(store.doc.nodes[rootId].children).toEqual([d, a, c, b, e]);
  });

  it("derives names per type", () => {
    const { store, rootId } = setup();
    const long = "a".repeat(60);
    const ids = run(store, (tx) =>
      tx.insertTrees(rootId, [
        { text: long },
        { type: "Text", text: "" },
        { type: "Image", src: "asset://abc" },
        { type: "SVG", tag: "svg", children: [{ type: "SVGElement", tag: "path" }, { type: "SVGElement", tag: "linearGradient" }] },
        { type: "Shader", shader: { name: "MeshGradient", params: {} } },
        { type: "Rectangle", name: "  " },
        { src: "https://x/y.png" },
      ]),
    );
    const doc = store.doc;
    expect(names(doc, ids)).toEqual(["a".repeat(40), "Text", "Image", "SVG", "MeshGradient", "Rectangle", "Image"]);
    expect(names(doc, doc.nodes[ids[3]].children)).toEqual(["Path", "LinearGradient"]);
  });

  it("keeps type specific fields only", () => {
    const { store, rootId } = setup();
    const [svg] = run(store, (tx) =>
      tx.insertTrees(rootId, [{ type: "SVG", attrs: { viewBox: "0 0 10 10" }, children: [{ type: "SVGElement", tag: "path", attrs: { d: "M0 0" } }] }]),
    );
    const node = store.doc.nodes[svg];
    expect(node.tag).toBe("svg");
    expect(node.attrs).toEqual({ viewBox: "0 0 10 10" });
    expect(store.doc.nodes[node.children[0]].attrs).toEqual({ d: "M0 0" });
    const [frame] = run(store, (tx) => tx.insertTrees(rootId, [{ type: "Frame", text: "ignored" }]));
    expect(store.doc.nodes[frame].text).toBeUndefined();
  });

  it("drops empty style values", () => {
    const { store, rootId } = setup();
    const [id] = run(store, (tx) => tx.insertTrees(rootId, [{ styles: { width: 10, color: "" } }]));
    expect(store.doc.nodes[id].styles).toEqual({ width: 10 });
  });

  it("clones with cloneOf: deep copy, new ids, merged styles", () => {
    const { store, rootId } = setup();
    const [card] = run(store, (tx) =>
      tx.insertTrees(rootId, [{ name: "Card", styles: { padding: 8, color: "red" }, children: [{ text: "Title" }] }]),
    );
    const [clone] = run(store, (tx) => tx.insertTrees(rootId, [{ cloneOf: card, styles: { color: "blue" } }]));
    const doc = store.doc;
    const src = doc.nodes[card];
    const copy = doc.nodes[clone];
    expect(clone).not.toBe(card);
    expect(copy.name).toBe("Card");
    expect(copy.styles).toEqual({ padding: 8, color: "blue" });
    expect(src.styles).toEqual({ padding: 8, color: "red" });
    expect(copy.children).toHaveLength(1);
    expect(copy.children[0]).not.toBe(src.children[0]);
    expect(doc.nodes[copy.children[0]]).toMatchObject({ text: "Title", parentId: clone });
  });

  it("clones nested inside a new tree", () => {
    const { store, rootId } = setup();
    const [btn] = run(store, (tx) => tx.insertTrees(rootId, [{ name: "Button", children: [{ text: "Go" }] }]));
    const [wrap] = run(store, (tx) => tx.insertTrees(rootId, [{ name: "Row", children: [{ cloneOf: btn }, { cloneOf: btn, name: "Second" }] }]));
    const row = store.doc.nodes[wrap];
    expect(names(store.doc, row.children)).toEqual(["Button", "Second"]);
    expect(row.children.every((id) => store.doc.nodes[id].parentId === wrap)).toBe(true);
  });

  it("validates structure", () => {
    const { store, rootId } = setup();
    expectModelError(() => run(store, (tx) => tx.insertTrees("nope", [{}])), "not_found");
    expectModelError(() => run(store, (tx) => tx.insertTrees(rootId, [{ type: "Text", text: "x", children: [{}] }])), "invalid_tree");
    expectModelError(() => run(store, (tx) => tx.insertTrees(rootId, [{ type: "Rectangle", children: [{}] }])), "invalid_tree");
    expectModelError(() => run(store, (tx) => tx.insertTrees(rootId, [{ type: "SVGElement", tag: "path" }])), "invalid_parent");
    expectModelError(() => run(store, (tx) => tx.insertTrees(rootId, [{ type: "SVG", children: [{ type: "Frame" }] }])), "invalid_parent");
    expectModelError(() => run(store, (tx) => tx.insertTrees(rootId, [{ type: "SVG", children: [{ type: "SVGElement" }] }])), "invalid_tree");
    expectModelError(() => run(store, (tx) => tx.insertTrees(rootId, [{ type: "Shader" }])), "invalid_tree");
    expectModelError(() => run(store, (tx) => tx.insertTrees(rootId, [{ type: "Root" as "Frame" }])), "invalid_tree");
    expectModelError(() => run(store, (tx) => tx.insertTrees(rootId, [{ cloneOf: "missing" }])), "not_found");
    expectModelError(() => run(store, (tx) => tx.insertTrees(rootId, [{ cloneOf: rootId }])), "root_node");
    expectModelError(() => run(store, (tx) => tx.insertTrees(rootId, [{ styles: { width: {} as unknown as string } }])), "invalid_argument");
    const [text] = run(store, (tx) => tx.insertTrees(rootId, [{ text: "x" }]));
    expectModelError(() => run(store, (tx) => tx.insertTrees(text, [{}])), "invalid_parent");
  });

  it("applies nothing when a later tree fails", () => {
    const { store, rootId } = setup();
    const before = store.doc;
    expectModelError(() => run(store, (tx) => tx.insertTrees(rootId, [{ name: "ok" }, { type: "Text", children: [{}] }])), "invalid_tree");
    expect(store.doc).toBe(before);
    expect(store.canUndo).toBe(false);
  });
});

describe("updateNode", () => {
  it("patches fields and validates them per type", () => {
    const { store, rootId } = setup();
    const [frame, text] = run(store, (tx) => tx.insertTrees(rootId, [{ name: "F" }, { text: "Hi" }]));
    run(store, (tx) => tx.updateNode(frame, { name: "Box", visible: false, locked: true, exports: [{ format: "png", scale: "2x" }] }));
    expect(store.doc.nodes[frame]).toMatchObject({ name: "Box", visible: false, locked: true, exports: [{ format: "png", scale: "2x" }] });
    run(store, (tx) => tx.updateNode(frame, { exports: undefined }));
    expect(store.doc.nodes[frame].exports).toBeUndefined();
    expectModelError(() => run(store, (tx) => tx.updateNode(frame, { text: "nope" })), "invalid_argument");
    expectModelError(() => run(store, (tx) => tx.updateNode(text, { src: "x" })), "invalid_argument");
    expectModelError(() => run(store, (tx) => tx.updateNode("missing", { name: "x" })), "not_found");
  });

  it("empty name falls back to the derived name", () => {
    const { store, rootId } = setup();
    const [text] = run(store, (tx) => tx.insertTrees(rootId, [{ text: "Hello", name: "Custom" }]));
    run(store, (tx) => tx.updateNode(text, { name: "" }));
    expect(store.doc.nodes[text].name).toBe("Hello");
  });

  it("auto-named text layers follow their text, renamed ones keep their name", () => {
    const { store, rootId } = setup();
    const [auto, named] = run(store, (tx) => tx.insertTrees(rootId, [{ text: "Old" }, { text: "Old", name: "Title" }]));
    run(store, (tx) => {
      tx.updateNode(auto, { text: "New text" });
      tx.updateNode(named, { text: "New text" });
    });
    expect(store.doc.nodes[auto].name).toBe("New text");
    expect(store.doc.nodes[named].name).toBe("Title");
  });
});

describe("setStyles", () => {
  it("merges, removes with null or empty string, and replaces", () => {
    const { store, rootId } = setup();
    const [id] = run(store, (tx) => tx.insertTrees(rootId, [{ styles: { width: 10, height: 20, color: "red" } }]));
    run(store, (tx) => tx.setStyles(id, { width: 30, height: null, color: "", opacity: 0.5 }));
    expect(store.doc.nodes[id].styles).toEqual({ width: 30, opacity: 0.5 });
    run(store, (tx) => tx.setStyles(id, { display: "flex", gap: null }, "replace"));
    expect(store.doc.nodes[id].styles).toEqual({ display: "flex" });
  });

  it("rejects invalid values", () => {
    const { store, rootId } = setup();
    const [id] = run(store, (tx) => tx.insertTrees(rootId, [{}]));
    expectModelError(() => run(store, (tx) => tx.setStyles(id, { width: Number.NaN })), "invalid_argument");
    expectModelError(() => run(store, (tx) => tx.setStyles(id, { width: true as unknown as number })), "invalid_argument");
    expectModelError(() => run(store, (tx) => tx.setStyles("missing", {})), "not_found");
  });

  it("is a no-op (no history) when nothing changes", () => {
    const { store, rootId } = setup();
    const [id] = run(store, (tx) => tx.insertTrees(rootId, [{ styles: { width: 10 } }]));
    const before = store.doc;
    run(store, (tx) => tx.setStyles(id, { width: 10, color: null }));
    expect(store.doc).toBe(before);
    expect(store.undoLabels).toHaveLength(1);
  });
});

describe("moveNode", () => {
  it("reorders within a parent; index is the final position", () => {
    const { store, rootId } = setup();
    const [a, b, c] = run(store, (tx) => tx.insertTrees(rootId, [{ name: "a" }, { name: "b" }, { name: "c" }]));
    run(store, (tx) => tx.moveNode(a, rootId, 2));
    expect(store.doc.nodes[rootId].children).toEqual([b, c, a]);
    run(store, (tx) => tx.moveNode(a, rootId, 0));
    expect(store.doc.nodes[rootId].children).toEqual([a, b, c]);
    run(store, (tx) => tx.moveNode(b, rootId));
    expect(store.doc.nodes[rootId].children).toEqual([a, c, b]);
  });

  it("reparents with clamped index", () => {
    const { store, rootId } = setup();
    const [box, x] = run(store, (tx) => tx.insertTrees(rootId, [{ type: "Frame", children: [{ name: "inner" }] }, { name: "x" }]));
    const inner = store.doc.nodes[box].children[0];
    run(store, (tx) => tx.moveNode(x, box, -3));
    expect(store.doc.nodes[box].children).toEqual([x, inner]);
    expect(store.doc.nodes[x].parentId).toBe(box);
    expect(store.doc.nodes[rootId].children).toEqual([box]);
    run(store, (tx) => tx.moveNode(x, rootId, 100));
    expect(store.doc.nodes[rootId].children).toEqual([box, x]);
    expect(store.doc.nodes[x].parentId).toBe(rootId);
  });

  it("moves across pages", () => {
    const { store, rootId } = setup();
    const [a] = run(store, (tx) => tx.insertTrees(rootId, [{ name: "a" }]));
    const page2 = run(store, (tx) => tx.createPage("Two"));
    const root2 = store.doc.pages[page2].rootId;
    run(store, (tx) => tx.moveNode(a, root2));
    expect(store.doc.nodes[root2].children).toEqual([a]);
    expect(store.doc.nodes[rootId].children).toEqual([]);
  });

  it("prevents cycles and invalid parents", () => {
    const { store, rootId } = setup();
    const [outer, text] = run(store, (tx) => tx.insertTrees(rootId, [{ type: "Frame", children: [{ type: "Frame", children: [{}] }] }, { text: "t" }]));
    const mid = store.doc.nodes[outer].children[0];
    expectModelError(() => run(store, (tx) => tx.moveNode(outer, mid)), "cycle");
    expectModelError(() => run(store, (tx) => tx.moveNode(outer, outer)), "cycle");
    expectModelError(() => run(store, (tx) => tx.moveNode(rootId, outer)), "root_node");
    expectModelError(() => run(store, (tx) => tx.moveNode(mid, text)), "invalid_parent");
    expectModelError(() => run(store, (tx) => tx.moveNode(mid, "missing")), "not_found");
  });
});

describe("deleteNode", () => {
  it("removes the node and all descendants", () => {
    const { store, rootId } = setup();
    const [a, b] = run(store, (tx) => tx.insertTrees(rootId, [{ children: [{ children: [{ text: "deep" }] }] }, { name: "b" }]));
    const count = Object.keys(store.doc.nodes).length;
    run(store, (tx) => tx.deleteNode(a));
    expect(Object.keys(store.doc.nodes)).toHaveLength(count - 3);
    expect(store.doc.nodes[a]).toBeUndefined();
    expect(store.doc.nodes[rootId].children).toEqual([b]);
  });

  it("refuses to delete roots", () => {
    const { store, rootId } = setup();
    expectModelError(() => run(store, (tx) => tx.deleteNode(rootId)), "root_node");
    expectModelError(() => run(store, (tx) => tx.deleteNode("missing")), "not_found");
  });
});

describe("duplicateNode", () => {
  it("places the copy right after the source with a full idMap", () => {
    const { store, rootId } = setup();
    const [a, b] = run(store, (tx) => tx.insertTrees(rootId, [{ name: "Card", children: [{ text: "one" }, { children: [{}] }] }, { name: "b" }]));
    const { newId, idMap } = run(store, (tx) => tx.duplicateNode(a));
    const doc = store.doc;
    expect(doc.nodes[rootId].children).toEqual([a, newId, b]);
    expect(Object.keys(idMap)).toHaveLength(4);
    expect(idMap[a]).toBe(newId);
    for (const [from, to] of Object.entries(idMap)) {
      expect(doc.nodes[to].name).toBe(doc.nodes[from].name);
      expect(doc.nodes[to].type).toBe(doc.nodes[from].type);
      expect(to).not.toBe(from);
    }
    const inner = doc.nodes[a].children[1];
    expect(doc.nodes[idMap[inner]].parentId).toBe(newId);
  });

  it("duplicates into another parent at an index, or appended", () => {
    const { store, rootId } = setup();
    const [box, x] = run(store, (tx) => tx.insertTrees(rootId, [{ type: "Frame", children: [{}, {}] }, { name: "x" }]));
    const first = run(store, (tx) => tx.duplicateNode(x, box, 1)).newId;
    expect(store.doc.nodes[box].children[1]).toBe(first);
    const second = run(store, (tx) => tx.duplicateNode(x, box)).newId;
    expect(store.doc.nodes[box].children.at(-1)).toBe(second);
    expect(store.doc.nodes[second].parentId).toBe(box);
  });

  it("can duplicate a node into its own subtree", () => {
    const { store, rootId } = setup();
    const [box] = run(store, (tx) => tx.insertTrees(rootId, [{ type: "Frame", children: [{ name: "c" }] }]));
    const { newId, idMap } = run(store, (tx) => tx.duplicateNode(box, box));
    expect(Object.keys(idMap)).toHaveLength(2);
    expect(store.doc.nodes[box].children).toContain(newId);
  });

  it("validates", () => {
    const { store, rootId } = setup();
    const [text] = run(store, (tx) => tx.insertTrees(rootId, [{ text: "t" }]));
    expectModelError(() => run(store, (tx) => tx.duplicateNode(rootId)), "root_node");
    expectModelError(() => run(store, (tx) => tx.duplicateNode(text, text)), "invalid_parent");
  });
});

describe("pages", () => {
  it("creates pages with default names, icons and position", () => {
    const { store, pageId } = setup();
    const p2 = run(store, (tx) => tx.createPage());
    const p3 = run(store, (tx) => tx.createPage("Icons", "swatches", pageId));
    const doc = store.doc;
    expect(doc.pageList.map((i) => i.id)).toEqual([pageId, p3, p2]);
    expect(doc.pages[p2]).toMatchObject({ name: "Page 2", icon: null, rootId: `root_${p2}` });
    expect(doc.pages[p3]).toMatchObject({ name: "Icons", icon: "swatches" });
    expect(doc.nodes[`root_${p3}`]).toMatchObject({ type: "Root", parentId: null, children: [] });
    expect(p2).toMatch(/^p-[0-9A-Z]+-0$/);
    expectModelError(() => run(store, (tx) => tx.createPage("x", "nope" as "arrow")), "invalid_argument");
    expectModelError(() => run(store, (tx) => tx.createPage("x", null, "missing")), "not_found");
  });

  it("skips taken default names", () => {
    const { store } = setup();
    run(store, (tx) => tx.createPage("Page 2"));
    const id = run(store, (tx) => tx.createPage());
    expect(store.doc.pages[id].name).toBe("Page 3");
  });

  it("updates pages", () => {
    const { store, pageId } = setup();
    run(store, (tx) => tx.updatePage(pageId, { name: "  Home ", icon: "design" }));
    expect(store.doc.pages[pageId]).toMatchObject({ name: "Home", icon: "design" });
    run(store, (tx) => tx.updatePage(pageId, { icon: null }));
    expect(store.doc.pages[pageId].icon).toBeNull();
    expectModelError(() => run(store, (tx) => tx.updatePage(pageId, { name: " " })), "invalid_argument");
    expectModelError(() => run(store, (tx) => tx.updatePage("missing", { name: "x" })), "not_found");
  });

  it("arranges pages with new and removed dividers", () => {
    const { store, pageId: p1 } = setup();
    const p2 = run(store, (tx) => tx.createPage());
    const p3 = run(store, (tx) => tx.createPage());
    const list = run(store, (tx) => tx.arrangePages([p3, { type: "divider" }, p1, p2]));
    expect(list.map((i) => i.type)).toEqual(["page", "divider", "page", "page"]);
    const dividerId = list[1].id;
    expect(dividerId).toMatch(/^d-[0-9A-Z]+-0$/);
    expect(store.doc.pageList).toEqual(list);

    const again = run(store, (tx) => tx.arrangePages([p1, dividerId, p2, { type: "divider" }, p3]));
    expect(again.map((i) => i.id)).toEqual([p1, dividerId, p2, again[3].id, p3]);

    const removed = run(store, (tx) => tx.arrangePages([p1, p2, p3], [dividerId]));
    // the other divider was not mentioned: it is kept and goes to the end
    expect(removed.map((i) => i.id)).toEqual([p1, p2, p3, again[3].id]);
  });

  it("appends pages missing from the order", () => {
    const { store, pageId: p1 } = setup();
    const p2 = run(store, (tx) => tx.createPage());
    const p3 = run(store, (tx) => tx.createPage());
    const list = run(store, (tx) => tx.arrangePages([p3]));
    expect(list.map((i) => i.id)).toEqual([p3, p1, p2]);
  });

  it("validates arrange input", () => {
    const { store, pageId } = setup();
    expectModelError(() => run(store, (tx) => tx.arrangePages(["missing"])), "not_found");
    expectModelError(() => run(store, (tx) => tx.arrangePages([pageId, pageId])), "invalid_argument");
    expectModelError(() => run(store, (tx) => tx.arrangePages([pageId], ["d-missing"])), "not_found");
    expectModelError(() => run(store, (tx) => tx.arrangePages([pageId], [pageId])), "invalid_argument");
  });

  it("deletes pages with their nodes but never the last one", () => {
    const { store, pageId: p1, rootId } = setup();
    const p2 = run(store, (tx) => tx.createPage());
    const root2 = store.doc.pages[p2].rootId;
    run(store, (tx) => tx.insertTrees(root2, [{ children: [{ text: "x" }] }]));
    const count = Object.keys(store.doc.nodes).length;
    run(store, (tx) => tx.deletePage(p2));
    expect(store.doc.pages[p2]).toBeUndefined();
    expect(store.doc.nodes[root2]).toBeUndefined();
    expect(Object.keys(store.doc.nodes)).toHaveLength(count - 3);
    expect(store.doc.pageList).toEqual([{ type: "page", id: p1 }]);
    expect(store.doc.nodes[rootId]).toBeDefined();
    expectModelError(() => run(store, (tx) => tx.deletePage(p1)), "last_page");
    expectModelError(() => run(store, (tx) => tx.deletePage("missing")), "not_found");
  });
});

describe("tokens", () => {
  it("creates, updates and deletes by name or id", () => {
    const { store } = setup();
    const t = run(store, (tx) => tx.createToken({ type: "color", name: "color-primary", value: " #f00 ", description: "Brand" }));
    expect(t).toMatchObject({ type: "color", name: "--color-primary", value: "#f00", description: "Brand" });
    expect(t.id).toMatch(/^t-[0-9A-Z]+-0$/);
    expect(store.doc.tokens).toEqual([t]);

    const updated = run(store, (tx) => tx.updateToken("--color-primary", { value: "#0f0", description: undefined }));
    expect(updated).toEqual({ id: t.id, type: "color", name: "--color-primary", value: "#0f0" });
    const renamed = run(store, (tx) => tx.updateToken(t.id, { name: "--color-brand" }));
    expect(renamed.name).toBe("--color-brand");

    run(store, (tx) => tx.createToken({ type: "spacing", name: "--spacing-4", value: 16 }));
    run(store, (tx) => tx.deleteToken("color-brand"));
    expect(store.doc.tokens.map((x) => x.name)).toEqual(["--spacing-4"]);
  });

  it("keeps order", () => {
    const { store } = setup();
    run(store, (tx) => {
      tx.createToken({ type: "color", name: "--b", value: "red" });
      tx.createToken({ type: "color", name: "--a", value: "blue" });
    });
    expect(store.doc.tokens.map((t) => t.name)).toEqual(["--b", "--a"]);
  });

  it("validates tokens", () => {
    const { store } = setup();
    run(store, (tx) => tx.createToken({ type: "color", name: "--x", value: "red" }));
    expectModelError(() => run(store, (tx) => tx.createToken({ type: "color", name: "--x", value: "blue" })), "duplicate_name");
    expectModelError(() => run(store, (tx) => tx.createToken({ type: "colour" as "color", name: "--y", value: "blue" })), "invalid_argument");
    expectModelError(() => run(store, (tx) => tx.createToken({ type: "color", name: "--bad name", value: "blue" })), "invalid_argument");
    expectModelError(() => run(store, (tx) => tx.createToken({ type: "color", name: "--y", value: "  " })), "invalid_argument");
    expectModelError(() => run(store, (tx) => tx.createToken({ type: "color", name: "--y", value: "a", description: "x".repeat(1025) })), "invalid_argument");
    expectModelError(() => run(store, (tx) => tx.updateToken("--missing", { value: "a" })), "not_found");
    expectModelError(() => run(store, (tx) => tx.deleteToken("--missing")), "not_found");
    run(store, (tx) => tx.createToken({ type: "color", name: "--z", value: "red" }));
    expectModelError(() => run(store, (tx) => tx.updateToken("--z", { name: "--x" })), "duplicate_name");
  });

  it("allows aliases and rejects alias cycles", () => {
    const { store } = setup();
    run(store, (tx) => {
      tx.createToken({ type: "color", name: "--a", value: "red" });
      tx.createToken({ type: "color", name: "--b", value: "var(--a)" });
      tx.createToken({ type: "color", name: "--c", value: "var(--b)" });
    });
    expectModelError(() => run(store, (tx) => tx.updateToken("--a", { value: "var(--c)" })), "alias_cycle");
    expectModelError(() => run(store, (tx) => tx.createToken({ type: "color", name: "--self", value: "var(--self)" })), "alias_cycle");
    expectModelError(
      () => run(store, (tx) => tx.updateToken("--a", { value: "color-mix(in oklch, var(--c) 50%, white)" })),
      "alias_cycle",
    );
    expect(store.doc.tokens.find((t) => t.name === "--a")?.value).toBe("red");
  });
});

describe("document", () => {
  it("renames and registers assets", () => {
    const { store } = setup();
    run(store, (tx) => {
      tx.setDocName(" New name ");
      tx.addAsset({ hash: "abc", mime: "image/png", size: 10, width: 2, height: 3 });
    });
    expect(store.doc.name).toBe("New name");
    expect(store.doc.assets.abc).toEqual({ hash: "abc", mime: "image/png", size: 10, width: 2, height: 3 });
    expectModelError(() => run(store, (tx) => tx.setDocName("")), "invalid_argument");
    expectModelError(() => run(store, (tx) => tx.addAsset({ hash: "", mime: "x", size: 0 })), "invalid_argument");
  });
});
