import { describe, expect, it } from "vitest";
import type { NodeTree, Token } from "@opencrease/model";
import { colorTokenName, colorTokensForTrees } from "./color-tokens";

describe("colorTokenName", () => {
  it("names neutrals, hues and alpha", () => {
    expect(colorTokenName("#FFFFFF")).toBe("--color-white");
    expect(colorTokenName("#000000")).toBe("--color-black");
    expect(colorTokenName("#767673")).toMatch(/^--color-gray-\d+$/);
    expect(colorTokenName("#2F64D6")).toMatch(/^--color-blue-\d+$/);
    expect(colorTokenName("#FF5B14")).toMatch(/^--color-(orange|red)-\d+$/);
    expect(colorTokenName("rgba(0,0,0,0.1)")).toBe("--color-black-a10");
  });
});

describe("colorTokensForTrees", () => {
  const trees: NodeTree[] = [
    {
      type: "Frame",
      styles: { backgroundColor: "#FFFFFF", border: "1px solid #E6E6E3" },
      children: [
        { type: "Text", text: "A", styles: { color: "#141414" } },
        { type: "Text", text: "B", styles: { color: "#141414", backgroundColor: "#ffffff" } },
        { type: "Frame", styles: { borderTop: "1px solid #E6E6E3", backgroundImage: "linear-gradient(#141414, #fff)" } },
        { type: "Text", text: "once", styles: { color: "#FF0000" } },
      ],
    },
  ];

  it("creates tokens for repeated colours and rewrites styles", () => {
    const { trees: out, tokens } = colorTokensForTrees(trees, []);
    expect(tokens.map((t) => t.value).sort()).toEqual(["#141414", "#E6E6E3", "#FFFFFF"]);
    const white = tokens.find((t) => t.value === "#FFFFFF")!.name;
    expect(out[0].styles?.backgroundColor).toBe(`var(${white})`);
    expect(out[0].styles?.border).toMatch(/^1px solid var\(--color-gray-\d+\)$/);
    expect(out[0].children![1].styles?.backgroundColor).toBe(`var(${white})`);
    // single-use colours and gradients stay literal
    expect(out[0].children![3].styles?.color).toBe("#FF0000");
    expect(out[0].children![2].styles?.backgroundImage).toBe("linear-gradient(#141414, #fff)");
    // input untouched
    expect(trees[0].styles?.backgroundColor).toBe("#FFFFFF");
  });

  it("reuses existing tokens with the same value and avoids name clashes", () => {
    const existing: Token[] = [
      { id: "t1", type: "color", name: "--color-ink", value: "#141414" },
      { id: "t2", type: "color", name: "--color-white", value: "#FAFAFA" },
    ];
    const { trees: out, tokens } = colorTokensForTrees(trees, existing);
    expect(out[0].children![0].styles?.color).toBe("var(--color-ink)");
    expect(tokens.some((t) => t.value === "#141414")).toBe(false);
    expect(tokens.find((t) => t.value === "#FFFFFF")?.name).toBe("--color-white-2");
  });
});
