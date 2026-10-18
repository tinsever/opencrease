// Libraries (SPEC §4.9, P2): a file publishes its components and tokens; other files in the workspace
// subscribe and keep a copy, which they update when a newer version is published.
import type { Tx } from "./contracts";
import type { LibraryCopy } from "./component-types";
import { ComponentHooks, detachInstance } from "./components";
import { ModelError } from "./errors";
import { stableStringify } from "./hash";
import type { FoldDocument, NodeId, OFNode, Token } from "./types";

/** What a library file publishes (stored by the server next to the file as library.json). */
export interface LibrarySnapshot {
  fileId: string;
  name: string;
  version: number;
  publishedAt: number;
  componentIds: NodeId[];
  nodes: Record<NodeId, OFNode>;
  tokens: Token[];
  assets: FoldDocument["assets"];
}

export interface LibraryDiffEntry {
  id: string;
  name: string;
}

export interface LibraryDiff {
  components: { added: LibraryDiffEntry[]; changed: LibraryDiffEntry[]; removed: LibraryDiffEntry[] };
  tokens: { added: LibraryDiffEntry[]; changed: LibraryDiffEntry[]; removed: LibraryDiffEntry[] };
}

function copy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function collect(doc: FoldDocument, rootId: NodeId, into: Record<NodeId, OFNode>): void {
  const stack = [rootId];
  while (stack.length) {
    const n = doc.nodes[stack.pop()!];
    if (!n || into[n.id]) continue;
    into[n.id] = copy(n);
    stack.push(...n.children);
  }
}

/** Published roots: component sets and components that are not inside a set. */
function publishedRoots(doc: FoldDocument): OFNode[] {
  return Object.values(doc.nodes).filter((n) => {
    if (n.componentSet) return true;
    if (!n.component) return false;
    const parent = n.parentId ? doc.nodes[n.parentId] : undefined;
    return !parent?.componentSet;
  });
}

/**
 * Builds the publishable snapshot of a file: every component (with the components its instances need)
 * and every token. The version is one more than the last published version.
 */
export function buildLibrarySnapshot(doc: FoldDocument, now = Date.now()): LibrarySnapshot {
  const nodes: Record<NodeId, OFNode> = {};
  const roots = publishedRoots(doc);
  for (const root of roots) collect(doc, root.id, nodes);
  // pull in components used by nested instances even when they are not published roots
  let added = true;
  while (added) {
    added = false;
    for (const n of Object.values(nodes)) {
      if (n.instance && !n.instance.library && !nodes[n.instance.componentId] && doc.nodes[n.instance.componentId]) {
        collect(doc, n.instance.componentId, nodes);
        added = true;
      }
    }
  }
  for (const root of roots) nodes[root.id].parentId = null;
  for (const n of Object.values(nodes)) if (n.parentId && !nodes[n.parentId]) n.parentId = null;
  const assets: FoldDocument["assets"] = {};
  for (const n of Object.values(nodes)) {
    const hash = /^asset:\/\/([0-9a-f]+)/.exec(n.src ?? "")?.[1];
    if (hash && doc.assets[hash]) assets[hash] = copy(doc.assets[hash]);
  }
  return {
    fileId: doc.id,
    name: doc.name,
    version: (doc.library?.version ?? 0) + 1,
    publishedAt: now,
    componentIds: roots.map((r) => r.id),
    nodes,
    tokens: copy(doc.tokens),
    assets,
  };
}

/** Records that the file was published (call inside the transaction that follows a successful publish). */
export function markPublished(tx: Tx, snapshot: Pick<LibrarySnapshot, "version" | "publishedAt">): void {
  tx.doc.library = { version: snapshot.version, publishedAt: snapshot.publishedAt };
}

function componentEntries(nodes: Record<NodeId, OFNode>): Map<string, { name: string; json: string }> {
  const out = new Map<string, { name: string; json: string }>();
  for (const n of Object.values(nodes)) {
    if (!n.component) continue;
    const subtree: Record<NodeId, OFNode> = {};
    const stack = [n.id];
    while (stack.length) {
      const c = nodes[stack.pop()!];
      if (!c || subtree[c.id]) continue;
      subtree[c.id] = c;
      stack.push(...c.children);
    }
    const parent = n.parentId ? nodes[n.parentId] : undefined;
    const name = parent?.componentSet ? `${parent.name} ${Object.values(n.component.variant ?? {}).join("/") || n.name}` : n.name;
    out.set(n.id, { name, json: stableStringify(subtree) });
  }
  return out;
}

/** What changed between the copy a file holds and a newer snapshot. */
export function diffLibrary(current: Pick<LibraryCopy, "nodes" | "tokens"> | undefined, next: Pick<LibrarySnapshot, "nodes" | "tokens">): LibraryDiff {
  const diff: LibraryDiff = {
    components: { added: [], changed: [], removed: [] },
    tokens: { added: [], changed: [], removed: [] },
  };
  const before = componentEntries(current?.nodes ?? {});
  const after = componentEntries(next.nodes);
  for (const [id, e] of after) {
    const old = before.get(id);
    if (!old) diff.components.added.push({ id, name: e.name });
    else if (old.json !== e.json) diff.components.changed.push({ id, name: e.name });
  }
  for (const [id, e] of before) if (!after.has(id)) diff.components.removed.push({ id, name: e.name });
  const oldTokens = new Map((current?.tokens ?? []).map((t) => [t.name, t]));
  const newTokens = new Map(next.tokens.map((t) => [t.name, t]));
  for (const [name, t] of newTokens) {
    const old = oldTokens.get(name);
    if (!old) diff.tokens.added.push({ id: name, name });
    else if (old.value !== t.value || old.type !== t.type) diff.tokens.changed.push({ id: name, name });
  }
  for (const name of oldTokens.keys()) if (!newTokens.has(name)) diff.tokens.removed.push({ id: name, name });
  return diff;
}

export function diffIsEmpty(diff: LibraryDiff): boolean {
  return [diff.components, diff.tokens].every((g) => !g.added.length && !g.changed.length && !g.removed.length);
}

/**
 * Subscribes to a library, or updates the copy to a newer snapshot: stores the components, adds or updates
 * tokens with the same names (tokens removed from the library stay in the file) and regenerates every
 * instance of the library's components.
 */
export function applyLibrary(tx: Tx, snapshot: LibrarySnapshot): void {
  if (snapshot.fileId === tx.doc.id) throw new ModelError("invalid_argument", "A file cannot subscribe to itself");
  const libraries = (tx.doc.libraries ??= {});
  libraries[snapshot.fileId] = {
    name: snapshot.name,
    version: snapshot.version,
    publishedAt: snapshot.publishedAt,
    componentIds: [...snapshot.componentIds],
    nodes: copy(snapshot.nodes),
    tokens: copy(snapshot.tokens),
    assets: copy(snapshot.assets ?? {}),
  };
  for (const [hash, meta] of Object.entries(snapshot.assets ?? {})) if (!tx.doc.assets[hash]) tx.addAsset(meta);
  for (const t of snapshot.tokens) {
    const existing = tx.doc.tokens.find((o) => o.name === t.name);
    if (!existing) tx.createToken({ type: t.type, name: t.name, value: t.value, description: t.description });
    else if (existing.value !== t.value || existing.type !== t.type) tx.updateToken(existing.id, { type: t.type, value: t.value });
  }
  const hooks = (tx as unknown as { components?: ComponentHooks }).components;
  for (const n of Object.values(tx.doc.nodes)) {
    if (n.instance && n.source === undefined && n.instance.library === snapshot.fileId) hooks?.dirtyInstances.add(n.id);
  }
}

/** Removes a library copy. Instances of its components keep their layers and become detached. */
export function unsubscribeLibrary(tx: Tx, fileId: string): void {
  if (!tx.doc.libraries?.[fileId]) throw new ModelError("not_found", `This file does not use library ${fileId}`);
  for (const n of Object.values(tx.doc.nodes)) {
    if (n.instance && n.source === undefined && n.instance.library === fileId) {
      detachInstance(tx, n.id);
    }
  }
  delete tx.doc.libraries[fileId];
  if (Object.keys(tx.doc.libraries).length === 0) delete tx.doc.libraries;
}
