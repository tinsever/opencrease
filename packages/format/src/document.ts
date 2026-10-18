import { newFileId, nextPageId, rootIdFor } from "./ids";
import { FORMAT_VERSION } from "./version";
import type { FoldDocument, OFNode, PageIcon, PageId } from "./types";

export interface CreateDocumentOptions {
  id?: string;
  clientId?: string;
  now?: number;
}

/** A new document with one page ("Page 1") and its Root node. */
export function createDocument(name: string, opts: CreateDocumentOptions = {}): FoldDocument {
  const now = opts.now ?? Date.now();
  const doc: FoldDocument = {
    formatVersion: FORMAT_VERSION,
    id: opts.id ?? newFileId(now),
    name: name.trim() || "Untitled",
    createdAt: now,
    updatedAt: now,
    pageList: [],
    pages: {},
    nodes: {},
    tokens: [],
    assets: {},
    clock: 0,
    clientId: opts.clientId ?? "0",
  };
  addPage(doc, "Page 1", null);
  return doc;
}

export function createRootNode(id: string): OFNode {
  return { id, type: "Root", name: "Root", parentId: null, children: [], visible: true, locked: false, styles: {} };
}

/** Adds a page and its Root node; inserted after `afterPageId` in the page list, or appended. Mutates `doc`. */
export function addPage(doc: FoldDocument, name: string, icon: PageIcon | null, afterPageId?: PageId): PageId {
  const id = nextPageId(doc);
  const rootId = rootIdFor(id);
  doc.nodes[rootId] = createRootNode(rootId);
  doc.pages[id] = { id, name, icon, rootId };
  const after = afterPageId === undefined ? -1 : doc.pageList.findIndex((i) => i.type === "page" && i.id === afterPageId);
  const item = { type: "page" as const, id };
  if (after === -1) doc.pageList.push(item);
  else doc.pageList.splice(after + 1, 0, item);
  return id;
}
