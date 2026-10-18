import { describe, expect, it } from "vitest";
import { createDocument, DocStore } from "@opencrease/model";
import { htmlToTrees } from "./html-to-trees";
import { nodeToHtml } from "./html";
import { stylesToTailwind } from "./tailwind";

const GRID = `<div layer-name="Cards" style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: 120px auto; column-gap: 16px; row-gap: 24px">
  <span>One</span>
  <span style="grid-column: span 2 / span 2">Two</span>
  <div style="grid-row: 2; grid-column: 1 / -1; background-color: #eee"></div>
</div>`;

describe("CSS grid", () => {
  it("is imported from HTML as a grid, with every child as its own item", () => {
    const { trees, warnings } = htmlToTrees(GRID);
    expect(warnings).toEqual([]);
    expect(trees).toHaveLength(1);
    const grid = trees[0];
    expect(grid.type).toBe("Frame");
    expect(grid.styles).toMatchObject({
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gridTemplateRows: "120px auto",
      columnGap: "16px",
      rowGap: "24px",
    });
    expect(grid.children?.map((c) => c.type)).toEqual(["Text", "Text", "Rectangle"]);
    expect(grid.children?.[1].styles?.gridColumn).toBe("span 2 / span 2");
    expect(grid.children?.[2].styles).toMatchObject({ gridRow: "2", gridColumn: "1 / -1" });
  });

  it("round trips through nodeToHtml", () => {
    const store = new DocStore(createDocument("G"));
    const rootId = store.doc.pages[store.doc.pageList[0].id].rootId;
    const [id] = store.transact("i", (tx) => tx.insertTrees(rootId, htmlToTrees(GRID).trees));
    const again = htmlToTrees(nodeToHtml(store.doc, id)).trees[0];
    expect(again.styles).toEqual(store.doc.nodes[id].styles);
    expect(again.children?.map((c) => c.styles ?? {})).toEqual(store.doc.nodes[id].children.map((c) => store.doc.nodes[c].styles));
  });

  it("maps to Tailwind grid utilities", () => {
    const t = (styles: Record<string, string | number>) => stylesToTailwind(styles, []).classes;
    expect(t({ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))" })).toEqual(["grid", "grid-cols-4"]);
    expect(t({ gridTemplateColumns: "200px 1fr" })).toEqual(["grid-cols-[200px_1fr]"]);
    expect(t({ gridColumn: "span 2 / span 2", gridRow: "1 / -1" })).toEqual(["col-span-2", "row-span-full"]);
    expect(t({ gridColumn: "2 / 4" })).toEqual(["col-[2_/_4]"]);
  });
});
