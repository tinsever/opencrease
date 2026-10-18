// On-demand Google Fonts loading for font families used in a document.
import { resolveToken, type FoldDocument, type OFNode } from "@opencrease/model";
import { familyInfo, fontMeta, loadFontMeta, variableFontQuery } from "./font-meta";
import { isSystemFamily } from "../desktop/desktop";

const GENERIC = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif",
  "ui-monospace", "ui-rounded", "emoji", "math", "fangsong", "inherit", "initial", "unset", "revert",
  "-apple-system", "blinkmacsystemfont",
]);

/** Families that never come from Google Fonts (bundled with the editor or installed everywhere). */
const LOCAL = new Set([
  "geist", "geist variable", "geist mono", "geist mono variable", "arial", "helvetica", "helvetica neue",
  "times", "times new roman", "georgia", "courier", "courier new", "verdana", "tahoma", "trebuchet ms",
  "menlo", "monaco", "consolas", "sf pro", "sf pro text", "sf pro display", "sf mono", "segoe ui",
  "apple color emoji", "segoe ui emoji", "noto color emoji",
]);

function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "").trim();
}

/** Resolve `var(--x)` (whole value) through document tokens. */
function resolveValue(doc: FoldDocument, value: string | number | undefined): string | number | undefined {
  if (typeof value === "string" && /^var\(/.test(value.trim())) return resolveToken(doc, value.trim()) ?? undefined;
  return value;
}

/** Families listed in a font-family value that may be Google Fonts (generic and local ones removed). */
export function webFamilies(fontFamily: string): string[] {
  return fontFamily
    .split(",")
    .map(unquote)
    .filter((f) => f && !f.startsWith("var(") && !GENERIC.has(f.toLowerCase()) && !LOCAL.has(f.toLowerCase()) && !isSystemFamily(f));
}

function weightOf(v: string | number | undefined): number {
  if (typeof v === "number") return Math.round(v);
  if (v === "bold" || v === "bolder") return 700;
  if (v === "lighter") return 300;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 400;
}

/** family → set of "ital,wght" variants (e.g. "0,400") used in the document. */
export function collectFontUsage(doc: FoldDocument): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (family: string, variant: string) => {
    let set = out.get(family);
    if (!set) out.set(family, (set = new Set()));
    set.add(variant);
  };
  const visit = (node: OFNode, inherited: { family?: string; weight: number; italic: boolean }) => {
    const famRaw = resolveValue(doc, node.styles.fontFamily);
    const family = typeof famRaw === "string" ? famRaw : inherited.family;
    const wRaw = resolveValue(doc, node.styles.fontWeight);
    const weight = wRaw !== undefined ? weightOf(wRaw) : inherited.weight;
    const style = node.styles.fontStyle;
    const italic = style !== undefined ? style === "italic" || style === "oblique" : inherited.italic;
    const ctx = { family, weight, italic };
    if (node.type === "Text" && family) {
      for (const f of webFamilies(family)) add(f, `${italic ? 1 : 0},${weight}`);
    }
    for (const id of node.children) {
      const child = doc.nodes[id];
      if (child) visit(child, ctx);
    }
  };
  for (const page of Object.values(doc.pages)) {
    const root = doc.nodes[page.rootId];
    if (root) visit(root, { weight: 400, italic: false });
  }
  for (const t of doc.tokens) {
    if (t.type === "fontFamily" && typeof t.value === "string") for (const f of webFamilies(t.value)) add(f, "0,400");
  }
  return out;
}

/** css2 URL for one family. Without variants, the default (regular) style is requested. */
export function googleFontsUrl(family: string, variants?: Iterable<string>): string {
  const name = encodeURIComponent(family).replace(/%20/g, "+");
  const list = variants ? [...new Set(variants)] : [];
  if (list.length === 0) return `https://fonts.googleapis.com/css2?family=${name}&display=swap`;
  list.sort((a, b) => {
    const [ia, wa] = a.split(",").map(Number);
    const [ib, wb] = b.split(",").map(Number);
    return ia - ib || wa - wb;
  });
  return `https://fonts.googleapis.com/css2?family=${name}:ital,wght@${list.join(";")}&display=swap`;
}

/** The same stylesheet through the server's caching proxy (works offline for fonts used before). */
export function proxiedFontsUrl(url: string): string {
  return url.replace(/^https:\/\/fonts\.googleapis\.com\//, "/api/fonts/");
}

// ------------------------------------------------------------------ DOM side

const requested = new Map<string, string>(); // family → variant key last requested
/** Families the user picked from their installed fonts: never requested from Google. */
export const localFamilies = new Set<string>();
let lastDoc: FoldDocument | null = null;

function addLink(family: string, href: string, fallback?: string) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.ofFont = family;
  if (fallback) {
    link.onerror = () => {
      link.remove();
      addLink(family, fallback);
    };
  }
  document.head.appendChild(link);
}

/**
 * Ensure every Google family used in the document has a stylesheet, loaded through the server's font
 * cache. Variable families (known from the metadata) load their full axis ranges, so any weight, the
 * variation sliders and automatic optical sizing work; others load the static weights in use. When a
 * request fails (a missing weight), it is retried with the family's default style only.
 */
export function ensureDocumentFonts(doc: FoldDocument): void {
  if (typeof document === "undefined") return;
  lastDoc = doc;
  const meta = fontMeta();
  if (meta.status === "idle") void loadFontMeta().then(() => lastDoc && ensureDocumentFonts(lastDoc));
  const settled = meta.status === "ready" || meta.status === "error";
  for (const [family, variants] of collectFontUsage(doc)) {
    if (localFamilies.has(family.toLowerCase())) continue;
    const info = familyInfo(family);
    const variable = info && info.axes.length > 0;
    if (!variable && !settled) continue; // wait for the metadata so the variable version is not loaded twice
    const italic = [...variants].some((v) => v.startsWith("1,"));
    const key = variable ? `variable:${italic ? 1 : 0}` : [...variants].sort().join(";");
    const prev = requested.get(family);
    if (prev !== undefined) {
      if (variable ? prev === key || (prev === "variable:1" && !italic) : !prev.startsWith("variable") && [...variants].every((v) => prev.split(";").includes(v))) continue;
    }
    if (variable) {
      requested.set(family, key);
      addLink(family, `/api/fonts/css2?${variableFontQuery(info, italic)}`, proxiedFontsUrl(googleFontsUrl(family)));
      continue;
    }
    const merged = new Set([...(prev && !prev.startsWith("variable") ? prev.split(";") : []), ...variants]);
    requested.set(family, [...merged].sort().join(";"));
    addLink(family, proxiedFontsUrl(googleFontsUrl(family, merged)), proxiedFontsUrl(googleFontsUrl(family)));
  }
}
