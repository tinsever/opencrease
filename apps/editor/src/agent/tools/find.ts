// find_nodes: match nodes by authored style and/or text. Pure.
import { canonicalPropName, camelToKebab, colorsEqual, findColorsInValue, parseColor, styleValueToCss } from "@opencrease/css";
import {
  descendants, getNode, getPage, listPages, parseAlias, resolveToken, varReferences,
  type FoldDocument, type NodeId, type OFNode, type StyleValue,
} from "@opencrease/model";
import { globMatch, hasWildcard } from "../match";

export interface StyleFilter {
  styleName?: string;
  styleValue?: string;
}

export type Matched = { styleName: string; styleValue: string } | { textValue: string };

export interface FoundNode {
  id: NodeId;
  name: string;
  component: string;
  matched: Matched[];
}

function nameMatches(pattern: string | undefined, key: string): boolean {
  if (!pattern) return true;
  const p = pattern.trim();
  if (hasWildcard(p)) return globMatch(p, key) || globMatch(p, camelToKebab(key));
  return canonicalPropName(p) === key;
}

/** Token name if the query is a token reference ("--x" or "var(--x)"). */
function tokenQuery(q: string): string | undefined {
  const t = q.trim();
  if (/^--[A-Za-z0-9_-]+$/.test(t)) return t;
  return parseAlias(t)?.name;
}

/** Returns the matched fragment of `value` for the query, or undefined. */
function valueMatches(doc: FoldDocument, query: string | undefined, key: string, value: StyleValue): string | undefined {
  const css = styleValueToCss(key, value);
  if (query === undefined || query === "") return css;
  const q = query.trim();
  const token = tokenQuery(q);
  if (token) {
    if (hasWildcard(token)) {
      const ref = varReferences(css).find((r) => globMatch(token, r));
      return ref ? `var(${ref})` : undefined;
    }
    return varReferences(css).includes(token) ? `var(${token})` : undefined;
  }
  if (hasWildcard(q)) return globMatch(q, css) ? css : undefined;
  if (parseColor(q)) {
    if (parseColor(css) && colorsEqual(q, css)) return css;
    const literal = findColorsInValue(css).find((c) => colorsEqual(q, c));
    if (literal) return literal;
    for (const ref of varReferences(css)) {
      const resolved = resolveToken(doc, ref);
      if (typeof resolved === "string" && parseColor(resolved) && colorsEqual(q, resolved)) return `var(${ref})`;
    }
    return undefined;
  }
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  if (norm(css) === norm(q)) return css;
  if (typeof value === "number" && norm(q) === `${value}px`) return css;
  return undefined;
}

function textMatches(pattern: string, text: string): boolean {
  if (hasWildcard(pattern)) return globMatch(pattern, text);
  return text.trim().toLowerCase() === pattern.trim().toLowerCase();
}

export function findNodes(
  doc: FoldDocument,
  query: { filters?: StyleFilter[]; textValue?: string; pageId?: string; nodeId?: string },
): FoundNode[] {
  let pool: OFNode[];
  if (query.nodeId) {
    const start = getNode(doc, query.nodeId);
    pool = start ? [start, ...descendants(doc, start.id)] : [];
  } else {
    const pages = query.pageId ? [getPage(doc, query.pageId)].filter((p) => p !== undefined) : listPages(doc);
    pool = pages.flatMap((p) => descendants(doc, p.rootId));
  }
  const filters = query.filters ?? [];
  const out: FoundNode[] = [];
  for (const node of pool) {
    if (node.type === "Root") continue;
    const matched: Matched[] = [];
    let ok = true;
    for (const f of filters) {
      let hit: Matched | undefined;
      for (const [key, value] of Object.entries(node.styles)) {
        if (!nameMatches(f.styleName, key)) continue;
        const frag = valueMatches(doc, f.styleValue, key, value);
        if (frag !== undefined) {
          hit = { styleName: key, styleValue: frag };
          break;
        }
      }
      if (!hit) {
        ok = false;
        break;
      }
      matched.push(hit);
    }
    if (!ok) continue;
    if (query.textValue !== undefined) {
      if (node.type !== "Text" || !textMatches(query.textValue, node.text ?? "")) continue;
      matched.push({ textValue: node.text ?? "" });
    }
    if (filters.length === 0 && query.textValue === undefined) continue;
    out.push({ id: node.id, name: node.name, component: node.type, matched });
  }
  return out;
}
