// REST client for a file's version history (server: apps/server/src/history.ts).
import type { FoldDocument } from "@opencrease/model";

export interface VersionInfo {
  version: number;
  createdAt: number;
  name?: string;
  source: "auto" | "user" | "agent" | "restore";
  contentHash: string;
  nodeCount: number;
}

export interface VersionApi {
  list(): Promise<VersionInfo[]>;
  read(version: number): Promise<FoldDocument>;
  create(opts: { doc?: FoldDocument; name?: string; source?: VersionInfo["source"]; force?: boolean }): Promise<VersionInfo & { created: boolean }>;
  rename(version: number, name: string): Promise<VersionInfo>;
  remove(version: number): Promise<void>;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export function versionApi(fileId: string): VersionApi {
  const base = `/api/files/${encodeURIComponent(fileId)}/versions`;
  const send = (method: string, url: string, body?: unknown) =>
    fetch(url, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    list: async () => (await json<{ versions: VersionInfo[] }>(await fetch(base))).versions,
    read: async (v) => json<FoldDocument>(await fetch(`${base}/${v}`)),
    create: async ({ doc, name, source, force }) => json(await send("POST", base, { document: doc, name, source, force })),
    rename: async (v, name) => json(await send("PATCH", `${base}/${v}`, { name })),
    remove: async (v) => {
      await json(await send("DELETE", `${base}/${v}`));
    },
  };
}
