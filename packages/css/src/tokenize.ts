// Small helpers for splitting CSS text at top level (outside quotes, parens and comments).

/** Removes CSS comments outside strings. */
export function stripComments(css: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < css.length) {
        out += css[++i];
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Splits `text` on `isSep` characters that are outside quotes and parentheses.
 * Unquoted `url(` contents are treated as opaque (they may contain `;` or quotes).
 */
export function splitTopLevel(text: string, isSep: (ch: string) => boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "(" && /url$/i.test(text.slice(Math.max(0, i - 3), i))) {
      // unquoted url(...) is a single token up to the next ")"
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] !== '"' && text[j] !== "'") {
        const close = text.indexOf(")", j);
        if (close !== -1) {
          i = close;
          continue;
        }
      }
      depth++;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      if (depth > 0) depth--;
    } else if (ch === "\\") {
      i++;
    } else if (depth === 0 && isSep(ch)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Splits on top-level whitespace, dropping empty parts. "1px solid rgb(0 0 0)" → ["1px", "solid", "rgb(0 0 0)"]. */
export function splitSpaces(text: string): string[] {
  return splitTopLevel(text, (c) => /\s/.test(c)).filter((p) => p.length > 0);
}

/** Splits on top-level commas, trimming parts. */
export function splitCommas(text: string): string[] {
  return splitTopLevel(text, (c) => c === ",").map((p) => p.trim());
}

/** Index of the parenthesis matching the "(" at `open`, or -1. Respects quotes. */
export function matchParen(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
