import { describe, expect, it } from "vitest";
import { createDocument, DocStore } from "./index";
import { diffDocuments } from "./diff";

describe("version diff", () => {
  it("ignores save metadata and reports text, styles, moves, removed trees, tokens and pages", () => {
    const store = new DocStore(createDocument("Before"));
    const root = Object.values(store.doc.pages)[0].rootId;
    const [a, b] = store.transact("Trees", (tx) => tx.insertTrees(root, [{ type: "Frame", name: "A", children: [{ type: "Text", text: "Old" }] }, { type: "Frame", name: "B", children: [{ type: "Rectangle", styles: { width: 10 } }] }]));
    const before = structuredClone(store.doc);
    expect(diffDocuments(before, { ...before, updatedAt: 123, clock: 999 }).empty).toBe(true);
    const child = before.nodes[a].children[0];
    store.transact("Edit", (tx) => {
      tx.updateNode(child, { text: "New" }); tx.setStyles(child, { color: "red" }); tx.deleteNode(b);
      const page = tx.createPage("Mobile");
      tx.insertTrees(tx.doc.pages[page].rootId, [{ type: "Text", name: "New page text", text: "Mobile" }]);
      tx.createToken({ type: "color", name: "--color-ink", value: "red" });
    });
    const diff = diffDocuments(before, store.doc);
    expect(diff.empty).toBe(false);
    expect(diff.changed.find((n) => n.id === child)).toMatchObject({ text: { from: "Old", to: "New" }, styles: { color: { to: "red" } } });
    expect(diff.removed).toEqual([expect.objectContaining({ id: b, descendants: 1 })]);
    expect(diff.removedIds).toEqual(expect.arrayContaining([b, ...before.nodes[b].children]));
    expect(diff.tokens.added[0].name).toBe("--color-ink");
    expect(diff.pages.added[0].name).toBe("Mobile");
    expect(diff.touchedIds).toContain(child);
    expect(diff.added.some((n) => n.name === "New page text")).toBe(true);
    expect(diffDocuments(before, { ...before, library: { version: 1, publishedAt: 1 } }).metadata?.library.to).toEqual({ version: 1, publishedAt: 1 });
  });
});
