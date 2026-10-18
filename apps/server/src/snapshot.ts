// POST /api/snapshot: the Snapshot browser extension sends one captured artboard as OpenCrease HTML.
// Inlined images (data URLs) become file assets. The artboard goes into the file through the editor when
// one is connected (so it appears live and is one undo step), otherwise straight into the file on disk.
import { colorTokensForTrees, htmlToTrees } from "@opencrease/css";
import { DocStore, type AssetMeta, type FoldDocument, type NodeTree } from "@opencrease/model";
import type { BridgeHub } from "./bridge";
import { WorkspaceError, type Workspace } from "./workspace";

export interface SnapshotDeps {
  workspace: Workspace;
  bridge: BridgeHub;
  editorUrl(path: string): string;
  openBrowser(url: string): void;
}

export type SnapshotTarget = { kind: "active" } | { kind: "new"; name?: string } | { kind: "file"; fileId: string };

export interface SnapshotBody {
  html: string;
  name: string;
  url?: string;
  target: SnapshotTarget;
  colorTokens?: boolean;
}

export interface SnapshotResult {
  ok: true;
  fileId: string;
  fileName: string;
  nodeId: string | null;
  layers: number;
  url: string;
  delivered: "editor" | "disk";
  warnings: string[];
}

export class SnapshotError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function parseSnapshotBody(raw: unknown): SnapshotBody {
  const b = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (typeof b.html !== "string" || !b.html.trim()) throw new SnapshotError(400, "html is required");
  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 120) : "Snapshot";
  const t = b.target && typeof b.target === "object" ? (b.target as Record<string, unknown>) : { kind: "active" };
  let target: SnapshotTarget;
  if (t.kind === "file" && typeof t.fileId === "string" && t.fileId) target = { kind: "file", fileId: t.fileId };
  else if (t.kind === "new") target = typeof t.name === "string" && t.name.trim() ? { kind: "new", name: t.name.trim() } : { kind: "new" };
  else target = { kind: "active" };
  const body: SnapshotBody = { html: b.html, name, target, colorTokens: b.colorTokens === true };
  if (typeof b.url === "string") body.url = b.url;
  return body;
}

const DATA_URL_RE = /data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)/g;

/**
 * Stores base64 data URLs as assets of the file. `<img src>` references become `asset://<hash>`, CSS
 * `url()` references become the asset's API URL (which is how the editor stores image fills).
 */
export async function extractDataUrls(workspace: Workspace, fileId: string, html: string): Promise<{ html: string; assets: AssetMeta[] }> {
  const assets = new Map<string, AssetMeta>();
  const byData = new Map<string, AssetMeta>();
  for (const m of html.matchAll(DATA_URL_RE)) {
    const key = m[0];
    if (byData.has(key)) continue;
    const mime = m[1].toLowerCase();
    if (!mime.startsWith("image/")) continue;
    const meta = await workspace.addAsset(fileId, Buffer.from(m[2], "base64"), mime);
    byData.set(key, meta);
    assets.set(meta.hash, meta);
  }
  if (!byData.size) return { html, assets: [] };
  const out = html.replace(DATA_URL_RE, (all, _mime: string, _b64: string, offset: number) => {
    const meta = byData.get(all);
    if (!meta) return all;
    const before = html.slice(Math.max(0, offset - 5), offset);
    return /src="$/.test(before) ? `asset://${meta.hash}` : `/api/files/${encodeURIComponent(fileId)}/assets/${meta.hash}`;
  });
  return { html: out, assets: [...assets.values()] };
}

function countTrees(trees: NodeTree[]): number {
  return trees.reduce((n, t) => n + 1 + countTrees(t.children ?? []), 0);
}

function px(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^-?[\d.]+(px)?$/.test(v.trim())) return parseFloat(v);
  return undefined;
}

/** Inserts the artboard into a document that is not open in any editor. */
export function insertIntoDocument(doc: FoldDocument, html: string, name: string, assets: AssetMeta[], colorTokens: boolean): { doc: FoldDocument; nodeId: string | null; layers: number; warnings: string[] } {
  const store = new DocStore(doc);
  const parsed = htmlToTrees(html);
  if (!parsed.trees.length) throw new SnapshotError(400, "The snapshot contained no layers.");
  let trees = parsed.trees;
  const firstPage = store.doc.pageList.find((p) => p.type === "page");
  if (!firstPage) throw new SnapshotError(500, "The file has no page.");
  const page = store.doc.pages[firstPage.id];
  const root = store.doc.nodes[page.rootId];
  let right = 0;
  for (const id of root.children) {
    const n = store.doc.nodes[id];
    const l = px(n?.styles.left) ?? 0;
    const w = px(n?.styles.width) ?? 0;
    right = Math.max(right, l + w);
  }
  const left = root.children.length ? Math.round(right + 100) : 0;
  let nodeId: string | null = null;
  store.transact("Import snapshot", (tx) => {
    for (const a of assets) tx.addAsset(a);
    if (colorTokens) {
      const res = colorTokensForTrees(trees, tx.doc.tokens);
      trees = res.trees;
      for (const t of res.tokens) tx.createToken(t);
    }
    const prepared = trees.map((t, i) => ({ ...t, name: i === 0 ? name : t.name, styles: { ...t.styles, left: left + i * 40, top: i * 40 } }));
    nodeId = tx.insertTrees(page.rootId, prepared)[0] ?? null;
  }, { origin: "system" });
  return { doc: store.doc, nodeId, layers: countTrees(trees), warnings: parsed.warnings };
}

async function resolveTarget(deps: SnapshotDeps, body: SnapshotBody): Promise<{ id: string; name: string }> {
  const { workspace, bridge } = deps;
  if (body.target.kind === "file") {
    const e = await workspace.require(body.target.fileId);
    return { id: e.id, name: e.name };
  }
  if (body.target.kind === "active" && bridge.activeFileId) {
    const e = await workspace.find(bridge.activeFileId);
    if (e) return { id: e.id, name: e.name };
  }
  const name = body.target.kind === "new" && body.target.name ? body.target.name : body.name;
  const e = await workspace.create({ name });
  return { id: e.id, name: e.name };
}

export async function importSnapshot(deps: SnapshotDeps, body: SnapshotBody): Promise<SnapshotResult> {
  const { workspace, bridge } = deps;
  if (!htmlToTrees(body.html).trees.length) throw new SnapshotError(400, "The snapshot contained no layers.");
  const file = await resolveTarget(deps, body);
  const { html, assets } = await extractDataUrls(workspace, file.id, body.html);
  const url = deps.editorUrl(`/file/${encodeURIComponent(file.id)}`);

  if (bridge.connected) {
    const result = await bridge.importHtml({ fileId: file.id, html, name: body.name, colorTokens: body.colorTokens === true });
    const first = result.content.find((c) => c.type === "text");
    const text = first && first.type === "text" ? first.text : "";
    if (result.isError) throw new SnapshotError(500, text || "The editor could not import the snapshot.");
    let info: { nodeId?: string; layers?: number; warnings?: string[] } = {};
    try {
      info = JSON.parse(text);
    } catch {
      // keep defaults
    }
    return { ok: true, fileId: file.id, fileName: file.name, nodeId: info.nodeId ?? null, layers: info.layers ?? 0, url, delivered: "editor", warnings: info.warnings ?? [] };
  }

  const doc = await workspace.readDocument(file.id);
  const res = insertIntoDocument(doc, html, body.name, assets, body.colorTokens === true);
  try {
    await workspace.writeDocument(file.id, res.doc);
  } catch (err) {
    if (err instanceof WorkspaceError) throw new SnapshotError(err.status, err.message);
    throw err;
  }
  return { ok: true, fileId: file.id, fileName: file.name, nodeId: res.nodeId, layers: res.layers, url, delivered: "disk", warnings: res.warnings };
}
