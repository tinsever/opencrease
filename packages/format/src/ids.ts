import type { FoldDocument, NodeId, PageId } from "./types";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 26-char Crockford base32 ULID: 48-bit millisecond timestamp + 80 random bits. */
export function newFileId(now: number = Date.now()): string {
  let time = "";
  let t = Math.max(0, Math.floor(now));
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let rand = "";
  for (const b of bytes) rand += CROCKFORD[b & 31];
  return time + rand;
}

function tick(doc: FoldDocument): string {
  doc.clock += 1;
  return doc.clock.toString(36).toUpperCase();
}

/** Allocates `<counter-base36>-<clientId>`, bumping `doc.clock`. Skips ids already in use. */
export function nextNodeId(doc: FoldDocument): NodeId {
  let id: NodeId;
  do id = `${tick(doc)}-${doc.clientId}`;
  while (id in doc.nodes);
  return id;
}

export function nextPageId(doc: FoldDocument): PageId {
  let id: PageId;
  do id = `p-${tick(doc)}-${doc.clientId}`;
  while (id in doc.pages || rootIdFor(id) in doc.nodes);
  return id;
}

export function nextTokenId(doc: FoldDocument): string {
  let id: string;
  do id = `t-${tick(doc)}-${doc.clientId}`;
  while (doc.tokens.some((t) => t.id === id));
  return id;
}

export function nextDividerId(doc: FoldDocument): string {
  let id: string;
  do id = `d-${tick(doc)}-${doc.clientId}`;
  while (doc.pageList.some((item) => item.id === id));
  return id;
}

/** Ids of mode collections (`m-…`) and text styles (`s-…`). */
export function nextPrefixedId(doc: FoldDocument, prefix: "m" | "s", taken: readonly { id: string }[]): string {
  let id: string;
  do id = `${prefix}-${tick(doc)}-${doc.clientId}`;
  while (taken.some((x) => x.id === id));
  return id;
}

export function rootIdFor(pageId: PageId): NodeId {
  return `root_${pageId}`;
}

/** Highest clock value encoded in any generated id of the document (used to repair `clock` on load). */
export function maxClockInIds(doc: Pick<FoldDocument, "nodes" | "pages" | "tokens" | "pageList" | "modeCollections" | "textStyles">): number {
  let max = 0;
  const consider = (n: string | undefined) => {
    if (!n) return;
    const v = parseInt(n, 36);
    if (Number.isFinite(v) && v > max) max = v;
  };
  for (const id of Object.keys(doc.nodes)) consider(/^([0-9A-Z]+)-/.exec(id)?.[1]);
  for (const id of Object.keys(doc.pages)) consider(/^p-([0-9A-Za-z]+)-/.exec(id)?.[1]);
  for (const t of doc.tokens) consider(/^t-([0-9A-Za-z]+)-/.exec(t.id)?.[1]);
  for (const item of doc.pageList) consider(/^d-([0-9A-Za-z]+)-/.exec(item.id)?.[1]);
  for (const x of [...(doc.modeCollections ?? []), ...(doc.textStyles ?? [])]) consider(/^[ms]-([0-9A-Za-z]+)-/.exec(x.id)?.[1]);
  return max;
}
