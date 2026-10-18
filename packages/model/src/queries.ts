import { ModelError } from "./errors";
import { normalizeTokenName, parseAlias } from "./tokens";
import type { Queries } from "./contracts";
import type { FoldDocument, NodeId, OFNode, Page, PageId, Token } from "./types";

export function getNode(doc: FoldDocument, id: NodeId): OFNode | undefined {
  return Object.prototype.hasOwnProperty.call(doc.nodes, id) ? doc.nodes[id] : undefined;
}

export function getPage(doc: FoldDocument, id: PageId): Page | undefined {
  return Object.prototype.hasOwnProperty.call(doc.pages, id) ? doc.pages[id] : undefined;
}

/** Ordered pages (dividers skipped). */
export function listPages(doc: FoldDocument): Page[] {
  const pages: Page[] = [];
  for (const item of doc.pageList) {
    if (item.type !== "page") continue;
    const page = getPage(doc, item.id);
    if (page) pages.push(page);
  }
  return pages;
}

/** Nearest first, ending with the page Root. */
export function ancestors(doc: FoldDocument, id: NodeId): OFNode[] {
  const out: OFNode[] = [];
  const seen = new Set<NodeId>([id]);
  let parentId = getNode(doc, id)?.parentId ?? null;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = getNode(doc, parentId);
    if (!parent) break;
    out.push(parent);
    seen.add(parentId);
    parentId = parent.parentId;
  }
  return out;
}

/** Depth-first (pre-order), excluding `id` itself. */
export function descendants(doc: FoldDocument, id: NodeId): OFNode[] {
  const out: OFNode[] = [];
  const seen = new Set<NodeId>([id]);
  const walk = (nodeId: NodeId) => {
    const node = getNode(doc, nodeId);
    if (!node) return;
    for (const childId of node.children) {
      const child = getNode(doc, childId);
      if (!child || seen.has(childId)) continue;
      seen.add(childId);
      out.push(child);
      walk(childId);
    }
  };
  walk(id);
  return out;
}

/** True when `ancestorId` is a strict ancestor of `id`. */
export function isAncestor(doc: FoldDocument, ancestorId: NodeId, id: NodeId): boolean {
  return ancestorId !== id && ancestors(doc, id).some((n) => n.id === ancestorId);
}

function rootOf(doc: FoldDocument, id: NodeId): OFNode | undefined {
  const node = getNode(doc, id);
  if (!node) return undefined;
  if (node.parentId === null) return node;
  return ancestors(doc, id).at(-1);
}

export function pageOfNode(doc: FoldDocument, id: NodeId): Page | undefined {
  const root = rootOf(doc, id);
  if (!root || root.type !== "Root") return undefined;
  return Object.values(doc.pages).find((p) => p.rootId === root.id);
}

export function isArtboard(doc: FoldDocument, node: OFNode): boolean {
  return node.type === "Frame" && node.parentId !== null && getNode(doc, node.parentId)?.type === "Root";
}

/** The top-level Frame under the page Root that contains `id` (or `id` itself when it is an artboard). */
export function artboardOf(doc: FoldDocument, id: NodeId): OFNode | undefined {
  const node = getNode(doc, id);
  if (!node) return undefined;
  for (const n of [node, ...ancestors(doc, id)]) {
    if (n.parentId !== null && getNode(doc, n.parentId)?.type === "Root") return n.type === "Frame" ? n : undefined;
  }
  return undefined;
}

export function artboards(doc: FoldDocument, pageId: PageId): OFNode[] {
  const page = getPage(doc, pageId);
  const root = page && getNode(doc, page.rootId);
  if (!root) return [];
  return root.children.map((id) => getNode(doc, id)).filter((n): n is OFNode => n?.type === "Frame");
}

export function findToken(doc: FoldDocument, nameOrId: string): Token | undefined {
  const name = normalizeTokenName(nameOrId);
  return doc.tokens.find((t) => t.id === nameOrId) ?? doc.tokens.find((t) => t.name === name);
}

/**
 * Final value of a token, following whole-value `var(--x)` aliases. Accepts "--x", "x" or "var(--x)".
 * Returns the alias fallback when the target is missing, and undefined for unknown tokens or cycles.
 */
export function resolveToken(doc: FoldDocument, name: string): string | number | undefined {
  const start = parseAlias(name)?.name ?? normalizeTokenName(name);
  const seen = new Set<string>();
  let current = start;
  let fallback: string | undefined;
  while (!seen.has(current)) {
    seen.add(current);
    const token = doc.tokens.find((t) => t.name === current);
    if (!token) return current === start ? undefined : fallback;
    const alias = parseAlias(token.value);
    if (!alias) return token.value;
    fallback = alias.fallback;
    current = alias.name;
  }
  return undefined;
}

const PREVIEW_LENGTH = 40;

function quote(s: string): string {
  return JSON.stringify(s);
}

function fmtSize(n: number): string {
  return String(Math.round(n));
}

/**
 * Paper-style indented outline, two spaces per level:
 *   Frame "Hero" (9X-0) 1440×640
 *     Text "Headline" (A0-0) 272×76 "Fired slow."
 * Sizes come from `measure` (`?×?` when it returns null, omitted without `measure`).
 * Children beyond `depth` levels are summarised as `... N children`.
 */
export function treeSummary(
  doc: FoldDocument,
  id: NodeId,
  depth: number,
  measure?: (id: NodeId) => { width: number; height: number } | null,
): string {
  if (!getNode(doc, id)) throw new ModelError("not_found", `Node ${id} not found`);
  const lines: string[] = [];
  const walk = (nodeId: NodeId, level: number) => {
    const node = getNode(doc, nodeId);
    if (!node) return;
    const indent = "  ".repeat(level);
    const kind = node.instance ? "Instance" : node.component ? "Component" : node.componentSet ? "ComponentSet" : node.type;
    let line = `${indent}${kind} ${quote(node.name)} (${node.id})`;
    if (measure) {
      const size = measure(node.id);
      line += size ? ` ${fmtSize(size.width)}×${fmtSize(size.height)}` : " ?×?";
    }
    if (node.instance) {
      const store = node.instance.library ? doc.libraries?.[node.instance.library]?.nodes : doc.nodes;
      const main = store?.[node.instance.componentId];
      line += main ? ` of ${quote(main.name)} (${main.id})` : " of a missing component";
    }
    if (node.type === "Text") {
      const text = (node.text ?? "").replace(/\s+/g, " ").trim();
      line += ` ${quote(text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text)}`;
    }
    lines.push(line);
    const children = node.children.filter((c) => getNode(doc, c));
    if (children.length === 0) return;
    if (level >= depth) {
      lines.push(`${indent}  ... ${children.length} ${children.length === 1 ? "child" : "children"}`);
      return;
    }
    for (const childId of children) walk(childId, level + 1);
  };
  walk(id, 0);
  return lines.join("\n");
}

/** All queries as one object, checked against the `Queries` contract. */
export const queries = {
  getNode, pageOfNode, artboardOf, ancestors, descendants, isAncestor, artboards, treeSummary, resolveToken,
} satisfies Queries;
