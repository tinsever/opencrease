// Cached workspace file list (for folder names in the file header and the home screen).
import { useEffect, useSyncExternalStore } from "react";
import { api, type FileEntry } from "../state/api";

let files: FileEntry[] | null = null;
let error: string | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function refreshFiles(): Promise<void> {
  inflight ??= api
    .listFiles()
    .then((list) => {
      files = list;
      error = null;
    })
    .catch((e: unknown) => {
      error = e instanceof Error ? e.message : String(e);
    })
    .finally(() => {
      inflight = null;
      emit();
    });
  return inflight;
}

export function useFiles(): { files: FileEntry[] | null; error: string | null } {
  const snap = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => files,
  );
  const err = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => error,
  );
  useEffect(() => {
    void refreshFiles();
  }, []);
  return { files: snap, error: err };
}

export interface ServerStatus {
  version: string;
  workspace: string;
  port: number;
  mcpUrl: string;
}

let status: ServerStatus | null = null;
let statusPending = false;

/** Server status (workspace path, version), fetched once. */
export function useServerStatus(): ServerStatus | null {
  const snap = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
  useEffect(() => {
    if (status || statusPending) return;
    statusPending = true;
    api
      .status()
      .then((s) => {
        status = { version: s.version, workspace: s.workspace, port: s.port, mcpUrl: s.mcpUrl };
        emit();
      })
      .catch(() => undefined)
      .finally(() => {
        statusPending = false;
      });
  }, []);
  return snap;
}

/** Shorten a home-relative absolute path: /Users/me/OpenCrease → ~/OpenCrease */
export function tildePath(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, "~");
}

/** Folder label for an entry: "Kiln / Web", or the workspace folder name for files at the root. */
export function folderLabel(entry: FileEntry | undefined, workspace?: string): string {
  if (!entry) return "";
  const f = entry.folder.replace(/\\/g, "/");
  if (f) return f.split("/").join(" / ");
  const ws = workspace ? tildePath(workspace) : "";
  return ws.split("/").filter(Boolean).pop() ?? "Workspace";
}
