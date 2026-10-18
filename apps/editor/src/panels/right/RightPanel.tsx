import "../../ui";
import "../panels.css";
import { openPreview } from "../../preview/preview";
import { useSyncExternalStore } from "react";
import { getViewportLive, subscribeViewport } from "../../canvas/registry";
import { useWorkspace } from "../../state/hooks";
import { setRightTab, type RightTab } from "../../state/workspace";
import { AgentAvatar, clientLabel, Icon, Tooltip } from "../../ui";
import { openConnectDialog, useRecentAgents } from "../shared";
import { AgentTab } from "./AgentTab";
import { CodeTab } from "./CodeTab";
import { DesignTab } from "./DesignTab";

function AgentStatus() {
  const agents = useRecentAgents();
  if (agents.length === 0) {
    return (
      <button className="of-agent-status none" onClick={openConnectDialog} title="Connect an agent">
        No agent
        <span style={{ color: "var(--of-accent-ink)", fontWeight: 500 }}>Connect</span>
      </button>
    );
  }
  const first = agents[0];
  return (
    <Tooltip label={agents.map((a) => clientLabel(a.name)).join(", ") + " connected over MCP"}>
      <button className="of-agent-status" onClick={openConnectDialog}>
        <AgentAvatar client={first.name} size={20} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{clientLabel(first.name)}</span>
        {agents.length > 1 ? <span className="count">+{agents.length - 1}</span> : null}
        <span className="live" />
      </button>
    </Tooltip>
  );
}

function Zoom() {
  const zoom = useSyncExternalStore(subscribeViewport, () => getViewportLive().zoom);
  return <span className="zoom">{Math.round(zoom * 100)}%</span>;
}

export function RightPanel({ fileId }: { fileId: string }) {
  const tab = useWorkspace((s) => s.rightTab);
  const tabs: Array<{ id: RightTab; label: string }> = [
    { id: "design", label: "Design" },
    { id: "code", label: "Code" },
    { id: "agent", label: "Agent" },
  ];
  return (
    <aside className="of-panel right" aria-label="Inspector">
      <div className="of-right-header">
        <AgentStatus />
        <div style={{ flex: 1 }} />
        <Tooltip label="Preview artboard (⌥P)">
          <button className="of-icon-btn" aria-label="Preview" onClick={() => openPreview(fileId)} style={{ color: "var(--of-ink-2)" }}>
            <Icon name="play" size={14} />
          </button>
        </Tooltip>
      </div>
      <div className="of-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`of-tab${tab === t.id ? " on" : ""}`} onClick={() => setRightTab(t.id)}>
            {t.label}
          </button>
        ))}
        <Zoom />
      </div>
      {tab === "design" ? <DesignTab fileId={fileId} /> : tab === "code" ? <CodeTab fileId={fileId} /> : <AgentTab fileId={fileId} />}
    </aside>
  );
}
