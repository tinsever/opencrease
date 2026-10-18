import { expect, it } from "vitest";
import fc from "fast-check";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "esbuild";
import { createDocument, DocStore, type FoldDocument, type NodeTree } from "@opencrease/model";
import { nodeToHtml, nodeToJsx, stylesToCss } from "@opencrease/css";
import { writeTools } from "./write";
import { testEnv } from "./test-env";

const dimension = fc.integer({ min: 1, max: 800 }).map((n) => `${n}px`);
const text = fc.array(fc.constantFrom("a", "ß", "ä", "中", "&", "<", ">", "{", "}", '"', "\n"), { minLength: 1, maxLength: 30 }).map((a) => `Text ${a.join("")}`);
const leaf: fc.Arbitrary<NodeTree> = fc.oneof(
  fc.record({ type: fc.constant("Text" as const), text, styles: fc.record({ fontSize: dimension, color: fc.constantFrom("#123456", "var(--ink)"), whiteSpace: fc.constant("pre-wrap") }) }),
  fc.record({ type: fc.constant("Rectangle" as const), styles: fc.record({ width: dimension, height: dimension, backgroundColor: fc.constant("#ef9145"), borderRadius: dimension }) }),
  fc.record({ type: fc.constant("Image" as const), src: fc.constant("https://images.unsplash.com/image.png?x=1&y=2"), styles: fc.record({ width: dimension, height: dimension, objectFit: fc.constant("cover") }) }),
);
function tree(depth: number): fc.Arbitrary<NodeTree> {
  if (!depth) return leaf;
  return fc.oneof(leaf, fc.record({ type: fc.constant("Frame" as const), styles: fc.record({ display: fc.constant("flex"), flexDirection: fc.constantFrom("row", "column"), gap: dimension, padding: dimension }), children: fc.array(tree(depth - 1), { minLength: 1, maxLength: 4 }) }));
}
function canonical(doc: FoldDocument, id: string): unknown {
  const n = doc.nodes[id]!;
  return { type: n.type, styles: stylesToCss(n.styles).split(";").map((s) => s.trim()).filter(Boolean).sort(), text: n.text, src: n.src, children: n.children.map((child) => canonical(doc, child)) };
}

for (const format of ["HTML", "JSX"] as const) {
  it(`${format} preserves generated trees through write_html (150 cases)`, async () => {
    await fc.assert(fc.asyncProperty(tree(3), async (input) => {
      const store = new DocStore(createDocument("Round trip", { clientId: "rt", now: 0 }));
      const root = Object.values(store.doc.pages)[0]!.rootId;
      // Use a container so write_html does not add artboard positioning to the test subtree.
      const [container] = store.transact("Fixture", (tx) => tx.insertTrees(root, [{ type: "Frame", styles: { display: "flex" }, children: [input] }]));
      const original = store.doc.nodes[container!]!.children[0]!;
      let html = nodeToHtml(store.doc, original);
      if (format === "JSX") {
        const jsx = nodeToJsx(store.doc, original, { format: "inline-styles", includeRootPositioning: true });
        const { code: compiled } = await transform(`const element = (${jsx});`, { loader: "jsx", jsx: "transform", target: "es2022" });
        // Only execute our generated JSX, never user input.
        const element = new Function("React", `${compiled}; return element;`)(React);
        html = renderToStaticMarkup(element);
      }
      await writeTools.write_html!.run({ targetNodeId: container, mode: "insert-children", html }, testEnv(store));
      const copy = store.doc.nodes[container!]!.children[1]!;
      expect(canonical(store.doc, copy)).toEqual(canonical(store.doc, original));
    }), { numRuns: 150, seed: 62026 });
  }, 30_000);
}
