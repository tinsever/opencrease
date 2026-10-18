import { useEffect, useState } from "react";
import { listPlugins, runPlugin, type PluginInfo } from "../agent/plugins";
import { Button, Icon } from "../ui";
import { Dialog } from "./Dialog";

export function PluginsDialog({ fileId, onClose }: { fileId: string; onClose(): void }) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => { void listPlugins().then(setPlugins).catch((e) => setStatus(e.message)); }, []);
  const run = async (plugin: PluginInfo, command: string) => {
    setBusy(plugin.id); setStatus("");
    try { await runPlugin(plugin, command, fileId, setStatus); }
    catch (e) { setStatus((e as Error).message); }
    finally { setBusy(null); }
  };
  return <Dialog label="Plugins" width={580} onClose={onClose}>
    <div className="of-dlg-head"><div style={{ flex: 1 }}><div className="of-dlg-title">Plugins</div><div className="of-dlg-sub">Local scripts for your design workflow</div></div><button className="of-icon-btn" aria-label="Close plugins" onClick={onClose}><Icon name="close" /></button></div>
    <div className="of-settings-body" style={{ maxHeight: "50vh", overflowY: "auto" }}>
      {plugins.map((p) => <section key={p.id} aria-label={p.name} style={{ padding: "16px 0", borderBottom: "1px solid var(--of-hairline)" }}>
        <div style={{ fontWeight: 600 }}>{p.name}</div><p className="of-hint">{p.description}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{(p.commands.length ? p.commands : [{ id: "run", title: "Run" }]).map((c) => <Button key={c.id} disabled={busy !== null} onClick={() => void run(p, c.id)}>{busy === p.id ? "Running" : c.title}</Button>)}</div>
      </section>)}
      <p className="of-hint">Install JavaScript modules in ~/.opencrease/plugins.</p>
      <div role="status" className="of-hint">{status}</div>
    </div>
  </Dialog>;
}
