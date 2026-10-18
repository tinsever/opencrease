import { fnv1a, stableStringify } from "./hash";
import type { FoldDocument, Token, TokenType } from "./types";

const ALIAS_RE = /^var\(\s*(--[^\s,()]+)\s*(?:,\s*([\s\S]*?)\s*)?\)$/;
const VAR_REF_RE = /var\(\s*(--[^\s,()]+)/g;

/** `var(--x)` or `var(--x, fallback)` as a whole value → `{ name: "--x", fallback }`. */
export function parseAlias(value: string | number): { name: string; fallback?: string } | undefined {
  if (typeof value !== "string") return undefined;
  const m = ALIAS_RE.exec(value.trim());
  if (!m) return undefined;
  return m[2] !== undefined && m[2] !== "" ? { name: m[1], fallback: m[2] } : { name: m[1] };
}

/** Every custom property referenced through `var()` anywhere in the value. */
export function varReferences(value: string | number): string[] {
  if (typeof value !== "string") return [];
  return [...value.matchAll(VAR_REF_RE)].map((m) => m[1]);
}

/** Adds the leading `--` if it is missing. */
export function normalizeTokenName(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith("--") ? trimmed : `--${trimmed}`;
}

/** Names of tokens that take part in a var() reference cycle, or [] when the graph is acyclic. */
export function findAliasCycle(tokens: readonly Token[]): string[] {
  const edges = new Map<string, string[]>();
  for (const t of tokens) edges.set(t.name, varReferences(t.value));
  const state = new Map<string, 1 | 2>(); // 1 visiting, 2 done
  const stack: string[] = [];
  const visit = (name: string): string[] | null => {
    const s = state.get(name);
    if (s === 2) return null;
    if (s === 1) return stack.slice(stack.indexOf(name));
    if (!edges.has(name)) return null;
    state.set(name, 1);
    stack.push(name);
    for (const next of edges.get(name)!) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(name, 2);
    return null;
  };
  for (const t of tokens) {
    const cycle = visit(t.name);
    if (cycle) return cycle;
  }
  return [];
}

const PX_TYPES: ReadonlySet<TokenType> = new Set(["spacing", "radius", "fontSize", "letterSpacing", "container", "breakpoint"]);

/** CSS value of a token: numbers become px for length types, everything else is used as written. */
export function tokenValueToCss(token: Pick<Token, "type" | "value">): string {
  if (typeof token.value === "number") return PX_TYPES.has(token.type) ? `${token.value}px` : String(token.value);
  return token.value;
}

export const TAILWIND_NAMESPACES: Record<TokenType, string> = {
  color: "--color-",
  spacing: "--spacing-",
  radius: "--radius-",
  fontFamily: "--font-",
  fontWeight: "--font-weight-",
  fontSize: "--text-",
  lineHeight: "--leading-",
  letterSpacing: "--tracking-",
  opacity: "--opacity-",
  container: "--container-",
  breakpoint: "--breakpoint-",
};

/** Common non-Tailwind prefixes that are replaced (not stacked) when mapping to a namespace. */
const FOREIGN_PREFIXES: Partial<Record<TokenType, string[]>> = {
  color: ["--colors-", "--colour-", "--clr-"],
  spacing: ["--space-", "--spacer-"],
  radius: ["--rounded-", "--border-radius-", "--radii-"],
  fontFamily: ["--font-family-", "--family-", "--ff-"],
  fontWeight: ["--weight-", "--fw-", "--font-"],
  fontSize: ["--font-size-", "--size-", "--fs-"],
  lineHeight: ["--line-height-", "--lh-"],
  letterSpacing: ["--letter-spacing-", "--ls-"],
  container: ["--max-width-"],
  breakpoint: ["--screen-", "--bp-"],
};

/** Tailwind v4 theme variable name for a token, e.g. color "--primary" → "--color-primary". */
export function tailwindTokenName(token: Pick<Token, "type" | "name">): string {
  const prefix = TAILWIND_NAMESPACES[token.type];
  const name = normalizeTokenName(token.name);
  if (name.startsWith(prefix) && name.length > prefix.length) return name;
  for (const foreign of FOREIGN_PREFIXES[token.type] ?? []) {
    if (name.startsWith(foreign) && name.length > foreign.length) return prefix + name.slice(foreign.length);
  }
  return prefix + name.slice(2);
}

function block(selector: string, entries: Array<[string, string]>): string {
  if (entries.length === 0) return `${selector} {}\n`;
  return `${selector} {\n${entries.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}\n`;
}

export function tokensToCss(tokens: readonly Token[]): string {
  return block(":root", tokens.map((t) => [normalizeTokenName(t.name), tokenValueToCss(t)]));
}

/** Tailwind v4 `@theme` block. Token names are mapped to namespaces and var() references are renamed to match. */
export function tokensToTailwind(tokens: readonly Token[]): string {
  const renamed = new Map(tokens.map((t) => [normalizeTokenName(t.name), tailwindTokenName(t)]));
  const rewrite = (value: string) =>
    value.replace(/var\(\s*(--[^\s,()]+)/g, (match, ref: string) => (renamed.has(ref) ? `var(${renamed.get(ref)}` : match));
  return block("@theme", tokens.map((t) => [renamed.get(normalizeTokenName(t.name))!, rewrite(tokenValueToCss(t))]));
}

/** Custom properties to inject on the canvas content root (name → CSS value). */
export function tokenCssVars(doc: Pick<FoldDocument, "tokens">): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const t of doc.tokens) vars[normalizeTokenName(t.name)] = tokenValueToCss(t);
  return vars;
}

/** Class / utility name of a text style: "Heading 1" → "type-heading-1". "" when the name has no letters or digits. */
export function textStyleSlug(name: string): string {
  const slug = String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `type-${slug}` : "";
}

/** fnv1a of the tokens as deterministic JSON; the `contentHash.tokens` value of tool results. */
export function tokensContentHash(tokens: readonly Token[]): string {
  return fnv1a(stableStringify(tokens));
}
