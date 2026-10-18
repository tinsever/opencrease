// Token modes (light/dark, comfortable/compact): resolution, cycle checks and scoped CSS output.
//
// A mode collection lists mode names; the first is the default and uses each token's `value`. A token
// varies by at most one collection, through `Token.modes` (mode name → value). A Frame pins modes with
// `mode` ("dark" or "dark compact"), rendered as `data-mode` and matched by `[data-mode~="dark"]`.

import { findAliasCycle, normalizeTokenName, parseAlias, tailwindTokenName, tokenValueToCss, varReferences } from "./tokens";
import type { FoldDocument, ModeCollection, NodeId, Token, OFNode } from "./types";

const getNode = (doc: Pick<FoldDocument, "nodes">, id: NodeId): OFNode | undefined => doc.nodes[id];

type TokenDoc = Pick<FoldDocument, "tokens" | "modeCollections">;

export const MODE_NAME_RE = /^[a-z][a-z0-9_-]*$/;

/** "Dark Mode" → "dark-mode". Returns "" when nothing usable is left. */
export function normalizeModeName(name: string): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^[^a-z]+/, "");
}

/** Display label of a mode name: "dark-mode" → "Dark mode". */
export function modeLabel(mode: string): string {
  const s = mode.replace(/[-_]+/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function modeCollections(doc: Pick<FoldDocument, "modeCollections">): ModeCollection[] {
  return doc.modeCollections ?? [];
}

/** The collection a mode name belongs to. */
export function collectionOfMode(doc: Pick<FoldDocument, "modeCollections">, mode: string): ModeCollection | undefined {
  return modeCollections(doc).find((c) => c.modes.includes(mode));
}

/** The collection a token varies by (from its mode keys), if any. */
export function tokenCollection(doc: Pick<FoldDocument, "modeCollections">, token: Pick<Token, "modes">): ModeCollection | undefined {
  const keys = Object.keys(token.modes ?? {});
  if (!keys.length) return undefined;
  return collectionOfMode(doc, keys[0]);
}

/** Splits a `mode` attribute value into names. */
export function parseModeList(value: string | undefined): string[] {
  return (value ?? "").split(/\s+/).map((m) => m.trim()).filter(Boolean);
}

/** Value of a token when the given modes are active (one per collection; unknown modes are ignored). */
export function tokenValueIn(token: Pick<Token, "value" | "modes">, modes: readonly string[]): string | number {
  if (token.modes) {
    for (const m of modes) {
      if (Object.prototype.hasOwnProperty.call(token.modes, m)) return token.modes[m];
    }
  }
  return token.value;
}

/** Tokens with their values switched to the given modes (for resolution and cycle checks). */
export function tokensInModes<T extends Pick<Token, "name" | "value" | "modes">>(tokens: readonly T[], modes: readonly string[]): T[] {
  if (!modes.length) return [...tokens];
  return tokens.map((t) => ({ ...t, value: tokenValueIn(t, modes) }));
}

/**
 * Active modes for a node: the nearest pinned mode per collection, walking up from the node.
 * Collections without a pin use their default (first) mode, which is not listed.
 */
export function effectiveModes(doc: FoldDocument, id: NodeId): string[] {
  const out: string[] = [];
  const done = new Set<string>();
  let node = getNode(doc, id);
  const seen = new Set<NodeId>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    for (const m of parseModeList(node.mode)) {
      const c = collectionOfMode(doc, m);
      if (!c || done.has(c.id)) continue;
      done.add(c.id);
      out.push(m);
    }
    node = node.parentId ? getNode(doc, node.parentId) : undefined;
  }
  return out;
}

/** Like `resolveToken`, with the given modes active. */
export function resolveTokenIn(doc: TokenDoc, name: string, modes: readonly string[]): string | number | undefined {
  const start = parseAlias(name)?.name ?? normalizeTokenName(name);
  const seen = new Set<string>();
  let current = start;
  let fallback: string | undefined;
  while (!seen.has(current)) {
    seen.add(current);
    const token = doc.tokens.find((t) => t.name === current);
    if (!token) return current === start ? undefined : fallback;
    const value = tokenValueIn(token, modes);
    const alias = parseAlias(value);
    if (!alias) return value;
    fallback = alias.fallback;
    current = alias.name;
  }
  return undefined;
}

/** A var() cycle in the default values or in any single mode, with the mode it occurs in. */
export function findModeCycle(doc: TokenDoc): { cycle: string[]; mode: string | null } | null {
  const base = findAliasCycle(doc.tokens);
  if (base.length) return { cycle: base, mode: null };
  for (const c of modeCollections(doc)) {
    for (const m of c.modes.slice(1)) {
      const cycle = findAliasCycle(tokensInModes(doc.tokens, [m]));
      if (cycle.length) return { cycle, mode: m };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// CSS output

export interface ModeBlock {
  mode: string;
  collection: ModeCollection;
  /** [custom property name, CSS value], in token order */
  entries: Array<[string, string]>;
}

/**
 * Declarations each mode needs on its scope element. A block re-declares the tokens that vary by the
 * collection plus every token whose value references one of them (directly or through other tokens):
 * custom properties resolve var() where they are declared, so aliases must be re-declared to follow.
 */
export function modeBlocks(doc: TokenDoc, rename: (name: string) => string = (n) => n): ModeBlock[] {
  const blocks: ModeBlock[] = [];
  for (const c of modeCollections(doc)) {
    if (c.modes.length < 2) continue;
    const varying = new Set(doc.tokens.filter((t) => tokenCollection(doc, t)?.id === c.id).map((t) => t.name));
    if (!varying.size) continue;
    for (const mode of c.modes) {
      const values = tokensInModes(doc.tokens, mode === c.modes[0] ? [] : [mode]);
      const include = new Set(varying);
      let grew = true;
      while (grew) {
        grew = false;
        for (const t of values) {
          if (include.has(t.name)) continue;
          if (varReferences(t.value).some((r) => include.has(r))) {
            include.add(t.name);
            grew = true;
          }
        }
      }
      const entries: Array<[string, string]> = values
        .filter((t) => include.has(t.name))
        .map((t) => [rename(t.name), rewriteRefs(tokenValueToCss(t), rename)]);
      blocks.push({ mode, collection: c, entries });
    }
  }
  return blocks;
}

function rewriteRefs(value: string, rename: (name: string) => string): string {
  return value.replace(/var\(\s*(--[^\s,()]+)/g, (_m, ref: string) => `var(${rename(ref)}`);
}

export function modeSelector(mode: string): string {
  return `[data-mode~="${mode}"]`;
}

function cssBlock(selector: string, entries: Array<[string, string]>, pad = ""): string {
  if (!entries.length) return `${pad}${selector} {}\n`;
  return `${pad}${selector} {\n${entries.map(([k, v]) => `${pad}  ${k}: ${v};`).join("\n")}\n${pad}}\n`;
}

/** Scoped mode rules for the canvas: `<scope> [data-mode~="dark"] { ... }`. */
export function modeScopeCss(doc: TokenDoc, scope: string): string {
  return modeBlocks(doc)
    .map((b) => cssBlock(`${scope} ${modeSelector(b.mode)}`, b.entries))
    .join("");
}

/** CSS `:root` block plus one `[data-mode~="x"]` block per mode. */
export function themeToCss(doc: TokenDoc): string {
  const root = cssBlock(":root", doc.tokens.map((t) => [normalizeTokenName(t.name), tokenValueToCss(t)]));
  const blocks = modeBlocks(doc).map((b) => cssBlock(modeSelector(b.mode), b.entries));
  return [root, ...blocks].join("\n");
}

/**
 * Tailwind v4: `@theme` with the default values, a `@custom-variant` per mode (so `dark:` and friends
 * follow `data-mode`), and the per-mode overrides in `@layer base`.
 */
export function themeToTailwind(doc: TokenDoc): string {
  const renamed = new Map(doc.tokens.map((t) => [normalizeTokenName(t.name), tailwindTokenName(t)]));
  const rename = (n: string) => renamed.get(n) ?? n;
  const theme = cssBlock("@theme", doc.tokens.map((t) => [rename(normalizeTokenName(t.name)), rewriteRefs(tokenValueToCss(t), rename)]));
  const blocks = modeBlocks(doc, rename);
  if (!blocks.length) return theme;
  const modes = [...new Set(blocks.map((b) => b.mode))];
  const variants = modes.map((m) => `@custom-variant ${m} (&:where(${modeSelector(m)}, ${modeSelector(m)} *));`).join("\n");
  const layer = `@layer base {\n${blocks.map((b) => cssBlock(modeSelector(b.mode), b.entries, "  ")).join("")}}\n`;
  return [theme, `${variants}\n`, layer].join("\n");
}
