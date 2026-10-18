import { createDocument, DocStore, importTokens, themeToCss } from "@opencrease/model";
import { describe, expect, it } from "vitest";
import { parseThemeText, tokensClipboard, tokenUsers } from "./theme-logic";

describe("theme import", () => {
  it("reads :root plus mode blocks into tokens with per-mode values", () => {
    const parsed = parseThemeText(
      ':root { --color-bg: #fff; --color-fg: #111; --space: 16px }\n[data-mode~="dark"] { --color-bg: #000 }\n.compact { --space: 8px }',
      { modeCollections: [] },
    );
    expect(parsed.format).toBe("css");
    expect(parsed.modeCollections).toEqual([
      { name: "Colour scheme", modes: ["light", "dark"] },
      { name: "Density", modes: ["comfortable", "compact"] },
    ]);
    expect(parsed.tokens.find((t) => t.name === "--color-bg")).toMatchObject({ value: "#fff", modes: { dark: "#000" } });
    expect(parsed.tokens.find((t) => t.name === "--space")).toMatchObject({ value: 16, modes: { compact: 8 } });
  });

  it("round-trips the CSS export through import", () => {
    const store = new DocStore(createDocument("A"));
    store.transact("t", (tx) => {
      tx.createModeCollection("Theme", ["light", "dark"]);
      tx.createToken({ type: "color", name: "--color-bg", value: "#ffffff", modes: { dark: "#000000" } });
      tx.createToken({ type: "color", name: "--color-surface", value: "var(--color-bg)" });
    });
    const css = themeToCss(store.doc);
    const target = new DocStore(createDocument("B"));
    target.transact("import", (tx) => importTokens(tx, parseThemeText(css, tx.doc)));
    expect(target.doc.modeCollections?.[0].modes).toEqual(["light", "dark"]);
    expect(target.doc.tokens.find((t) => t.name === "--color-bg")).toMatchObject({ value: "#ffffff", modes: { dark: "#000000" } });
    expect(target.doc.tokens.find((t) => t.name === "--color-surface")?.modes).toBeUndefined();
  });

  it("copies tokens between files as DTCG with their mode collection", () => {
    const a = new DocStore(createDocument("A"));
    a.transact("t", (tx) => {
      tx.createModeCollection("Theme", ["light", "dark"]);
      tx.createToken({ type: "color", name: "--color-bg", value: "#fff", modes: { dark: "#000" } });
      tx.createToken({ type: "spacing", name: "--spacing-4", value: 16 });
    });
    const text = tokensClipboard(a.doc, [a.doc.tokens[0].id]);
    const b = new DocStore(createDocument("B"));
    const parsed = parseThemeText(text, b.doc);
    expect(parsed.format).toBe("dtcg");
    b.transact("paste", (tx) => importTokens(tx, parsed));
    expect(b.doc.tokens.map((t) => t.name)).toEqual(["--color-bg"]);
    expect(b.doc.tokens[0].modes).toEqual({ dark: "#000" });
  });

  it("finds nodes using a token in styles and spans", () => {
    const s = new DocStore(createDocument("A"));
    const pageRoot = s.doc.pages[Object.keys(s.doc.pages)[0]].rootId;
    const [a, b] = s.transact("t", (tx) => {
      tx.createToken({ type: "color", name: "--color-ink", value: "#111" });
      return tx.insertTrees(pageRoot, [
        { type: "Frame", styles: { background: "var(--color-ink)" } },
        { type: "Text", text: "ab", styles: {}, spans: [{ text: "a", styles: { color: "var(--color-ink)" } }, { text: "b" }] },
        { type: "Frame", styles: {} },
      ]);
    });
    expect(tokenUsers(s.doc, ["--color-ink"]).sort()).toEqual([a, b].sort());
  });
});
