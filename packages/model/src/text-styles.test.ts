import { describe, expect, it } from "vitest";
import { createDocument } from "./document";
import { parseFold, serializeFold } from "./format";
import { DocStore } from "./store";
import { textStyleSlug } from "./tokens";

function setup() {
  const store = new DocStore(createDocument("T"));
  const rootId = store.doc.pages[store.doc.pageList[0].id].rootId;
  const [a, b] = store.transact("t", (tx) => tx.insertTrees(rootId, [{ text: "A", styles: { color: "red" } }, { text: "B" }]));
  return { store, a, b };
}

describe("text styles", () => {
  it("slugs names into class names", () => {
    expect(textStyleSlug("Heading 1")).toBe("type-heading-1");
    expect(textStyleSlug("  Überschrift / Groß ")).toBe("type-uberschrift-gro");
    expect(textStyleSlug("!!!")).toBe("");
  });

  it("applies values in one step and links the node", () => {
    const { store, a } = setup();
    const style = store.transact("t", (tx) => tx.createTextStyle({ name: "Heading", styles: { fontSize: "var(--text-xl)", fontWeight: 700, lineHeight: "32px" } }));
    store.transact("t", (tx) => tx.applyTextStyle(a, style.id));
    expect(store.doc.nodes[a].textStyle).toBe(style.id);
    expect(store.doc.nodes[a].styles).toEqual({ color: "red", fontSize: "var(--text-xl)", fontWeight: 700, lineHeight: "32px" });
  });

  it("propagates edits to linked nodes except overridden properties", () => {
    const { store, a, b } = setup();
    const style = store.transact("t", (tx) => tx.createTextStyle({ name: "Body", styles: { fontSize: 16, lineHeight: 1.5 } }));
    store.transact("t", (tx) => {
      tx.applyTextStyle(a, style.id);
      tx.applyTextStyle(b, style.id);
      tx.setStyles(b, { fontSize: 18 }); // local override
    });
    store.transact("t", (tx) => tx.updateTextStyle(style.id, { styles: { fontSize: 15, letterSpacing: "0.01em" } }));
    expect(store.doc.nodes[a].styles).toEqual({ color: "red", fontSize: 15, letterSpacing: "0.01em" });
    expect(store.doc.nodes[b].styles).toEqual({ fontSize: 18, letterSpacing: "0.01em" });
  });

  it("switching styles removes values only the old style set", () => {
    const { store, a } = setup();
    const [h, p] = store.transact("t", (tx) => [
      tx.createTextStyle({ name: "H", styles: { fontSize: 32, textTransform: "uppercase" } }),
      tx.createTextStyle({ name: "P", styles: { fontSize: 16 } }),
    ]);
    store.transact("t", (tx) => tx.applyTextStyle(a, h.id));
    store.transact("t", (tx) => tx.applyTextStyle(a, p.id));
    expect(store.doc.nodes[a].styles).toEqual({ color: "red", fontSize: 16 });
  });

  it("rejects duplicate names, unlinks on delete and survives a save", () => {
    const { store, a } = setup();
    const s = store.transact("t", (tx) => tx.createTextStyle({ name: "Caption", styles: { fontSize: 12 } }));
    expect(() => store.transact("t", (tx) => tx.createTextStyle({ name: "caption", styles: {} }))).toThrow(/already exists/);
    store.transact("t", (tx) => tx.applyTextStyle(a, s.id));
    const loaded = parseFold(serializeFold(store.doc).documentJson);
    expect(loaded.textStyles).toEqual(store.doc.textStyles);
    expect(loaded.nodes[a].textStyle).toBe(s.id);
    store.transact("t", (tx) => tx.deleteTextStyle(s.id));
    expect(store.doc.nodes[a].textStyle).toBeUndefined();
    expect(store.doc.nodes[a].styles.fontSize).toBe(12);
    expect(store.doc.textStyles).toBeUndefined();
  });
});
