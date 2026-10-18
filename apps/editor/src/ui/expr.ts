// Number field input parsing: arithmetic expressions, px suffixes, CSS units, var() tokens.

/** Evaluates `+ - * / ( )` arithmetic with decimals and optional `px` suffixes. Returns null when invalid. */
export function evaluateExpression(input: string): number | null {
  const src = input.replace(/px\b/gi, "").replace(/,/g, ".").trim();
  if (!src) return null;
  let i = 0;
  const peek = () => {
    while (src[i] === " ") i++;
    return src[i];
  };
  const parseNumber = (): number | null => {
    peek();
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const parseFactor = (): number | null => {
    const ch = peek();
    if (ch === "-" || ch === "+") {
      i++;
      const v = parseFactor();
      return v === null ? null : ch === "-" ? -v : v;
    }
    if (ch === "(") {
      i++;
      const v = parseSum();
      if (v === null || peek() !== ")") return null;
      i++;
      return v;
    }
    return parseNumber();
  };
  const parseTerm = (): number | null => {
    let v = parseFactor();
    while (v !== null) {
      const ch = peek();
      if (ch !== "*" && ch !== "/" && ch !== "x" && ch !== "×") break;
      i++;
      const r = parseFactor();
      if (r === null) return null;
      v = ch === "/" ? (r === 0 ? null : v / r) : v * r;
    }
    return v;
  };
  const parseSum = (): number | null => {
    let v = parseTerm();
    while (v !== null) {
      const ch = peek();
      if (ch !== "+" && ch !== "-") break;
      i++;
      const r = parseTerm();
      if (r === null) return null;
      v = ch === "+" ? v + r : v - r;
    }
    return v;
  };
  const result = parseSum();
  if (result === null || peek() !== undefined || !Number.isFinite(result)) return null;
  return Math.round(result * 1000) / 1000;
}

export type FieldValue = number | string;

const KEYWORDS = new Set(["auto", "fit-content", "max-content", "min-content", "none", "normal", "inherit", "initial", "unset"]);
const UNIT_RE = /^-?(\d+\.?\d*|\.\d+)(%|em|rem|vh|vw|vmin|vmax|ch|ex|fr|deg|turn|s|ms|dvh|svh|lvh|dvw)$/i;

/**
 * Parses what the user typed in a style number field.
 * - arithmetic (`24*2`, `10px + 4`) → number (px)
 * - `var(--token)` or `--token` → `var(--token)`
 * - other CSS units (`50%`, `1.5em`) and keywords (`auto`) → kept as string
 * Returns null when the input is not acceptable (the field then reverts).
 */
export function parseFieldInput(input: string, opts: { allowUnits?: boolean; allowKeywords?: boolean } = {}): FieldValue | null {
  const text = input.trim();
  if (!text) return null;
  const varMatch = /^var\(\s*(--[\w-]+)\s*(,[^)]*)?\)$/.exec(text);
  if (varMatch) return text.replace(/\s+/g, " ");
  if (/^--[\w-]+$/.test(text)) return `var(${text})`;
  if (opts.allowKeywords !== false && KEYWORDS.has(text.toLowerCase())) return text.toLowerCase();
  if (opts.allowUnits !== false && UNIT_RE.test(text.replace(/\s+/g, ""))) return text.replace(/\s+/g, "");
  if (/^calc\(.*\)$/.test(text) || /^(min|max|clamp)\(.*\)$/.test(text)) return text;
  return evaluateExpression(text);
}

/** Numeric px value of a style value, or null (`"12px"` → 12, `12` → 12, `"50%"` → null). */
export function pxValue(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = /^\s*(-?(?:\d+\.?\d*|\.\d+))(px)?\s*$/i.exec(v);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Display form of a number: at most 2 decimals, no trailing zeros. */
export function formatNumber(n: number, digits = 2): string {
  let s = n.toFixed(digits);
  if (s.includes(".")) s = s.replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

/** Clamp helper. */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
