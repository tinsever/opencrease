import { describe, expect, it } from "vitest";
import { htmlToTrees } from "./html-to-trees";

const texts = (trees: ReturnType<typeof htmlToTrees>["trees"]) => trees.map((t) => t.text);

describe("htmlToTrees", () => {
  it("turns a div with only text into one Text node", () => {
    const { trees } = htmlToTrees(`<div style="font-size:16px">Hello</div>`);
    expect(trees).toHaveLength(1);
    expect(trees[0]).toMatchObject({ type: "Text", text: "Hello", styles: { fontSize: "16px" } });
  });

  it("keeps spans in a flex container as separate items", () => {
    const { trees } = htmlToTrees(
      `<div style="display:flex;gap:28px"><span>Product</span><span>Pricing</span><span style="color:red">Blog</span></div>`,
    );
    expect(trees).toHaveLength(1);
    const nav = trees[0]!;
    expect(nav).toMatchObject({ type: "Frame", styles: { display: "flex", gap: "28px" } });
    expect(texts(nav.children!)).toEqual(["Product", "Pricing", "Blog"]);
    expect(nav.children![2]!.styles?.color).toBe("red");
  });

  it("splits loose text and elements in a flex container", () => {
    const { trees } = htmlToTrees(`<div style="display:flex;gap:8px">Due <b>Sep 22</b></div>`);
    expect(texts(trees[0]!.children!)).toEqual(["Due", "Sep 22"]);
  });

  it("keeps inline formatting outside flex as rich text spans", () => {
    const { trees, warnings } = htmlToTrees(`<p>Hello <b>world</b></p>`);
    expect(trees[0]).toMatchObject({ type: "Text", text: "Hello world" });
    expect(trees[0]!.spans).toEqual([{ text: "Hello " }, { text: "world", styles: { fontWeight: 700 } }]);
    expect(warnings).toEqual([]);
  });

  it("nests span styles, collapses whitespace across runs and keeps line breaks", () => {
    const { trees } = htmlToTrees(
      `<div style="font-size:18px">  Pay <span style="color:var(--color-accent)"> only <em>for what</em> </span>  you use<br>  today </div>`,
    );
    const t = trees[0]!;
    expect(t.text).toBe("Pay only for what you use\ntoday");
    expect(t.styles).toEqual({ fontSize: "18px" });
    expect(t.spans).toEqual([
      { text: "Pay " },
      { text: "only ", styles: { color: "var(--color-accent)" } },
      { text: "for what", styles: { color: "var(--color-accent)", fontStyle: "italic" } },
      { text: " ", styles: { color: "var(--color-accent)" } },
      { text: "you use\ntoday" },
    ]);
  });

  it("keeps only text styles on inline runs and leaves plain text alone", () => {
    const { trees, warnings } = htmlToTrees(`<p>A <span style="padding:4px;color:red">B</span></p><p>Just text</p>`);
    expect(trees[0]!.spans).toEqual([{ text: "A " }, { text: "B", styles: { color: "red" } }]);
    expect(warnings.join(" ")).toMatch(/ignored: padding/);
    expect(trees[1]).toEqual({ type: "Text", text: "Just text" });
  });

  it("reads data-mode onto frames, wrapping text when needed", () => {
    const { trees } = htmlToTrees(`<div data-mode="dark" style="display:flex"><div>A</div><div>B</div></div><div data-mode="dark">Solo</div>`);
    expect(trees[0]).toMatchObject({ type: "Frame", mode: "dark" });
    expect(trees[1]).toMatchObject({ type: "Frame", mode: "dark", children: [{ type: "Text", text: "Solo" }] });
  });

  it("merges the styles of a single wrapping span", () => {
    const { trees } = htmlToTrees(`<div style="display:flex"><span style="font-weight:600">Only</span></div>`);
    expect(trees[0]).toMatchObject({ type: "Text", text: "Only" });
  });

  it("restores camelCase SVG tag names the HTML parser lowercases", () => {
    const { trees } = htmlToTrees(
      `<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient><clipPath id="c"><rect width="5" height="5"/></clipPath></defs><rect fill="url(#g)" width="10" height="10"/></svg>`,
    );
    const defs = trees[0]!.children![0]!;
    expect(defs.children!.map((c) => c.tag)).toEqual(["linearGradient", "clipPath"]);
    expect(trees[0]!.attrs?.viewBox).toBe("0 0 10 10");
  });

  it("uses layer-name for names", () => {
    const { trees } = htmlToTrees(`<div layer-name="Nav" style="display:flex;padding:8px"><div>A</div><div>B</div></div>`);
    expect(trees[0]).toMatchObject({ name: "Nav", type: "Frame" });
    expect(texts(trees[0]!.children!)).toEqual(["A", "B"]);
  });
});
