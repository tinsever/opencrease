// Structural diff between two versions of a document (for oc_get_diff and the history panel).
// Pure: compares node fields, tokens, pages and briefs. Added and removed subtrees are reported once
// at their top node, with a descendant count, so a new section is one entry and not fifty.
import { artboardOf, pageOfNode } from "./queries";
import { stableStringify } from "./hash";
import type { FoldDocument, NodeId, NodeType, OFNode, StyleValue, Token } from "./types";

export interface ValueChange<T> {
  from: T | undefined;
  to: T | undefined;
}

export interface NodeRef {
  id: NodeId;
  name: string;
  type: NodeType;
  parentId: NodeId | null;
  /** artboard the node is in (itself for artboards), null for loose layers */
  artboardId: NodeId | null;
  pageId: string | null;
}

export interface AddedOrRemoved extends NodeRef {
  /** nodes inside this subtree that were added or removed with it */
  descendants: number;
}

export interface NodeChange extends NodeRef {
  styles?: Record<string, ValueChange<StyleValue>>;
  text?: ValueChange<string>;
  /** the layer name changed */
  rename?: ValueChange<string>;
  parent?: ValueChange<NodeId | null>;
  visible?: ValueChange<boolean>;
  locked?: ValueChange<boolean>;
  src?: ValueChange<string>;
  attrs?: Record<string, ValueChange<string>>;
  /** other fields that changed (shader, exports, tag, and fields added by newer versions) */
  other?: string[];
  /** the order of this node's children changed */
  reordered?: boolean;
}

export interface ArtboardSummary {
  id: NodeId;
  name: string;
  pageId: string | null;
  status: "added" | "removed" | "changed";
  added: number;
  removed: number;
  changed: number;
}

export interface DocDiff {
  empty: boolean;
  name?: ValueChange<string>;
  /** Optional document fields introduced by format extensions, e.g. library subscriptions. */
  metadata?: Record<string, ValueChange<unknown>>;
  added: AddedOrRemoved[];
  removed: AddedOrRemoved[];
  changed: NodeChange[];
  tokens: { added: Token[]; removed: Token[]; changed: Array<{ name: string; from: Partial<Token>; to: Partial<Token> }> };
  pages: { added: Array<{ id: string; name: string }>; removed: Array<{ id: string; name: string }>; renamed: Array<{ id: string; from: string; to: string }>; reordered: boolean };
  briefs: { added: number; removed: number; changed: number };
  artboards: ArtboardSummary[];
  /** every node id in `after` that is new or changed (for highlighting) */
  touchedIds: NodeId[];
  /** every node id in `before` that is gone */
  removedIds: NodeId[];
}

const BASE_FIELDS = new Set(["id", "type", "name", "parentId", "children", "visible", "locked", "styles", "text", "src", "attrs"]);
const same = (a: unknown, b: unknown) => a === b || stableStringify(a) === stableStringify(b);

function ref(doc: FoldDocument, node: OFNode): NodeRef {
  const board = node.type === "Root" ? undefined : artboardOf(doc, node.id);
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    parentId: node.parentId,
    artboardId: board?.id ?? null,
    pageId: pageOfNode(doc, node.id)?.id ?? null,
  };
}

function mapDiff<V>(a: Record<string, V> | undefined, b: Record<string, V> | undefined): Record<string, ValueChange<V>> | undefined {
  const out: Record<string, ValueChange<V>> = {};
  for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const x = a?.[k];
    const y = b?.[k];
    if (!same(x, y)) out[k] = { from: x, to: y };
  }
  return Object.keys(out).length ? out : undefined;
}

function countDescendants(doc: FoldDocument, id: NodeId): number {
  let n = 0;
  const stack = [...(doc.nodes[id]?.children ?? [])];
  while (stack.length) {
    const c = stack.pop()!;
    n++;
    stack.push(...(doc.nodes[c]?.children ?? []));
  }
  return n;
}

function diffNode(before: OFNode, after: OFNode, beforeDoc: FoldDocument, afterDoc: FoldDocument): NodeChange | null {
  const change: NodeChange = ref(afterDoc, after);
  let changed = false;
  const field = <K extends keyof NodeChange>(key: K, value: NodeChange[K] | undefined) => {
    if (value === undefined) return;
    change[key] = value;
    changed = true;
  };
  field("styles", mapDiff(before.styles, after.styles));
  if (before.text !== after.text) field("text", { from: before.text, to: after.text });
  if (before.name !== after.name) field("rename", { from: before.name, to: after.name });
  if (before.parentId !== after.parentId) field("parent", { from: before.parentId, to: after.parentId });
  if (before.visible !== after.visible) field("visible", { from: before.visible, to: after.visible });
  if (before.locked !== after.locked) field("locked", { from: before.locked, to: after.locked });
  if (before.src !== after.src) field("src", { from: before.src, to: after.src });
  field("attrs", mapDiff(before.attrs, after.attrs));
  const other: string[] = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (BASE_FIELDS.has(k)) continue;
    if (!same((before as unknown as Record<string, unknown>)[k], (after as unknown as Record<string, unknown>)[k])) other.push(k);
  }
  if (other.length) field("other", other.sort());
  const common = new Set(before.children.filter((c) => afterDoc.nodes[c] && after.children.includes(c)));
  const seqA = before.children.filter((c) => common.has(c));
  const seqB = after.children.filter((c) => common.has(c));
  if (!same(seqA, seqB)) field("reordered", true);
  void beforeDoc;
  return changed ? change : null;
}

function tokenDiff(a: Token[], b: Token[]): DocDiff["tokens"] {
  const byA = new Map(a.map((t) => [t.id || t.name, t]));
  const byB = new Map(b.map((t) => [t.id || t.name, t]));
  const out: DocDiff["tokens"] = { added: [], removed: [], changed: [] };
  for (const [k, t] of byB) if (!byA.has(k)) out.added.push(t);
  for (const [k, t] of byA) if (!byB.has(k)) out.removed.push(t);
  for (const [k, t] of byB) {
    const prev = byA.get(k);
    if (!prev || same(prev, t)) continue;
    const from: Partial<Token> = {};
    const to: Partial<Token> = {};
    for (const f of ["name", "type", "value", "description"] as const) {
      if (!same(prev[f], t[f])) {
        (from as Record<string, unknown>)[f] = prev[f];
        (to as Record<string, unknown>)[f] = t[f];
      }
    }
    out.changed.push({ name: t.name, from, to });
  }
  return out;
}

export function diffDocuments(before: FoldDocument, after: FoldDocument): DocDiff {
  const added: AddedOrRemoved[] = [];
  const removed: AddedOrRemoved[] = [];
  const changed: NodeChange[] = [];
  const touched: NodeId[] = [];
  const removedIds: NodeId[] = [];

  for (const node of Object.values(after.nodes)) {
    const prev = before.nodes[node.id];
    if (!prev) {
      touched.push(node.id);
      if (node.type === "Root") continue;
      // report only the top of an added subtree
      if (node.parentId && !before.nodes[node.parentId] && after.nodes[node.parentId]?.type !== "Root") continue;
      added.push({ ...ref(after, node), descendants: countDescendants(after, node.id) });
      continue;
    }
    if (node === prev) continue;
    const c = diffNode(prev, node, before, after);
    if (c) {
      changed.push(c);
      if (c.styles || c.text || c.rename || c.parent || c.visible || c.locked || c.src || c.attrs || c.other || c.reordered) touched.push(node.id);
    }
  }
  for (const node of Object.values(before.nodes)) {
    if (after.nodes[node.id]) continue;
    removedIds.push(node.id);
    if (node.type === "Root") continue;
    if (node.parentId && !after.nodes[node.parentId] && before.nodes[node.parentId]?.type !== "Root") continue;
    removed.push({ ...ref(before, node), descendants: countDescendants(before, node.id) });
  }

  const pages: DocDiff["pages"] = { added: [], removed: [], renamed: [], reordered: false };
  for (const p of Object.values(after.pages)) {
    const prev = before.pages[p.id];
    if (!prev) pages.added.push({ id: p.id, name: p.name });
    else if (prev.name !== p.name) pages.renamed.push({ id: p.id, from: prev.name, to: p.name });
  }
  for (const p of Object.values(before.pages)) if (!after.pages[p.id]) pages.removed.push({ id: p.id, name: p.name });
  const order = (d: FoldDocument) => d.pageList.filter((i) => before.pages[i.id] && after.pages[i.id]).map((i) => i.id);
  pages.reordered = !same(order(before), order(after));

  const briefsA = new Map((before.briefs ?? []).map((b) => [b.id, b]));
  const briefsB = new Map((after.briefs ?? []).map((b) => [b.id, b]));
  const briefs = {
    added: [...briefsB.keys()].filter((k) => !briefsA.has(k)).length,
    removed: [...briefsA.keys()].filter((k) => !briefsB.has(k)).length,
    changed: [...briefsB].filter(([k, b]) => briefsA.has(k) && !same(briefsA.get(k), b)).length,
  };

  const tokens = tokenDiff(before.tokens, after.tokens);
  const known = new Set(["formatVersion", "id", "name", "createdAt", "updatedAt", "clock", "clientId", "nodes", "tokens", "pages", "pageList", "briefs"]);
  const extensions = (doc: FoldDocument) => Object.fromEntries(Object.entries(doc).filter(([key]) => !known.has(key)));
  const metadata = mapDiff(extensions(before), extensions(after));

  // per-artboard summary
  const boards = new Map<NodeId, ArtboardSummary>();
  const bump = (doc: FoldDocument, boardId: NodeId | null, key: "added" | "removed" | "changed") => {
    if (!boardId) return;
    let s = boards.get(boardId);
    if (!s) {
      const node = doc.nodes[boardId];
      s = { id: boardId, name: node?.name ?? boardId, pageId: pageOfNode(doc, boardId)?.id ?? null, status: "changed", added: 0, removed: 0, changed: 0 };
      boards.set(boardId, s);
    }
    s[key]++;
  };
  for (const a of added) {
    if (a.artboardId === a.id) {
      bump(after, a.id, "added");
      boards.get(a.id)!.status = "added";
    } else bump(after, a.artboardId, "added");
  }
  for (const r of removed) {
    if (r.artboardId === r.id) {
      bump(before, r.id, "removed");
      boards.get(r.id)!.status = "removed";
    } else bump(after.nodes[r.artboardId ?? ""] ? after : before, r.artboardId, "removed");
  }
  for (const c of changed) bump(after, c.artboardId, "changed");

  const name = before.name !== after.name ? { from: before.name, to: after.name } : undefined;
  const empty =
    !name &&
    !metadata &&
    !added.length &&
    !removed.length &&
    !changed.length &&
    !tokens.added.length &&
    !tokens.removed.length &&
    !tokens.changed.length &&
    !pages.added.length &&
    !pages.removed.length &&
    !pages.renamed.length &&
    !pages.reordered &&
    !briefs.added &&
    !briefs.removed &&
    !briefs.changed;

  const out: DocDiff = { empty, added, removed, changed, tokens, pages, briefs, artboards: [...boards.values()], touchedIds: touched, removedIds };
  if (metadata) out.metadata = metadata;
  if (name) out.name = name;
  return out;
}

/** One-paragraph human summary, e.g. "3 layers added, 5 changed in Hero; 1 token changed." */
export function summarizeDiff(diff: DocDiff): string {
  if (diff.empty) return "No changes.";
  const parts: string[] = [];
  if (diff.metadata) parts.push(`File metadata changed: ${Object.keys(diff.metadata).join(", ")}`);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  for (const b of diff.artboards) {
    if (b.status === "added") parts.push(`"${b.name}" added`);
    else if (b.status === "removed") parts.push(`"${b.name}" removed`);
    else {
      const bits = [b.added && `${b.added} added`, b.removed && `${b.removed} removed`, b.changed && `${b.changed} changed`].filter(Boolean).join(", ");
      parts.push(`"${b.name}": ${bits}`);
    }
  }
  const loose = diff.added.filter((a) => !a.artboardId).length + diff.removed.filter((r) => !r.artboardId).length + diff.changed.filter((c) => !c.artboardId && c.type !== "Root").length;
  if (loose) parts.push(plural(loose, "loose layer change"));
  const t = diff.tokens.added.length + diff.tokens.removed.length + diff.tokens.changed.length;
  if (t) parts.push(plural(t, "token change"));
  const p = diff.pages.added.length + diff.pages.removed.length + diff.pages.renamed.length + (diff.pages.reordered ? 1 : 0);
  if (p) parts.push(plural(p, "page change"));
  if (diff.name) parts.push(`file renamed to "${diff.name.to}"`);
  const b = diff.briefs.added + diff.briefs.changed + diff.briefs.removed;
  if (b) parts.push(plural(b, "brief change"));
  return `${parts.join("; ")}.`;
}
