import { describe, expect, it } from "vitest";
import { createDocument, DocStore } from "@opencrease/model";
import { htmlToTrees } from "./html-to-trees";
import { nodeToHtml } from "./html";
import { nodeToJsx, shaderComponentsIn } from "./jsx";
import { mapColorsInValue } from "./color";

describe("paint export", () => {
  const fixture = () => {
    const store = new DocStore(createDocument("Paint"));
    const root = store.doc.pages[store.doc.pageList[0].id].rootId;
    let id = "";
    store.transact("Paint", (tx) => {
      [id] = tx.insertTrees(root, [{ type: "Frame", styles: { width: 200, height: 100, backgroundColor: "white" }, paint: {
        shader: { name: "MeshGradient", params: { colors: ["red", "blue"], speed: 0 } },
        hiddenFills: [{ index: 0, css: "linear-gradient(red, blue)", size: "cover" }],
      }, children: [{ type: "Text", text: "Above the shader" }] }]);
    });
    return { store, id };
  };
  it("round trips paint metadata as HTML without turning the fill into a child node", () => {
    const { store, id } = fixture();
    const html = nodeToHtml(store.doc, id);
    const parsed = htmlToTrees(html);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.trees[0].paint).toEqual(store.doc.nodes[id].paint);
    expect(parsed.trees[0].children).toHaveLength(1);
    expect(parsed.trees[0].children?.[0].text).toBe("Above the shader");
  });
  it("exports shader fills beneath content in an isolated stacking context", () => {
    const { store, id } = fixture();
    for (const format of ["inline-styles", "tailwind"] as const) {
      const code = nodeToJsx(store.doc, id, { format });
      expect(code).toContain("<MeshGradient");
      expect(code).toContain('isolation: "isolate"');
      expect(code).toContain("zIndex: -1");
      expect(code.indexOf("<MeshGradient")).toBeLessThan(code.indexOf("Above the shader"));
    }
    expect(shaderComponentsIn(store.doc, id)).toEqual(["MeshGradient"]);
    store.transact("Hide", (tx) => tx.updateNode(id, { paint: { ...tx.doc.nodes[id].paint, shaderHidden: true } }));
    expect(shaderComponentsIn(store.doc, id)).toEqual([]);
    expect(nodeToJsx(store.doc, id, { format: "inline-styles" })).not.toContain("<MeshGradient");
  });
  it("rewrites nested colours and token fallbacks without touching URLs", () => {
    const css = 'url("red.png"), linear-gradient(var(--a, red), color-mix(in srgb, red 20%, blue))';
    expect(mapColorsInValue(css, (c) => c === "red" ? "green" : undefined)).toBe('url("red.png"), linear-gradient(var(--a, green), color-mix(in srgb, green 20%, blue))');
    expect(mapColorsInValue("var(--a, red)", (c) => c === "var(--a)" ? "#abc" : undefined)).toBe("#abc");
  });
});
