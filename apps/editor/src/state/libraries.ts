// Libraries (SPEC §4.9, P2): publish this file's components and tokens, subscribe from other files in the
// workspace, and notice when a subscribed library has a newer version.
import {
  applyLibrary, buildLibrarySnapshot, diffLibrary, markPublished, unsubscribeLibrary,
  type LibraryDiff, type LibrarySnapshot,
} from "@opencrease/model";
import { showNotice, tryAction } from "../ui/Notice";
import { getOpenFile } from "./workspace";

export interface LibraryListing {
  fileId: string;
  name: string;
  version: number;
  publishedAt: number;
  componentCount: number;
  tokenCount: number;
}

export interface LibraryUpdate {
  libId: string;
  name: string;
  from: number;
  to: number;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || `${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

const enc = encodeURIComponent;
const post = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const libraryApi = {
  list: () => fetch("/api/libraries").then((r) => json<LibraryListing[]>(r)),
  get: (fileId: string) => fetch(`/api/files/${enc(fileId)}/library`).then((r) => json<LibrarySnapshot>(r)),
  publish: (snap: LibrarySnapshot) => fetch(`/api/files/${enc(snap.fileId)}/library`, post("PUT", snap)).then((r) => json<{ version: number; publishedAt: number }>(r)),
  copyAssets: (libId: string, to: string) => fetch(`/api/files/${enc(libId)}/library/copy-assets`, post("POST", { to })).then((r) => json<{ copied: number }>(r)),
};

// ------------------------------------------------------------------ update state (per open file)

let updates: Record<string, LibraryUpdate[]> = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function subscribeUpdates(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getUpdates(): Record<string, LibraryUpdate[]> {
  return updates;
}

function setUpdates(fileId: string, list: LibraryUpdate[]) {
  const prev = updates[fileId] ?? [];
  if (prev.length === list.length && prev.every((u, i) => u.libId === list[i].libId && u.to === list[i].to)) return;
  updates = { ...updates, [fileId]: list };
  emit();
}

/** Compares the libraries a file uses with the published versions. */
export async function checkLibraryUpdates(fileId: string, listing?: LibraryListing[]): Promise<LibraryUpdate[]> {
  const doc = getOpenFile(fileId)?.store.doc;
  const used = Object.entries(doc?.libraries ?? {});
  if (!used.length) {
    setUpdates(fileId, []);
    return [];
  }
  const published = listing ?? (await libraryApi.list());
  const list: LibraryUpdate[] = [];
  for (const [libId, copy] of used) {
    const p = published.find((l) => l.fileId === libId);
    if (p && p.version > copy.version) list.push({ libId, name: p.name, from: copy.version, to: p.version });
  }
  setUpdates(fileId, list);
  return list;
}

// ------------------------------------------------------------------ actions

export async function publishLibrary(fileId: string): Promise<void> {
  const file = getOpenFile(fileId);
  if (!file) return;
  const snap = buildLibrarySnapshot(file.store.doc);
  if (!snap.componentIds.length && !snap.tokens.length) return showNotice("Nothing to publish yet. Create a component or a token first.");
  try {
    const saved = await libraryApi.publish(snap);
    file.store.transact("Publish library", (tx) => markPublished(tx, saved));
    const n = snap.componentIds.length;
    showNotice(`Published version ${saved.version}: ${n} ${n === 1 ? "component" : "components"}, ${snap.tokens.length} ${snap.tokens.length === 1 ? "token" : "tokens"}`);
  } catch (e) {
    showNotice(`Could not publish: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Subscribes to a library, or updates the copy to its latest version. */
export async function subscribeToLibrary(fileId: string, libId: string): Promise<boolean> {
  const file = getOpenFile(fileId);
  if (!file) return false;
  try {
    const snap = await libraryApi.get(libId);
    if (Object.keys(snap.assets ?? {}).length) await libraryApi.copyAssets(libId, fileId);
    const had = !!file.store.doc.libraries?.[libId];
    const ok = tryAction(() => {
      file.store.transact(had ? "Update library" : "Use library", (tx) => applyLibrary(tx, snap));
      return true;
    });
    if (!ok) return false;
    showNotice(had ? `Updated ${snap.name} to version ${snap.version}` : `Using ${snap.name} in this file`);
    void checkLibraryUpdates(fileId);
    return true;
  } catch (e) {
    showNotice(`Could not load the library: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export function stopUsingLibrary(fileId: string, libId: string): void {
  const file = getOpenFile(fileId);
  if (!file) return;
  tryAction(() => file.store.transact("Remove library", (tx) => unsubscribeLibrary(tx, libId)));
  void checkLibraryUpdates(fileId);
}

/** What changed in a library since the copy this file holds. */
export async function reviewLibraryChanges(fileId: string, libId: string): Promise<{ snapshot: LibrarySnapshot; diff: LibraryDiff }> {
  const snapshot = await libraryApi.get(libId);
  const current = getOpenFile(fileId)?.store.doc.libraries?.[libId];
  return { snapshot, diff: diffLibrary(current, snapshot) };
}
