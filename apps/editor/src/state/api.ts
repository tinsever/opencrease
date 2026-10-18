// Thin REST client for the local OpenCrease server (see docs/ARCHITECTURE.md).
import { safeImageUrl } from "@opencrease/css";
import type { AssetMeta, FoldDocument } from "@opencrease/model";

export interface FileEntry {
  id: string;
  name: string;
  path: string;
  folder: string;
  updatedAt: number;
  hasThumbnail?: boolean;
}

export interface GuideLayer {
  id: "builtin" | "user" | "file";
  label: string;
  path: string;
  content: string;
  editable: boolean;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
  return (await res.json()) as T;
}

export const api = {
  status: () => fetch("/api/status").then((r) => json<{ version: string; workspace: string; port: number; mcpUrl: string; editorConnected: boolean }>(r)),
  listFiles: () => fetch("/api/files").then((r) => json<FileEntry[]>(r)),
  createFile: (body: { name?: string; cloneFileId?: string; folder?: string } = {}) =>
    fetch("/api/files", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) =>
      json<{ id: string; name: string; path: string }>(r),
    ),
  getFile: (id: string) => fetch(`/api/files/${encodeURIComponent(id)}`).then((r) => json<FoldDocument>(r)),
  saveFile: (doc: FoldDocument) =>
    fetch(`/api/files/${encodeURIComponent(doc.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(doc),
    }).then((r) => json<{ ok: boolean; updatedAt: number }>(r)),
  renameFile: (id: string, name: string) =>
    fetch(`/api/files/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => json<{ ok: boolean }>(r)),
  deleteFile: (id: string) => fetch(`/api/files/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r)),
  thumbnailUrl: (id: string, updatedAt?: number) => `/api/files/${encodeURIComponent(id)}/thumbnail${updatedAt ? `?v=${updatedAt}` : ""}`,
  saveThumbnail: (id: string, png: Blob) =>
    fetch(`/api/files/${encodeURIComponent(id)}/thumbnail`, { method: "PUT", headers: { "content-type": "image/png" }, body: png }),
  uploadAsset: (fileId: string, data: Blob, filename?: string) =>
    fetch(`/api/files/${encodeURIComponent(fileId)}/assets`, {
      method: "POST",
      headers: { "content-type": data.type || "application/octet-stream", ...(filename ? { "x-filename": filename } : {}) },
      body: data,
    }).then((r) => json<AssetMeta>(r)),
  assetUrl: (fileId: string, hash: string) => `/api/files/${encodeURIComponent(fileId)}/assets/${hash}`,
  getGuide: (fileId?: string) =>
    fetch(`/api/guide${fileId ? `?fileId=${encodeURIComponent(fileId)}` : ""}`).then((r) => json<{ layers: GuideLayer[]; merged: string }>(r)),
  saveGuide: (layer: "user" | "file", content: string, fileId?: string) =>
    fetch(`/api/guide/${layer}${fileId ? `?fileId=${encodeURIComponent(fileId)}` : ""}`, { method: "PUT", body: content }),
};

/** Resolve a node `src` ("asset://<hash>" or URL) to something an <img> can load. */
export function resolveSrc(fileId: string, src: string | undefined): string | undefined {
  if (!src || !safeImageUrl(src)) return undefined;
  if (src.startsWith("asset://")) return api.assetUrl(fileId, src.slice("asset://".length));
  return src;
}
