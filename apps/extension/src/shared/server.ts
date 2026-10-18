// Client for the local OpenCrease server (GET /api/status, POST /api/snapshot).

export interface ServerStatus {
  app: string;
  version: string;
  editorConnected: boolean;
  openFiles: Array<{ id: string; name: string }>;
  activeFileId: string | null;
  authRequired?: boolean;
}

export interface SnapshotRequest {
  html: string;
  name: string;
  url?: string;
  target: { kind: "active" } | { kind: "new"; name?: string } | { kind: "file"; fileId: string };
  colorTokens?: boolean;
}

export interface SnapshotResponse {
  ok: true;
  fileId: string;
  fileName: string;
  nodeId: string | null;
  layers: number;
  url: string;
  delivered: "editor" | "disk";
  warnings: string[];
}

export function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Status of the server, or null when nothing (or not OpenCrease) answers on the port. */
export async function fetchStatus(port: number, token?: string): Promise<ServerStatus | null> {
  try {
    return await withTimeout(1500, async (signal) => {
      const res = await fetch(`${baseUrl(port)}/api/status`, { signal, cache: "no-store", headers: token ? { "x-opencrease-token": token } : {} });
      if (!res.ok) return null;
      const data = (await res.json()) as ServerStatus;
      return data && data.app === "opencrease" ? { ...data, openFiles: data.openFiles ?? [], activeFileId: data.activeFileId ?? null, editorConnected: data.editorConnected ?? false } : null;
    });
  } catch {
    return null;
  }
}

export async function postSnapshot(port: number, body: SnapshotRequest, token?: string): Promise<SnapshotResponse> {
  const res = await withTimeout(60_000, (signal) =>
    fetch(`${baseUrl(port)}/api/snapshot`, { method: "POST", signal, headers: { "content-type": "application/json", ...(token ? { "x-opencrease-token": token } : {}) }, body: JSON.stringify(body) }),
  );
  const data = (await res.json().catch(() => ({}))) as SnapshotResponse | { error?: string };
  if (!res.ok || !("ok" in data)) throw new Error(("error" in data && data.error) || `OpenCrease answered ${res.status}`);
  return data;
}
