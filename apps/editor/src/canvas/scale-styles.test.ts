import { describe, expect, it } from "vitest";
import { createDocument, DocStore } from "@opencrease/model";
import { scaleCssLengths, scaleStyles, scaleSubtree } from "./scale-styles";

describe("scale tool", () => {
  it("scales lengths in values and leaves other units alone", () => {
    expect(scaleCssLengths("0 4px 12px -2px rgb(0 0 0 / 0.2)", 2)).toBe("0 8px 24px -4px rgb(0 0 0 / 0.2)");
    expect(scaleStyles({
      fontSize: 16, lineHeight: "24px", letterSpacing: "-0.02em", padding: "8px 12px", gap: 10, borderRadius: 6,
      border: "1px solid #000", opacity: 0.5, fontWeight: 600, width: "50%", filter: "blur(4px)", color: "var(--ink)", flexGrow: 1,
    }, 1.5)).toEqual({
      fontSize: 24, lineHeight: "36px", padding: "12px 18px", gap: 15, borderRadius: 9, border: "1.5px solid #000", filter: "blur(6px)",
    });
    expect(scaleStyles({ lineHeight: 1.4, width: 100 }, 2, ["width"])).toEqual({});
  });

  it("scales a whole subtree but not the layer's own box", () => {
    const store = new DocStore(createDocument("S"));
    const rootId = store.doc.pages[store.doc.pageList[0].id].rootId;
    const [id] = store.transact("i", (tx) =>
      tx.insertTrees(rootId, [{ type: "Frame", styles: { left: 100, top: 50, width: 200, height: 100, padding: 10 }, children: [{ type: "Text", text: "Hi", styles: { fontSize: 14, position: "absolute", left: 5 } }] }]),
    );
    const child = store.doc.nodes[id].children[0];
    expect(scaleSubtree(store.doc, id, 2)).toEqual([
      { id, styles: { padding: 20 } },
      { id: child, styles: { fontSize: 28, left: 10 } },
    ]);
  });
});
