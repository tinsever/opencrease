// "Connect an agent": setup instructions per MCP client. In the desktop app, "Add automatically"
// writes the config after showing the change (AutoConnect.tsx); the browser never writes on disk.
import { sessionToken } from "../auth/session";
import { useEffect, useState } from "react";
import { useWorkspace } from "../state/hooks";
import { AgentAvatar, Button, copyText, Icon } from "../ui";
import { useServerStatus, tildePath } from "../panels/files";
import { AutoConnect } from "./AutoConnect";
import { Dialog } from "./Dialog";
import { clientSetups, connectInfo, type ConnectInfo } from "./connect";

/** Connect info for the running server (placeholder values while the status loads). */
export function useConnectInfo(): ConnectInfo {
  const [, refresh] = useState(0);
  useEffect(() => {
    const changed = () => refresh((n) => n + 1);
    window.addEventListener("opencrease:token-changed", changed);
    return () => window.removeEventListener("opencrease:token-changed", changed);
  }, []);
  return { ...connectInfo(useServerStatus()), token: sessionToken() ?? undefined };
}

export function CopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="of-cmd">
      <pre>{code}</pre>
      <button
        onClick={() =>
          void copyText(code).then((ok) => {
            if (!ok) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          })
        }
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function AgentSetupList() {
  const info = useConnectInfo();
  const url = info.url;
  const clients = useWorkspace((s) => s.agentClients);
  const [open, setOpen] = useState<string | null>(null);
  const recent = Object.entries(clients).filter(([, t]) => Date.now() - t < 10 * 60_000);
  const status = useServerStatus();
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", padding: "8px 12px", gap: 2 }}>
        {clientSetups(info).map((c) => {
          const connected = recent.find(([name]) => c.match.test(name));
          const isOpen = open === c.id;
          return (
            <div key={c.id} className={`of-agent-row${isOpen ? " open" : connected ? " connected" : ""}`}>
              <div className="of-agent-row-main">
                <AgentAvatar client={c.id === "claude-code" ? "claude-code" : c.name} size={32} shape="square" tone={c.id === "codex" ? "dark" : "light"} />
                <div className="names">
                  <span className="n1">{c.name}</span>
                  <span className="n2">{connected ? `Connected as ${connected[0]}` : c.where}</span>
                </div>
                {connected && !isOpen ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--of-success)", fontWeight: 500 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--of-success)" }} />
                    Connected
                  </span>
                ) : null}
                <Button size="md" variant={isOpen ? "default" : connected ? "ghost" : "primary"} style={{ height: 30 }} onClick={() => setOpen(isOpen ? null : c.id)}>
                  {isOpen ? "Hide" : connected ? "Setup" : "Set up"}
                </Button>
              </div>
              {isOpen ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 12px 12px 56px" }}>
                  <AutoConnect client={c.id} name={c.name} />
                  {c.steps.map((s, i) => (
                    <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span className="of-hint">{s.label}</span>
                      <CopyBlock code={s.code} />
                    </div>
                  ))}
                  <span className="of-hint">Then ask the agent to open a file, for example: “Use OpenCrease to design a pricing page in a new file.”</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div style={{ borderTop: "1px solid var(--of-hairline)", display: "flex", flexDirection: "column", gap: 8, padding: "16px 24px" }}>
        <span style={{ fontWeight: 600, fontSize: "var(--of-text-xs)" }}>Any other agent</span>
        <CopyBlock code={info.stdio} />
        {info.token ? <details><summary>Snapshot extension token</summary><CopyBlock code={info.token} /></details> : null}
        <span className="of-hint">
          {info.stdioArgs.length === 1 ? "Stdio by default." : `Stdio by default. --port ${info.port} points it at this server.`} This server also speaks Streamable HTTP at <span className="of-mono">{url}</span>
          {status ? <>, with files from <span className="of-mono">{tildePath(status.workspace)}</span></> : null}.
        </span>
      </div>
    </>
  );
}

export function ConnectDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog onClose={onClose} width={600} label="Connect an agent">
      <div className="of-dlg-head">
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="of-dlg-title">Connect an agent</div>
          <div className="of-dlg-sub">Agents read and edit your designs through the built-in MCP server. It runs on this machine and has no usage limits.</div>
        </div>
        <button className="of-icon-btn sm" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="of-scroll" style={{ flex: 1, minHeight: 0 }}>
        <AgentSetupList />
      </div>
      <div className="of-dlg-foot">
        <span className="of-hint" style={{ flex: 1 }}>Each agent edit is one undo step, and the layer tree shows which artboard an agent is working on.</span>
        <Button variant="primary" size="md" onClick={onClose}>Done</Button>
      </div>
    </Dialog>
  );
}
