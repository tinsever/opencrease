// Pure helpers behind the Theme tab: importing pasted text (CSS with mode blocks, Tailwind @theme or
// DTCG JSON), the clipboard payload for copying tokens between files, and token usage lookups.
import {
  collectionOfMode, MODE_NAME_RE, modeLabel, normalizeModeName, normalizeTokenName, parseDtcg, tokenCollection, tokensToDtcg, varReferences,
  type FoldDocument, type NodeId, type Token, type TokenImportData,
} from "@opencrease/model";
import { parseCssTokens } from "./tokens-import";

export interface ParsedTheme extends TokenImportData {
  format: "css" | "dtcg";
  warnings: string[];
}

/** The default mode paired with a mode found in pasted CSS when no collection has it yet. */
const PAIRS: Record<string, string> = { dark: "light", light: "dark", compact: "comfortable", comfortable: "compact", dense: "comfortable" };
/** Modes that are the default (first) of their pair. */
const DEFAULTS = new Set(["light", "comfortable"]);

/** Selectors a pasted block can use for a mode: `[data-mode~="x"]`, `[data-mode="x"]`, `[data-theme="x"]`, `.x`. */
function modeOfSelector(sel: string): string | null {
  const s = sel.trim();
  const attr = /^\[data-(?:mode|theme)\s*[~|]?=\s*["']?([\w-]+)["']?\s*\]$/.exec(s);
  if (attr) return normalizeModeName(attr[1]);
  const cls = /^(?::root|html)?\.([\w-]+)$/.exec(s);
  if (cls) return normalizeModeName(cls[1]);
  return null;
}

/** Top-level `selector { body }` blocks (one level of nesting, enough for :root, @theme and mode rules). */
function blocks(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const selector = text.slice(i, open).split(/[;}]/).pop()!.trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    if (/^@layer\b/.test(selector) || /^@media\b/.test(selector)) out.push(...blocks(body));
    else out.push({ selector, body });
    i = j;
  }
  return out;
}

/** Parses pasted theme text. JSON is read as DTCG; anything else as CSS custom properties. */
export function parseThemeText(text: string, doc: Pick<FoldDocument, "modeCollections">): ParsedTheme {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const d = parseDtcg(trimmed);
      return { format: "dtcg", tokens: d.tokens, modeCollections: d.modeCollections, warnings: d.warnings };
    } catch (e) {
      return { format: "dtcg", tokens: [], modeCollections: [], warnings: [e instanceof Error ? e.message : String(e)] };
    }
  }
  const warnings: string[] = [];
  const base = new Map<string, ParsedTheme["tokens"][number]>();
  const modeValues: Array<{ mode: string; name: string; value: string | number }> = [];
  const found = blocks(trimmed);
  for (const b of found.length ? found : [{ selector: ":root", body: trimmed }]) {
    const selectors = b.selector.split(",").map((s) => s.trim());
    const mode = selectors.map(modeOfSelector).find((m) => m);
    for (const d of parseCssTokens(`{${b.body}}`)) {
      if (mode && MODE_NAME_RE.test(mode)) modeValues.push({ mode, name: d.name, value: d.value });
      else base.set(d.name, { ...d });
    }
  }
  const collections: NonNullable<TokenImportData["modeCollections"]> = [];
  for (const mode of [...new Set(modeValues.map((m) => m.mode))]) {
    if (collectionOfMode(doc, mode) || collections.some((c) => c.modes.includes(mode))) continue;
    const pair = PAIRS[mode] ?? "default";
    const existing = collections.find((c) => c.modes.includes(pair));
    if (existing) existing.modes.push(mode);
    else {
      const name = pair === "light" || mode === "light" ? "Colour scheme" : pair === "comfortable" || mode === "comfortable" ? "Density" : modeLabel(mode);
      collections.push({ name, modes: DEFAULTS.has(mode) ? [mode, pair] : [pair, mode] });
    }
  }
  for (const { mode, name, value } of modeValues) {
    const t = base.get(name);
    if (!t) {
      warnings.push(`${name} only appears in the "${mode}" block, it was skipped.`);
      continue;
    }
    const known = collectionOfMode(doc, mode);
    const isDefault = known ? known.modes[0] === mode : collections.some((c) => c.modes[0] === mode);
    if (isDefault) t.value = value;
    // exports re-declare aliases in every mode block; an unchanged value is not a mode value
    else if (String(value) !== String(t.value)) t.modes = { ...(t.modes ?? {}), [mode]: value };
  }
  return { format: "css", tokens: [...base.values()], modeCollections: collections, warnings };
}

/** DTCG JSON for some tokens, with the mode collections they use, for the clipboard. */
export function tokensClipboard(doc: Pick<FoldDocument, "tokens" | "modeCollections">, ids: readonly string[]): string {
  const tokens = doc.tokens.filter((t) => ids.includes(t.id));
  const used = new Set(tokens.map((t) => tokenCollection(doc, t)?.id).filter(Boolean));
  return tokensToDtcg({ tokens, modeCollections: (doc.modeCollections ?? []).filter((c) => used.has(c.id)) });
}

/** Ids of nodes whose styles or span styles reference any of the tokens (directly). */
export function tokenUsers(doc: FoldDocument, names: readonly string[]): NodeId[] {
  const want = new Set(names.map(normalizeTokenName));
  if (!want.size) return [];
  const refs = (v: unknown) => varReferences(v as string).some((r) => want.has(r));
  const out: NodeId[] = [];
  for (const n of Object.values(doc.nodes)) {
    if (Object.values(n.styles).some(refs) || n.spans?.some((s) => s.styles && Object.values(s.styles).some(refs))) out.push(n.id);
  }
  return out;
}

/** A free token name: `base`, then `base-2`, `base-3`... */
export function uniqueTokenName(tokens: readonly Pick<Token, "name">[], base: string): string {
  const names = new Set(tokens.map((t) => t.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
