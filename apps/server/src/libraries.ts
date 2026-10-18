// Published libraries (SPEC §4.9, P2). A file publishes a snapshot of its components and tokens as
// `<Name>.fold/library.json`; other files in the same workspace subscribe by copying that snapshot.
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWrite, type Workspace, WorkspaceError } from "./workspace";

const LIBRARY_FILE = "library.json";

export interface LibraryListing {
  fileId: string;
  name: string;
  version: number;
  publishedAt: number;
  componentCount: number;
  tokenCount: number;
}

interface StoredSnapshot {
  fileId: string;
  name: string;
  version: number;
  publishedAt: number;
  componentIds: string[];
  nodes: Record<string, unknown>;
  tokens: unknown[];
  assets?: Record<string, unknown>;
}

function isSnapshot(v: unknown): v is StoredSnapshot {
  const s = v as StoredSnapshot;
  return !!s && typeof s === "object" && typeof s.fileId === "string" && typeof s.version === "number" &&
    Array.isArray(s.componentIds) && !!s.nodes && typeof s.nodes === "object" && Array.isArray(s.tokens);
}

export class Libraries {
  constructor(private readonly workspace: Workspace) {}

  async read(id: string): Promise<StoredSnapshot | null> {
    const entry = await this.workspace.require(id);
    try {
      const parsed = JSON.parse(await readFile(join(entry.path, LIBRARY_FILE), "utf8")) as unknown;
      // a cloned file carries the source's library.json; it is not a library until it publishes itself
      return isSnapshot(parsed) && parsed.fileId === id ? parsed : null;
    } catch {
      return null;
    }
  }

  async publish(id: string, input: unknown): Promise<{ version: number; publishedAt: number }> {
    if (!isSnapshot(input)) throw new WorkspaceError("Invalid library snapshot");
    if (input.fileId !== id) throw new WorkspaceError("The snapshot belongs to another file");
    const entry = await this.workspace.require(id);
    const previous = await this.read(id);
    if (previous && input.version <= previous.version) input.version = previous.version + 1;
    input.name = entry.name;
    await atomicWrite(join(entry.path, LIBRARY_FILE), JSON.stringify(input));
    return { version: input.version, publishedAt: input.publishedAt };
  }

  async list(): Promise<LibraryListing[]> {
    const out: LibraryListing[] = [];
    for (const entry of await this.workspace.list()) {
      const snap = await this.read(entry.id).catch(() => null);
      if (!snap) continue;
      out.push({
        fileId: entry.id,
        name: entry.name,
        version: snap.version,
        publishedAt: snap.publishedAt,
        componentCount: snap.componentIds.length,
        tokenCount: snap.tokens.length,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Copies the asset files a library uses into a subscribing file. Returns how many were copied. */
  async copyAssets(fromId: string, toId: string): Promise<number> {
    const snap = await this.read(fromId);
    if (!snap) throw new WorkspaceError("That file has not been published as a library", 404);
    const hashes = Object.keys(snap.assets ?? {});
    if (!hashes.length) return 0;
    const from = join((await this.workspace.require(fromId)).path, "assets");
    const to = join((await this.workspace.require(toId)).path, "assets");
    await mkdir(to, { recursive: true });
    const names = await readdir(from).catch(() => [] as string[]);
    const existing = new Set(await readdir(to).catch(() => [] as string[]));
    let copied = 0;
    for (const name of names) {
      if (!hashes.some((h) => name.startsWith(`${h}.`)) || existing.has(name)) continue;
      await copyFile(join(from, name), join(to, name));
      copied++;
    }
    return copied;
  }
}
