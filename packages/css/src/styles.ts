import type { StyleMap, StyleValue } from "@opencrease/model";
import { safeCssValue } from "./security";
import { ALLOWED_STYLES, UNITLESS_PROPERTIES } from "./allowlist";
import { camelToKebab, canonicalPropName } from "./case";
import { parseColor } from "./color";
import { splitSpaces, splitTopLevel, stripComments } from "./tokenize";

/**
 * Parses an inline style declaration list ("a: b; c: d") into a camelCased record.
 * Semicolons inside quotes, parentheses and `url(...)` are respected, comments are removed and
 * `!important` is stripped. Later declarations win. Custom properties ("--x") keep their name.
 */
export function parseInlineStyle(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!css) return out;
  for (const decl of splitTopLevel(stripComments(css), (c) => c === ";")) {
    const colon = decl.indexOf(":");
    if (colon <= 0) continue;
    const rawName = decl.slice(0, colon).trim();
    if (!rawName || /[\s"'(]/.test(rawName)) continue;
    let value = decl.slice(colon + 1).trim();
    value = value.replace(/\s*!\s*important\s*$/i, "").trim();
    if (value === "") continue;
    out[canonicalPropName(rawName)] = value;
  }
  return out;
}

export interface NormalizeResult {
  styles: StyleMap;
  /**
   * Dropped properties (camelCase key) and conversion notes ("display: inline-grid (converted to grid)").
   * Inert declarations (e.g. `margin: 0`, `position: static`) are dropped silently.
   */
  ignored: string[];
  /** Allowlisted keys whose value was null or "" (callers use these to delete properties). */
  removed: string[];
}

const DISPLAY_MAP: Record<string, { to: string; note: boolean }> = {
  flex: { to: "flex", note: false },
  block: { to: "block", note: false },
  none: { to: "none", note: false },
  grid: { to: "grid", note: false },
  "inline-grid": { to: "grid", note: true },
  "inline-flex": { to: "flex", note: true },
  inline: { to: "block", note: true },
  "inline-block": { to: "block", note: true },
  "flow-root": { to: "block", note: true },
  "list-item": { to: "block", note: true },
};

const ZERO = /^[+-]?0+(\.0+)?(px|em|rem|%)?$/i;

function isZero(value: StyleValue): boolean {
  return typeof value === "number" ? value === 0 : splitSpaces(value).every((p) => ZERO.test(p));
}

/** True when every layer of a background value is an image (gradient or url). */
function isImageLayers(value: string): boolean {
  return splitTopLevel(value, (c) => c === ",").every((layer) =>
    /^\s*(repeating-)?(linear|radial|conic)-gradient\(|^\s*url\(|^\s*image-set\(/i.test(layer) &&
    splitSpaces(layer).length === 1,
  );
}

function isSingleColor(value: string): boolean {
  if (/^var\(--[^)]*\)$/.test(value)) return true;
  if (/^color-mix\(/i.test(value)) return true;
  return parseColor(value) !== undefined;
}

/**
 * Normalises an authored style object to the allowlist: kebab → camel, non-allowlisted keys dropped
 * and reported, numbers kept as numbers, strings kept as given (trimmed, `!important` stripped).
 * Purely numeric strings of unitless properties (opacity, fontWeight, zIndex, ...) become numbers.
 */
export function normalizeStyles(input: Record<string, unknown>): NormalizeResult {
  const styles: StyleMap = {};
  const ignored: string[] = [];
  const removed: string[] = [];
  const ignore = (s: string) => {
    if (!ignored.includes(s)) ignored.push(s);
  };

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = canonicalPropName(rawKey);
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      if (ALLOWED_STYLES.has(key)) removed.push(key);
      continue;
    }
    let value: StyleValue;
    if (typeof rawValue === "number") {
      if (!Number.isFinite(rawValue)) {
        ignore(key);
        continue;
      }
      value = rawValue;
    } else if (typeof rawValue === "string") {
      value = rawValue.trim().replace(/\s*!\s*important\s*$/i, "").trim();
      if (value === "") {
        if (ALLOWED_STYLES.has(key)) removed.push(key);
        continue;
      }
    } else {
      ignore(key);
      continue;
    }

    if (!safeCssValue(value)) {
      ignore(`${key} (unsafe value)`);
      continue;
    }

    if (/^margin/.test(key) || key === "marginInline" || key === "marginBlock") {
      if (!isZero(value)) ignore(key);
      continue;
    }

    if (key === "display") {
      const v = String(value).toLowerCase();
      const mapped = DISPLAY_MAP[v];
      if (!mapped) {
        ignore(`display: ${v}`);
        continue;
      }
      if (mapped.note) ignore(`display: ${v} (converted to ${mapped.to})`);
      styles.display = mapped.to;
      continue;
    }

    if (key === "position") {
      const v = String(value).toLowerCase();
      if (v === "static") continue;
      if (v === "relative" || v === "absolute") styles.position = v;
      else if (v === "fixed") {
        styles.position = "absolute";
        ignore("position: fixed (converted to absolute)");
      } else if (v === "sticky") {
        styles.position = "relative";
        ignore("position: sticky (converted to relative)");
      } else ignore(`position: ${v}`);
      continue;
    }

    if (key === "background" && typeof value === "string") {
      // Prefer editable longhands when the shorthand is a single colour or image layers only.
      if (isSingleColor(value)) {
        styles.backgroundColor = value;
        continue;
      }
      if (isImageLayers(value)) {
        styles.backgroundImage = value;
        continue;
      }
    }

    if (!ALLOWED_STYLES.has(key)) {
      ignore(key);
      continue;
    }

    if (typeof value === "string" && UNITLESS_PROPERTIES.has(key) && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(value)) {
      value = Number(value);
    }
    styles[key] = value;
  }
  return { styles, ignored, removed };
}

/** CSS text for one value: numbers become px unless the property is unitless. */
export function styleValueToCss(prop: string, value: StyleValue): string {
  if (typeof value === "number") {
    if (prop === "rotate") return `${value}deg`;
    if (UNITLESS_PROPERTIES.has(prop) || value === 0) return String(value);
    return `${value}px`;
  }
  return value;
}

/** StyleMap → "display: flex; gap: 16px" (kebab-case declarations). */
export function stylesToCss(styles: StyleMap): string {
  return Object.entries(styles)
    .filter(([k, v]) => /^[a-zA-Z][\w-]*$/.test(k) && safeCssValue(v))
    .map(([k, v]) => `${camelToKebab(k)}: ${styleValueToCss(k, v)}`)
    .join("; ");
}
