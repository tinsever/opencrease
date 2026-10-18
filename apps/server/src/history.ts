// Version history per file (SPEC M4): numbered snapshots in <file>.fold/history/.
//   history/index.json   { versions: [{ version, createdAt, name?, source, contentHash, nodeCount }] }
//   history/<n>.json     the document at that version (same format as document.json)
// Saves make an automatic snapshot at most every `throttleMs` when the content changed. Named versions
// are kept forever; the oldest automatic ones are pruned beyond `maxAuto`.
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fnv1a, parseFold, serializeFold, stableStringify, type FoldDocument } from "@opencrease/model";
import { atomicWrite, WorkspaceError, type Workspace } from "./workspace";

export type VersionSource = "auto" | "user" | "agent" | "restore";

export interface VersionInfo {
  version: number;
  createdAt: number;
  name?: string;
  source: VersionSource;
  contentHash: string;
  nodeCount: number;
}

export interface HistoryOptions {
  /** minimum time between automatic snapshots (default 5 min) */
  throttleMs?: number;
  /** automatic snapshots kept per file (default 100) */
  maxAuto?: number;
  now?: () => number;
}

/** Hash of what a version is about: everything except timestamps and the id counter. */
export function contentHash(doc: FoldDocument): string {
  return fnv1a(stableStringify({ ...doc, updatedAt: 0, clock: 0 }));
}

export class VersionHistory {
  private readonly throttleMs: number;
  private readonly maxAuto: number;
  private readonly now: () => number;
  private locks = new Map<string, Promise<unknown>>();

  constructor(
    private workspace: Workspace,
    opts: HistoryOptions = {},
  ) {
    this.throttleMs = opts.throttleMs ?? 5 * 60_000;
    this.maxAuto = opts.maxAuto ?? 100;
    this.now = opts.now ?? Date.now;
  }

  private async lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }

  private async dir(id: string): Promise<string> {
    return join((await this.workspace.require(id)).path, "history");
  }

  private async readIndex(dir: string): Promise<VersionInfo[]> {
    return (await this.readIndexFull(dir)).versions;
  }

  /** `next` keeps version numbers unique even after the newest version is deleted. */
  private async readIndexFull(dir: string): Promise<{ versions: VersionInfo[]; next: number }> {
    try {
      const data = JSON.parse(await readFile(join(dir, "index.json"), "utf8")) as { versions?: VersionInfo[]; next?: number };
      const versions = Array.isArray(data.versions) ? data.versions.filter((v) => Number.isInteger(v.version)) : [];
      const max = versions.reduce((m, v) => Math.max(m, v.version), 0);
      return { versions, next: Math.max(max + 1, Number.isInteger(data.next) ? data.next! : 1) };
    } catch {
      return { versions: [], next: 1 };
    }
  }

  private async writeIndex(dir: string, versions: VersionInfo[], next?: number): Promise<void> {
    const n = next ?? versions.reduce((m, v) => Math.max(m, v.version), 0) + 1;
    await atomicWrite(join(dir, "index.json"), `${JSON.stringify({ next: n, versions }, null, 2)}\n`);
  }

  async list(id: string): Promise<VersionInfo[]> {
    return this.readIndex(await this.dir(id));
  }

  async read(id: string, version: number): Promise<FoldDocument> {
    const dir = await this.dir(id);
    const info = (await this.readIndex(dir)).find((v) => v.version === version);
    if (!info) throw new WorkspaceError(`No version ${version} of this file`, 404);
    return parseFold(await readFile(join(dir, `${version}.json`), "utf8"));
  }

  /** Save `doc` (or the file on disk) as a new version. Returns the existing latest when nothing changed and no name is given. */
  async create(id: string, opts: { doc?: FoldDocument; name?: string; source?: VersionSource; force?: boolean } = {}): Promise<{ info: VersionInfo; created: boolean }> {
    return this.lock(id, async () => {
      const doc = opts.doc ?? (await this.workspace.readDocument(id));
      if (doc.id !== id) throw new WorkspaceError("Document id does not match the file");
      const dir = await this.dir(id);
      const { versions, next } = await this.readIndexFull(dir);
      const hash = contentHash(doc);
      const latest = versions.at(-1);
      const name = opts.name?.trim().slice(0, 200) || undefined;
      if (latest && opts.source === "auto" && !name && !opts.force && this.now() - latest.createdAt < this.throttleMs) return { info: latest, created: false };
      if (latest && latest.contentHash === hash && !name && !opts.force) return { info: latest, created: false };
      const info: VersionInfo = {
        version: next,
        createdAt: this.now(),
        source: opts.source ?? (name ? "user" : "auto"),
        contentHash: hash,
        nodeCount: Object.values(doc.nodes).filter((n) => n.type !== "Root").length,
      };
      if (name) info.name = name;
      await mkdir(dir, { recursive: true });
      await atomicWrite(join(dir, `${info.version}.json`), serializeFold(doc).documentJson);
      versions.push(info);
      await this.prune(dir, versions);
      await this.writeIndex(dir, versions, next + 1);
      return { info, created: true };
    });
  }

  private async prune(dir: string, versions: VersionInfo[]): Promise<void> {
    const auto = versions.filter((v) => !v.name && v.source === "auto");
    const drop = auto.slice(0, Math.max(0, auto.length - this.maxAuto));
    for (const v of drop) {
      versions.splice(versions.indexOf(v), 1);
      await rm(join(dir, `${v.version}.json`), { force: true });
    }
  }

  /** Called after every save: snapshot when the throttle window passed and the content changed. */
  async noteSave(id: string, doc: FoldDocument): Promise<VersionInfo | null> {
    const { info, created } = await this.create(id, { doc, source: "auto" });
    return created ? info : null;
  }

  async rename(id: string, version: number, name: string): Promise<VersionInfo> {
    return this.lock(id, async () => {
      const dir = await this.dir(id);
      const versions = await this.readIndex(dir);
      const info = versions.find((v) => v.version === version);
      if (!info) throw new WorkspaceError(`No version ${version} of this file`, 404);
      const clean = name.trim().slice(0, 200);
      if (clean) info.name = clean;
      else delete info.name;
      if (clean && info.source === "auto") info.source = "user";
      await this.writeIndex(dir, versions, (await this.readIndexFull(dir)).next);
      return info;
    });
  }

  async remove(id: string, version: number): Promise<void> {
    return this.lock(id, async () => {
      const dir = await this.dir(id);
      const { versions, next } = await this.readIndexFull(dir);
      const i = versions.findIndex((v) => v.version === version);
      if (i === -1) throw new WorkspaceError(`No version ${version} of this file`, 404);
      versions.splice(i, 1);
      await rm(join(dir, `${version}.json`), { force: true });
      await this.writeIndex(dir, versions, next);
    });
  }
}
