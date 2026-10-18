import { useEffect, useMemo, useState } from "react";
import { diffDocuments, summarizeDiff, type FoldDocument } from "@opencrease/model";
import { restoreDocument } from "../agent/restore";
import { versionApi, type VersionInfo } from "../agent/versions";
import { useDoc } from "../state/hooks";
import { getOpenFile, setActivePage, setSelection, flushSave } from "../state/workspace";
import { Button, Icon } from "../ui";
import { Dialog } from "./Dialog";
import { historyImages, historyPreview } from "./history-preview";

export function HistoryDialog({ fileId, onClose }: { fileId: string; onClose(): void }) {
  const current = useDoc(fileId);
  const api = useMemo(() => versionApi(fileId), [fileId]);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [before, setBefore] = useState<FoldDocument | null>(null);
  const [pageId, setPageId] = useState<string>("");
  const [name, setName] = useState("");
  const [images, setImages] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    if (before && current) void historyImages(fileId, [before, current]).then((data) => { if (alive) setImages(data); });
    return () => { alive = false; };
  }, [fileId, before, current]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => api.list().then(setVersions);
  useEffect(() => { void refresh().catch((e) => setError(e.message)); }, [api]);
  useEffect(() => {
    setBefore(null);
    let alive = true;
    if (selected !== null) void api.read(selected).then((d) => { if (alive) setBefore(d); }).catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [api, selected]);
  const diff = useMemo(() => before && current ? diffDocuments(before, current) : null, [before, current]);
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const restore = async () => {
    if (!before || !current) return;
    await api.create({ doc: current, name: "Before restore", source: "restore", force: true });
    const file = getOpenFile(fileId);
    if (!file) return;
    file.store.transact(`Restore version ${selected}`, (tx) => {
      restoreDocument(tx.doc, before);
    });
    setSelection(fileId, []);
    setActivePage(fileId, Object.keys(before.pages)[0]);
    await flushSave(fileId);
    if (getOpenFile(fileId)?.saveState === "error") throw new Error("Could not save the restored version");
    await api.create({ doc: file.store.doc, name: `Restored version ${selected}`, source: "restore", force: true });
    await refresh();
  };
  return <Dialog label="Version history" width={1120} top="6vh" onClose={onClose} style={{ height: "82vh", display: "flex", flexDirection: "column" }}>
    <div className="of-dlg-head"><div style={{ flex: 1 }}><div className="of-dlg-title">Version history</div><div className="of-dlg-sub">{current?.name}</div></div><button className="of-icon-btn" aria-label="Close version history" onClick={onClose}><Icon name="close" /></button></div>
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <aside aria-label="Saved versions" style={{ width: 250, borderRight: "1px solid var(--of-hairline)", padding: 16, overflowY: "auto", flexShrink: 0 }}>
        <form onSubmit={(e) => { e.preventDefault(); void act(async () => { if (current) { const v = await api.create({ doc: current, name: name.trim() || "Named version", force: true }); setName(""); await refresh(); setSelected(v.version); } }); }}>
          <label className="of-field" style={{ flex: "none" }}><input aria-label="Version name" placeholder="Name this version" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <Button disabled={busy} style={{ margin: "8px 0 16px", width: "100%" }} type="submit">Save version</Button>
        </form>
        {[...versions].reverse().map((v) => <button key={v.version} aria-pressed={selected === v.version} className={`of-home-item${selected === v.version ? " on" : ""}`} style={{ width: "100%", height: "auto", padding: "10px 8px", display: "block", textAlign: "left" }} onClick={() => setSelected(v.version)}>
          <div style={{ fontWeight: 600 }}>{v.name || `Version ${v.version}`}</div><div className="of-hint" style={{ marginTop: 4 }}>{new Date(v.createdAt).toLocaleString()}<br />{v.source}, {v.nodeCount} layers</div>
        </button>)}
        {!versions.length ? <p className="of-hint">Saved checkpoints appear here. Automatic snapshots are kept every five minutes when the file changes.</p> : null}
      </aside>
      <section aria-label="Version comparison" style={{ flex: 1, minWidth: 0, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <select className="of-input" style={{ flex: "none", height: 28, maxWidth: 200, background: "var(--of-chrome)", padding: "0 8px", borderRadius: 4 }} aria-label="Preview page" value={pageId || Object.keys(current?.pages ?? {})[0] || ""} onChange={(e) => setPageId(e.target.value)}>{Object.values({ ...before?.pages, ...current?.pages }).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <div className="of-hint">{diff ? summarizeDiff(diff) : "Choose a saved version to compare it with the current design."}</div>
        {before && current && diff ? <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, flex: 1, minHeight: 0 }}>
            {[{ title: `Version ${selected}`, doc: before, ids: diff.removedIds }, { title: "Current design", doc: current, ids: diff.touchedIds }].map((p) => <div key={p.title} style={{ display: "flex", flexDirection: "column", gap: 8 }}><strong style={{ fontSize: "var(--of-text-xs)" }}>{p.title}</strong><iframe title={p.title} sandbox="" srcDoc={historyPreview(p.doc, p.ids, window.location.origin, pageId, images)} style={{ flex: 1, minHeight: 180, width: "100%", border: "1px solid var(--of-hairline)", background: "var(--of-chrome)" }} /></div>)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="of-hint" style={{ flex: 1 }}>Changed and removed layers are outlined in amber.</span><Button disabled={busy} onClick={() => void act(restore)}>Restore version {selected}</Button></div>
        </> : null}
        {error ? <div role="alert" style={{ color: "var(--of-danger)" }}>{error}</div> : null}
      </section>
    </div>
  </Dialog>;
}
