import { describe, expect, it } from "vitest";
import { createDocument } from "./document";
import { parseFold, serializeFold } from "./format";
import { normalizeSpans, rangeValue, replaceRange, styleRange, stylesInRange } from "./spans";
import { DocStore } from "./store";

describe("spans", () => {
  it("normalises: merges equal neighbours, drops empty runs, plain text has no spans", () => {
    expect(normalizeSpans([{ text: "a" }, { text: "" }, { text: "b" }])).toBeUndefined();
    expect(normalizeSpans([{ text: "a", styles: { fontWeight: 700 } }, { text: "b", styles: { fontWeight: 700 } }, { text: "c" }])).toEqual([
      { text: "ab", styles: { fontWeight: 700 } },
      { text: "c" },
    ]);
    expect(normalizeSpans([{ text: "a", styles: { color: "" } }])).toBeUndefined();
  });

  it("styles a range by splitting runs, and unstyles back to plain text", () => {
    const bold = styleRange("Hello world", undefined, 6, 11, { fontWeight: 700 });
    expect(bold).toEqual([{ text: "Hello " }, { text: "world", styles: { fontWeight: 700 } }]);
    const red = styleRange("Hello world", bold, 4, 8, { color: "red" });
    expect(red).toEqual([
      { text: "Hell" },
      { text: "o ", styles: { color: "red" } },
      { text: "wo", styles: { fontWeight: 700, color: "red" } },
      { text: "rld", styles: { fontWeight: 700 } },
    ]);
    const back = styleRange("Hello world", styleRange("Hello world", red, 0, 11, { color: null }), 0, 11, { fontWeight: null });
    expect(back).toBeUndefined();
  });

  it("replaces text: typing takes the style before the caret, replacing keeps the selection's style", () => {
    const spans = styleRange("Hello world", undefined, 6, 11, { fontWeight: 700 });
    expect(replaceRange("Hello world", spans, 11, 11, "!")).toEqual({ text: "Hello world!", spans: [{ text: "Hello " }, { text: "world!", styles: { fontWeight: 700 } }] });
    expect(replaceRange("Hello world", spans, 6, 11, "there")).toEqual({ text: "Hello there", spans: [{ text: "Hello " }, { text: "there", styles: { fontWeight: 700 } }] });
    expect(replaceRange("Hello world", spans, 5, 6, "\n")).toEqual({ text: "Hello\nworld", spans: [{ text: "Hello\n" }, { text: "world", styles: { fontWeight: 700 } }] });
    expect(replaceRange("Hello world", spans, 0, 11, "")).toEqual({ text: "", spans: undefined });
    expect(replaceRange("ab", undefined, 1, 1, "x")).toEqual({ text: "axb", spans: undefined });
  });

  it("reads the common value over a range", () => {
    const spans = styleRange("Hello world", undefined, 6, 11, { fontWeight: 700 });
    expect(rangeValue(stylesInRange("Hello world", spans, 6, 11), "fontWeight")).toBe(700);
    expect(rangeValue(stylesInRange("Hello world", spans, 3, 8), "fontWeight")).toBe("mixed");
    expect(rangeValue(stylesInRange("Hello world", spans, 0, 3), "fontWeight")).toBeUndefined();
    // a caret reads the run before it
    expect(rangeValue(stylesInRange("Hello world", spans, 8, 8), "fontWeight")).toBe(700);
  });
});

describe("spans on Text nodes", () => {
  function setup() {
    const store = new DocStore(createDocument("T"));
    const rootId = store.doc.pages[store.doc.pageList[0].id].rootId;
    return { store, rootId };
  }

  it("inserts trees with spans and keeps text in sync", () => {
    const { store, rootId } = setup();
    const [id] = store.transact("t", (tx) => tx.insertTrees(rootId, [{ spans: [{ text: "Bold", styles: { fontWeight: 700 } }, { text: " plain" }] }]));
    const node = store.doc.nodes[id];
    expect(node.type).toBe("Text");
    expect(node.text).toBe("Bold plain");
    expect(node.spans).toHaveLength(2);
  });

  it("drops spans when the text changes, keeps them when it does not", () => {
    const { store, rootId } = setup();
    const [id] = store.transact("t", (tx) => tx.insertTrees(rootId, [{ text: "ab", spans: [{ text: "a", styles: { color: "red" } }, { text: "b" }] }]));
    store.transact("t", (tx) => tx.updateNode(id, { text: "ab" }));
    expect(store.doc.nodes[id].spans).toHaveLength(2);
    store.transact("t", (tx) => tx.updateNode(id, { text: "changed" }));
    expect(store.doc.nodes[id].spans).toBeUndefined();
    store.transact("t", (tx) => tx.updateNode(id, { spans: [{ text: "x", styles: { fontStyle: "italic" } }, { text: "y" }] }));
    expect(store.doc.nodes[id].text).toBe("xy");
    expect(() => store.transact("t", (tx) => tx.updateNode(id, { text: "zz", spans: [{ text: "xy" }] }))).toThrow(/spell out/);
  });

  it("survives save and load; spans that do not match the text are dropped", () => {
    const { store, rootId } = setup();
    const [id] = store.transact("t", (tx) => tx.insertTrees(rootId, [{ spans: [{ text: "a", styles: { color: "red" } }, { text: "b" }] }]));
    const json = serializeFold(store.doc).documentJson;
    expect(parseFold(json).nodes[id].spans).toEqual(store.doc.nodes[id].spans);
    const broken = JSON.parse(json);
    broken.nodes[id].text = "other";
    expect(parseFold(JSON.stringify(broken)).nodes[id].spans).toBeUndefined();
  });
});
