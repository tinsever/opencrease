// Assets tab: images used in the file (uploaded assets and linked images), upload and insert.
import { useMemo, useState } from "react";
import type { AssetMeta, FoldDocument, OFNode } from "@opencrease/model";
import { pageOfNode } from "@opencrease/model";
import { insertTrees } from "../../state/actions";
import { api, resolveSrc } from "../../state/api";
import { useDoc, useWorkspace } from "../../state/hooks";
import { getOpenFile, setActivePage, setSelection } from "../../state/workspace";
import { Button, Icon } from "../../ui";
import { ComponentsAssets } from "./ComponentsAssets";

interface AssetItem {
  key: string;
  url: string;
  name: string;
  meta?: AssetMeta;
  nodes: OFNode[];
}

function hashOf(src: string): string | undefined {
  if (src.startsWith("asset://")) return src.slice(8);
  return /\/assets\/([0-9a-f]{16,})/.exec(src)?.[1];
}

function collect(doc: FoldDocument, fileId: string): AssetItem[] {
  const items = new Map<string, AssetItem>();
  const add = (src: string, node?: OFNode) => {
    const hash = hashOf(src);
    const key = hash ?? src;
    let item = items.get(key);
    if (!item) {
      const meta = hash ? doc.assets[hash] : undefined;
      item = {
        key,
        url: hash ? api.assetUrl(fileId, hash) : (resolveSrc(fileId, src) ?? src),
        name: meta?.name ?? (hash ? "Image" : decodeURIComponent(src.split("/").pop()?.split("?")[0] || "Image")),
        meta,
        nodes: [],
      };
      items.set(key, item);
    }
    if (node) item.nodes.push(node);
  };
  for (const n of Object.values(doc.nodes)) {
    if (n.type === "Image" && n.src) add(n.src, n);
    for (const k of ["backgroundImage", "background"]) {
      const v = n.styles[k];
      if (typeof v !== "string") continue;
      for (const m of v.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) add(m[2], n);
    }
  }
  for (const [hash, meta] of Object.entries(doc.assets)) if (meta.mime.startsWith("image/") && !items.has(hash)) add(`asset://${hash}`);
  return [...items.values()];
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function imageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export function AssetsTab({ fileId }: { fileId: string }) {
  const doc = useDoc(fileId);
  const activePageId = useWorkspace((s) => s.openFiles.find((f) => f.id === fileId)?.activePageId);
  const [busy, setBusy] = useState(false);
  const items = useMemo(() => (doc ? collect(doc, fileId) : []), [doc, fileId]);
  if (!doc) return null;

  const insert = (src: string, size: { width: number; height: number } | null, name?: string) => {
    const file = getOpenFile(fileId);
    if (!file) return;
    const d = file.store.doc;
    const page = d.pages[file.activePageId];
    const target = file.selection.length === 1 ? d.nodes[file.selection[0]] : undefined;
    const w = Math.min(size?.width ?? 400, 1200);
    const h = size ? Math.round((w / size.width) * size.height) : 300;
    if (target && target.type === "Frame") {
      insertTrees(target.id, [{ type: "Image", name, src, styles: { width: w, height: h, objectFit: "cover" } }], "Insert image");
      return;
    }
    const root = d.nodes[page.rootId];
    let right = 0;
    for (const id of root.children) {
      const n = d.nodes[id];
      const l = Number(n?.styles.left ?? 0);
      const wd = Number(n?.styles.width ?? 0);
      if (Number.isFinite(l + wd)) right = Math.max(right, l + wd);
    }
    insertTrees(root.id, [{ type: "Image", name, src, styles: { position: "absolute", left: root.children.length ? right + 100 : 0, top: 0, width: w, height: h, objectFit: "cover" } }], "Insert image");
  };

  const upload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return;
      setBusy(true);
      try {
        for (const f of files) {
          const [meta, size] = await Promise.all([api.uploadAsset(fileId, f, f.name), imageSize(f)]);
          const full = { ...meta, name: meta.name ?? f.name, width: meta.width ?? size?.width, height: meta.height ?? size?.height };
          getOpenFile(fileId)?.store.transact("Add asset", (tx) => tx.addAsset(full));
          insert(`asset://${meta.hash}`, size, f.name.replace(/\.[^.]+$/, ""));
        }
      } catch (e) {
        alert(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    };
    input.click();
  };

  const selectUsers = (item: AssetItem) => {
    if (!item.nodes.length) return;
    const onPage = item.nodes.filter((n) => pageOfNode(doc, n.id)?.id === activePageId);
    if (onPage.length) return setSelection(fileId, onPage.map((n) => n.id));
    const page = pageOfNode(doc, item.nodes[0].id);
    if (page) {
      setActivePage(fileId, page.id);
      setSelection(fileId, item.nodes.filter((n) => pageOfNode(doc, n.id)?.id === page.id).map((n) => n.id));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div className="of-scroll" style={{ flex: 1, minHeight: 0 }}>
      <ComponentsAssets fileId={fileId} />
      <div className="of-list-head" style={{ padding: "12px 8px 4px 18px", height: "auto" }}>
        <span className="of-caps">Images</span>
        <span className="of-mono of-muted" style={{ fontSize: "var(--of-text-xs)" }}>{items.length}</span>
      </div>
      <div style={{ padding: "4px 6px" }}>
        {items.length === 0 ? <div className="of-empty">No images in this file yet. Upload one, paste it on the canvas, or press I.</div> : null}
        <div className="of-asset-grid">
          {items.map((item) => (
            <div
              key={item.key}
              className="of-asset"
              title={item.nodes.length ? `Used by ${item.nodes.length} ${item.nodes.length === 1 ? "layer" : "layers"}. Click to select, double-click to insert again.` : "Not used. Double-click to insert."}
              onClick={() => selectUsers(item)}
              onDoubleClick={() => insert(item.key.length >= 16 && !item.key.includes("/") ? `asset://${item.key}` : item.url, item.meta?.width && item.meta.height ? { width: item.meta.width, height: item.meta.height } : null, item.name)}
            >
              <div className="thumb" style={{ backgroundImage: `url("${item.url}")` }} />
              <span className="aname">{item.name}</span>
              <span className="ameta">
                {[item.meta?.width && item.meta?.height ? `${item.meta.width}×${item.meta.height}` : null, item.meta ? formatBytes(item.meta.size) : "Linked", item.nodes.length ? `${item.nodes.length} used` : "unused"].filter(Boolean).join(", ")}
              </span>
            </div>
          ))}
        </div>
      </div>
      </div>
      <div className="of-panel-footer">
        <Button onClick={upload} disabled={busy}>
          <Icon name="upload" size={12} /> {busy ? "Uploading" : "Upload image"}
        </Button>
      </div>
    </div>
  );
}
