import { describe, expect, it } from "vitest";
import { createDocument, DocStore, type NodeTree } from "@opencrease/model";
import { nodeToHtml } from "./html";
import { htmlToTrees } from "./html-to-trees";
import { nodeToJsx } from "./jsx";
import { textStylesToCss, textStylesToTailwind } from "./text-styles";

function docWith(trees: NodeTree[], setup?: (store: DocStore) => void) {
  const store = new DocStore(createDocument("T"));
  setup?.(store);
  const rootId = store.doc.pages[store.doc.pageList[0].id].rootId;
  const ids = store.transact("t", (tx) => tx.insertTrees(rootId, trees));
  return { store, ids };
}

const rich: NodeTree = {
  type: "Text",
  name: "Lede",
  styles: { fontSize: 18 },
  spans: [{ text: "Ship " }, { text: "faster", styles: { fontWeight: 700, color: "var(--color-accent)" } }, { text: " & <safer>\nnow" }],
};

describe("rich text export", () => {
  it("serialises spans to nested spans in HTML", () => {
    const { store, ids } = docWith([rich]);
    expect(nodeToHtml(store.doc, ids[0])).toBe(
      '<div layer-name="Lede" style="font-size: 18px">Ship <span style="font-weight: 700; color: var(--color-accent)">faster</span> &amp; &lt;safer&gt;<br>now</div>',
    );
  });

  it("serialises spans to JSX with inline styles or Tailwind classes", () => {
    const { store, ids } = docWith([rich], (s) => s.transact("t", (tx) => tx.createToken({ type: "color", name: "--color-accent", value: "#f60" })));
    expect(nodeToJsx(store.doc, ids[0], { format: "inline-styles" })).toBe(
      '<div style={{ fontSize: 18 }}>Ship <span style={{ fontWeight: 700, color: "var(--color-accent)" }}>faster</span> &amp; &lt;safer&gt;<br />now</div>',
    );
    expect(nodeToJsx(store.doc, ids[0], { format: "tailwind" })).toContain('<span className="font-bold text-accent">faster</span>');
  });

  it("round-trips spans through HTML", () => {
    const { store, ids } = docWith([rich]);
    const html = nodeToHtml(store.doc, ids[0]);
    const { trees, warnings } = htmlToTrees(html);
    expect(warnings).toEqual([]);
    const again = docWith(trees);
    const a = store.doc.nodes[ids[0]];
    const b = again.store.doc.nodes[again.ids[0]];
    expect(b.text).toBe(a.text);
    expect(b.spans).toEqual(a.spans);
    expect(b.styles).toEqual({ fontSize: "18px" });
  });
});

describe("modes and text styles in code", () => {
  it("writes data-mode on frames and reads it back", () => {
    const { store, ids } = docWith([{ type: "Frame", mode: "dark", children: [{ text: "Hi" }] }], (s) =>
      s.transact("t", (tx) => tx.createModeCollection("Theme", ["light", "dark"])),
    );
    expect(nodeToJsx(store.doc, ids[0], { format: "inline-styles" })).toContain('<div data-mode="dark">');
    const html = nodeToHtml(store.doc, ids[0]);
    expect(html).toContain('data-mode="dark"');
    expect(htmlToTrees(html).trees[0]).toMatchObject({ type: "Frame", mode: "dark" });
  });

  it("exports linked text styles as a utility class plus overrides", () => {
    const { store, ids } = docWith([{ text: "Title" }], (s) =>
      s.transact("t", (tx) => {
        tx.createToken({ type: "fontSize", name: "--text-2xl", value: 32 });
        tx.createTextStyle({ name: "Heading 1", styles: { fontSize: "var(--text-2xl)", fontWeight: 700, lineHeight: "36px" }, description: "Page titles" });
      }),
    );
    const styleId = store.doc.textStyles![0].id;
    store.transact("t", (tx) => {
      tx.applyTextStyle(ids[0], styleId);
      tx.setStyles(ids[0], { color: "red" });
    });
    expect(nodeToJsx(store.doc, ids[0], { format: "tailwind" })).toBe('<div className="type-heading-1 text-[color:red]">Title</div>');
    expect(textStylesToTailwind(store.doc)).toBe(
      "/* Heading 1: Page titles */\n@utility type-heading-1 {\n  font-size: var(--text-2xl);\n  font-weight: 700;\n  line-height: 36px;\n}\n",
    );
    expect(textStylesToCss(store.doc)).toContain(".type-heading-1 {\n  font-size: var(--text-2xl);");
  });
});
