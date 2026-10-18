// Turns the solid colours used in imported node trees into colour tokens (Snapshot's "Turn colors into tokens").
import type { NodeTree, Token } from "@opencrease/model";
import { colorsEqual, findColorsInValue, formatColor, parseColor } from "./color";

/** Style keys whose colours become tokens. Gradients and shadows keep their literal colours. */
const COLOR_KEYS = new Set([
  "color", "backgroundColor", "border", "borderTop", "borderRight", "borderBottom", "borderLeft", "borderColor",
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "outline", "outlineColor",
  "textDecorationColor", "WebkitTextFillColor",
]);

const MAX_TOKENS = 24;

export interface ColorTokenResult {
  trees: NodeTree[];
  /** Tokens to create (existing document tokens with the same value are reused, not listed). */
  tokens: Array<{ type: "color"; name: string; value: string }>;
}

function hueName(h: number): string {
  if (h < 20 || h >= 345) return "red";
  if (h < 70) return "orange";
  if (h < 110) return "yellow";
  if (h < 165) return "green";
  if (h < 200) return "teal";
  if (h < 265) return "blue";
  if (h < 310) return "purple";
  return "pink";
}

/** A readable token name for a colour: --color-gray-700, --color-blue-500, --color-black-a10. */
export function colorTokenName(value: string): string {
  const o = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(formatColor(value, "oklch"));
  if (!o) return "--color-custom";
  const l = Number(o[1]);
  const c = Number(o[2]);
  const h = Number(o[3]);
  const a = o[4] === undefined ? 1 : Number(o[4]);
  let base: string;
  if (c < 0.02) {
    if (l > 0.985) base = "white";
    else if (l < 0.08) base = "black";
    else base = `gray-${Math.min(950, Math.max(50, Math.round((1 - l) * 20) * 50))}`;
  } else base = `${hueName(h)}-${Math.min(950, Math.max(50, Math.round((1 - l) * 20) * 50))}`;
  const alpha = a < 1 ? `-a${Math.round(a * 100)}` : "";
  return `--color-${base}${alpha}`;
}

function visitStyles(trees: NodeTree[], fn: (styles: Record<string, string | number>, key: string, value: string) => void): void {
  const walk = (t: NodeTree) => {
    if (t.styles) for (const [k, v] of Object.entries(t.styles)) if (COLOR_KEYS.has(k) && typeof v === "string") fn(t.styles, k, v);
    t.children?.forEach(walk);
  };
  trees.forEach(walk);
}

/**
 * Finds the solid colours used in the trees, creates (or reuses) colour tokens for the ones used at least
 * twice, the most frequent first, and rewrites the styles to `var(--token)`. The input is not modified.
 */
export function colorTokensForTrees(input: NodeTree[], existing: readonly Token[]): ColorTokenResult {
  const trees = structuredClone(input);
  const counts = new Map<string, number>();
  visitStyles(trees, (_s, _k, v) => {
    for (const c of findColorsInValue(v)) {
      if (c.startsWith("var(") || !parseColor(c)) continue;
      const hex = formatColor(c, "hex").toLowerCase();
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  });
  const chosen = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, MAX_TOKENS).map(([hex]) => hex);
  const names = new Map<string, string>();
  const taken = new Set(existing.map((t) => t.name));
  const tokens: ColorTokenResult["tokens"] = [];
  for (const hex of chosen) {
    const reuse = existing.find((t) => t.type === "color" && typeof t.value === "string" && colorsEqual(t.value, hex));
    if (reuse) {
      names.set(hex, reuse.name);
      continue;
    }
    const base = colorTokenName(hex);
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
    taken.add(name);
    names.set(hex, name);
    tokens.push({ type: "color", name, value: hex.toUpperCase() });
  }
  if (!names.size) return { trees, tokens };
  visitStyles(trees, (styles, key, value) => {
    let next = value;
    // longest literals first, so "#FFF" never cuts into "#FFFFFF"
    for (const c of findColorsInValue(value).sort((a, b) => b.length - a.length)) {
      if (c.startsWith("var(") || !parseColor(c)) continue;
      const name = names.get(formatColor(c, "hex").toLowerCase());
      if (name) next = next.split(c).join(`var(${name})`);
    }
    styles[key] = next;
  });
  return { trees, tokens };
}
