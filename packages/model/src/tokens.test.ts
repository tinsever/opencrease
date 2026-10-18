import { describe, expect, it } from "vitest";
import { createDocument } from "./document";
import {
  findAliasCycle, parseAlias, tailwindTokenName, tokenCssVars, tokensContentHash, tokensToCss, tokensToTailwind,
  tokenValueToCss,
} from "./tokens";
import type { Token, TokenType } from "./types";

let n = 0;
const tok = (type: TokenType, name: string, value: string | number): Token => ({ id: `t${++n}`, type, name, value });

describe("aliases", () => {
  it("parses whole-value var() aliases", () => {
    expect(parseAlias("var(--a)")).toEqual({ name: "--a" });
    expect(parseAlias(" var( --a , 4px ) ")).toEqual({ name: "--a", fallback: "4px" });
    expect(parseAlias("calc(var(--a) * 2)")).toBeUndefined();
    expect(parseAlias(4)).toBeUndefined();
  });

  it("finds cycles through any var() reference", () => {
    expect(findAliasCycle([tok("color", "--a", "var(--b)"), tok("color", "--b", "red")])).toEqual([]);
    expect(findAliasCycle([tok("color", "--a", "var(--b)"), tok("color", "--b", "color-mix(in srgb, var(--a), red)")])).toEqual(["--a", "--b"]);
  });
});

describe("css output", () => {
  const tokens = [
    tok("color", "--color-primary", "#ff0000"),
    tok("color", "--brand", "var(--color-primary)"),
    tok("spacing", "--space-4", 16),
    tok("radius", "--radius-lg", "12px"),
    tok("fontFamily", "--font-sans", "Inter, sans-serif"),
    tok("fontWeight", "--bold", 700),
    tok("fontSize", "--font-size-xl", 20),
    tok("lineHeight", "--tight", 1.2),
    tok("letterSpacing", "--tracking-wide", "0.02em"),
    tok("opacity", "--muted", 0.5),
    tok("container", "--container-md", 768),
    tok("breakpoint", "--md", 768),
  ];

  it("converts numbers to px only for length types", () => {
    expect(tokenValueToCss({ type: "spacing", value: 8 })).toBe("8px");
    expect(tokenValueToCss({ type: "fontWeight", value: 600 })).toBe("600");
    expect(tokenValueToCss({ type: "lineHeight", value: 1.5 })).toBe("1.5");
    expect(tokenValueToCss({ type: "color", value: "red" })).toBe("red");
  });

  it("tokensToCss", () => {
    expect(tokensToCss(tokens.slice(0, 3))).toBe(":root {\n  --color-primary: #ff0000;\n  --brand: var(--color-primary);\n  --space-4: 16px;\n}\n");
    expect(tokensToCss([])).toBe(":root {}\n");
  });

  it("maps names to Tailwind v4 namespaces", () => {
    expect(tokens.map(tailwindTokenName)).toEqual([
      "--color-primary",
      "--color-brand",
      "--spacing-4",
      "--radius-lg",
      "--font-sans",
      "--font-weight-bold",
      "--text-xl",
      "--leading-tight",
      "--tracking-wide",
      "--opacity-muted",
      "--container-md",
      "--breakpoint-md",
    ]);
  });

  it("tokensToTailwind renames alias references", () => {
    const out = tokensToTailwind([tok("color", "--primary", "#00f"), tok("color", "--brand", "var(--primary)"), tok("color", "--ext", "var(--other)")]);
    expect(out).toBe("@theme {\n  --color-primary: #00f;\n  --color-brand: var(--color-primary);\n  --color-ext: var(--other);\n}\n");
  });

  it("tokenCssVars", () => {
    const doc = { ...createDocument("x", { id: "F" }), tokens: tokens.slice(0, 3) };
    expect(tokenCssVars(doc)).toEqual({ "--color-primary": "#ff0000", "--brand": "var(--color-primary)", "--space-4": "16px" });
  });

  it("content hash is stable and changes with tokens", () => {
    const a = tokensContentHash(tokens);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(tokensContentHash(tokens.map((t) => ({ value: t.value, name: t.name, type: t.type, id: t.id })))).toBe(a);
    expect(tokensContentHash(tokens.slice(1))).not.toBe(a);
  });
});
