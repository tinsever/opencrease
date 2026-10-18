import { describe, expect, it } from "vitest";
import { createDocument } from "./document";
import { ModelError } from "./errors";
import { parseFold, serializeFold } from "./format";
import {
  effectiveModes, findModeCycle, modeBlocks, modeScopeCss, normalizeModeName, resolveTokenIn, themeToCss, themeToTailwind,
} from "./modes";
import { DocStore } from "./store";
import type { Tx } from "./contracts";

function setup() {
  const store = new DocStore(createDocument("Test", { id: "F", now: 1000 }), { now: () => 2000 });
  const pageId = store.doc.pageList[0].id;
  const rootId = store.doc.pages[pageId].rootId;
  const run = <T>(fn: (tx: Tx) => T): T => store.transact("test", fn);
  return { store, rootId, run };
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ModelError);
    return (e as ModelError).code;
  }
  throw new Error("expected a ModelError");
}

/** A themed document: surface/ink vary by Theme (light, dark), button aliases ink, gap by Density. */
function themed() {
  const s = setup();
  s.run((tx) => {
    tx.createModeCollection("Theme", ["Light", "Dark"]);
    tx.createModeCollection("Density", ["comfortable", "compact"]);
    tx.createToken({ type: "color", name: "--color-surface", value: "#ffffff", modes: { dark: "#111111" } });
    tx.createToken({ type: "color", name: "--color-ink", value: "#111111", modes: { dark: "#f5f5f5" } });
    tx.createToken({ type: "color", name: "--color-button", value: "var(--color-ink)" });
    tx.createToken({ type: "color", name: "--color-brand", value: "#d97757" });
    tx.createToken({ type: "spacing", name: "--spacing-gap", value: 16, modes: { compact: 8 } });
  });
  return s;
}

describe("mode collections", () => {
  it("normalises mode names and keeps them unique across collections", () => {
    const { store, run } = setup();
    const c = run((tx) => tx.createModeCollection("Theme", ["Light", "Dark Mode"]));
    expect(c.modes).toEqual(["light", "dark-mode"]);
    expect(normalizeModeName("  High Contrast!")).toBe("high-contrast");
    expect(code(() => run((tx) => tx.createModeCollection("Other", ["light"])))).toBe("duplicate_name");
    expect(code(() => run((tx) => tx.createModeCollection("Bad", ["---"])))).toBe("invalid_argument");
    expect(store.doc.modeCollections).toHaveLength(1);
  });

  it("stores non-default mode values and resolves them", () => {
    const { store } = themed();
    const surface = store.doc.tokens.find((t) => t.name === "--color-surface")!;
    expect(surface.value).toBe("#ffffff");
    expect(surface.modes).toEqual({ dark: "#111111" });
    expect(resolveTokenIn(store.doc, "--color-button", [])).toBe("#111111");
    expect(resolveTokenIn(store.doc, "--color-button", ["dark"])).toBe("#f5f5f5");
    expect(resolveTokenIn(store.doc, "--spacing-gap", ["dark", "compact"])).toBe(8);
  });

  it("sets and removes mode values, the default mode writes the value", () => {
    const { store, run } = themed();
    run((tx) => tx.setTokenModeValue("--color-brand", "dark", "#ff8866"));
    expect(store.doc.tokens.find((t) => t.name === "--color-brand")!.modes).toEqual({ dark: "#ff8866" });
    run((tx) => tx.setTokenModeValue("--color-brand", "light", "#cc6644"));
    expect(store.doc.tokens.find((t) => t.name === "--color-brand")!.value).toBe("#cc6644");
    run((tx) => tx.setTokenModeValue("--color-brand", "dark", null));
    expect(store.doc.tokens.find((t) => t.name === "--color-brand")!.modes).toBeUndefined();
    // one collection per token
    expect(code(() => run((tx) => tx.setTokenModeValue("--color-surface", "compact", "#000")))).toBe("invalid_argument");
    expect(code(() => run((tx) => tx.setTokenModeValue("--color-surface", "sepia", "#000")))).toBe("not_found");
  });

  it("rejects alias cycles that only exist in one mode", () => {
    const { store, run } = themed();
    run((tx) => tx.createToken({ type: "color", name: "--a", value: "#000" }));
    run((tx) => tx.createToken({ type: "color", name: "--b", value: "var(--a)" }));
    // default values are fine, but in dark --a → --b → --a
    expect(code(() => run((tx) => tx.setTokenModeValue("--a", "dark", "var(--b)")))).toBe("alias_cycle");
    expect(store.doc.tokens.find((t) => t.name === "--a")!.modes).toBeUndefined();
    expect(findModeCycle(store.doc)).toBeNull();
    // the message names the mode
    try {
      run((tx) => tx.setTokenModeValue("--a", "dark", "var(--b)"));
    } catch (e) {
      expect((e as Error).message).toMatch(/in mode "dark"/);
    }
  });

  it("renames, reorders and removes modes, moving values and frame pins", () => {
    const { store, rootId, run } = themed();
    const [frame] = run((tx) => tx.insertTrees(rootId, [{ type: "Frame", mode: "dark compact" }]));
    expect(store.doc.nodes[frame].mode).toBe("dark compact");
    const theme = store.doc.modeCollections![0];
    run((tx) => tx.updateModeCollection(theme.id, { renames: { dark: "night" } }));
    expect(store.doc.nodes[frame].mode).toBe("night compact");
    expect(store.doc.tokens.find((t) => t.name === "--color-surface")!.modes).toEqual({ night: "#111111" });
    // make night the default: values swap
    run((tx) => tx.updateModeCollection(theme.id, { modes: ["night", "light"] }));
    const surface = store.doc.tokens.find((t) => t.name === "--color-surface")!;
    expect(surface.value).toBe("#111111");
    expect(surface.modes).toEqual({ light: "#ffffff" });
    // remove light: its values and pins go away
    run((tx) => tx.updateModeCollection(theme.id, { modes: ["night"] }));
    expect(store.doc.tokens.find((t) => t.name === "--color-surface")!.modes).toBeUndefined();
    run((tx) => tx.updateNode(frame, { mode: "night" }));
    run((tx) => tx.deleteModeCollection(theme.id));
    expect(store.doc.nodes[frame].mode).toBeUndefined();
    expect(code(() => run((tx) => tx.updateNode(frame, { mode: "night" })))).toBe("not_found");
  });

  it("finds the active modes of a node, nearest pin per collection", () => {
    const { store, rootId, run } = themed();
    const [outer] = run((tx) => tx.insertTrees(rootId, [{ type: "Frame", mode: "dark compact", children: [{ type: "Frame", mode: "light", children: [{ text: "Hi" }] }] }]));
    const inner = store.doc.nodes[outer].children[0];
    const text = store.doc.nodes[inner].children[0];
    expect(effectiveModes(store.doc, text).sort()).toEqual(["compact", "light"]);
    expect(effectiveModes(store.doc, outer).sort()).toEqual(["compact", "dark"]);
  });

  it("survives a save and load, and old files without modes still load", () => {
    const { store, rootId, run } = themed();
    run((tx) => tx.insertTrees(rootId, [{ type: "Frame", mode: "dark" }]));
    const loaded = parseFold(serializeFold(store.doc).documentJson);
    expect(loaded.modeCollections).toEqual(store.doc.modeCollections);
    expect(loaded.tokens).toEqual(store.doc.tokens);
    expect(Object.values(loaded.nodes).some((n) => n.mode === "dark")).toBe(true);
    const plain = parseFold(serializeFold(createDocument("Old")).documentJson);
    expect(plain.modeCollections).toBeUndefined();
  });
});

describe("mode css", () => {
  it("re-declares varying tokens and their aliases in each mode block", () => {
    const { store } = themed();
    const blocks = modeBlocks(store.doc);
    const dark = blocks.find((b) => b.mode === "dark")!;
    expect(dark.entries).toEqual([
      ["--color-surface", "#111111"],
      ["--color-ink", "#f5f5f5"],
      ["--color-button", "var(--color-ink)"],
    ]);
    const light = blocks.find((b) => b.mode === "light")!;
    expect(light.entries.map((e) => e[0])).toEqual(["--color-surface", "--color-ink", "--color-button"]);
    expect(blocks.find((b) => b.mode === "compact")!.entries).toEqual([["--spacing-gap", "8px"]]);
  });

  it("exports CSS with :root and [data-mode] blocks", () => {
    const { store } = themed();
    const css = themeToCss(store.doc);
    expect(css).toContain(":root {\n  --color-surface: #ffffff;");
    expect(css).toContain('[data-mode~="dark"] {\n  --color-surface: #111111;\n  --color-ink: #f5f5f5;\n  --color-button: var(--color-ink);\n}');
    expect(css).toContain('[data-mode~="compact"] {\n  --spacing-gap: 8px;\n}');
    expect(css).not.toContain("--color-brand: #d97757;\n}\n\n[data-mode");
  });

  it("exports Tailwind with @theme, custom variants and a base layer", () => {
    const { store, run } = themed();
    run((tx) => tx.createToken({ type: "color", name: "--accent", value: "#00f", modes: { dark: "#88f" } }));
    const tw = themeToTailwind(store.doc);
    expect(tw).toContain("@theme {\n  --color-surface: #ffffff;");
    expect(tw).toContain("--color-accent: #00f;");
    expect(tw).toContain('@custom-variant dark (&:where([data-mode~="dark"], [data-mode~="dark"] *));');
    expect(tw).toContain('@layer base {\n  [data-mode~="light"] {');
    expect(tw).toContain("    --color-accent: #88f;");
  });

  it("scopes canvas rules under a selector", () => {
    const { store } = themed();
    expect(modeScopeCss(store.doc, ".content")).toContain('.content [data-mode~="dark"] {\n  --color-surface: #111111;');
  });

  it("emits nothing extra without modes", () => {
    const { store, run } = setup();
    run((tx) => tx.createToken({ type: "color", name: "--color-a", value: "red" }));
    expect(themeToCss(store.doc)).toBe(":root {\n  --color-a: red;\n}\n");
    expect(themeToTailwind(store.doc)).toBe("@theme {\n  --color-a: red;\n}\n");
  });
});
