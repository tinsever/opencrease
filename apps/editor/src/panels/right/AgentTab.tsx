// Agent tab: real activity of MCP agents on this file (from the bridge), never simulated.
import { useMemo, useState } from "react";
import { AgentChat } from "./AgentChat";
import { activityLabel, groupActivity, readsSummary } from "./activity-rows";
import { useAgentLog, type AgentLogEntry } from "../../agent/activity";
import { useDoc, useWorkspace } from "../../state/hooks";
import { setSelection } from "../../state/workspace";
import { AgentAvatar, clientLabel, Icon } from "../../ui";
import { useMinuteTick, useRecentAgents } from "../shared";

export function relativeTime(t: number, now = Date.now()): string {
  const s = Math.round((now - t) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function StepRow({ entry: e, nested }: { entry: AgentLogEntry; nested?: boolean }) {
  const label = activityLabel(e);
  return (
    <div
      className={`of-step${e.ok ? "" : " error"}${e.write ? " write" : ""}${nested ? " nested" : ""}`}
      title={`${e.tool}, ${Math.round(e.durationMs)} ms${e.error ? `\n${e.error}` : ""}`}
    >
      <span style={{ width: 12, display: "inline-flex", flexShrink: 0, color: e.ok ? (e.write ? "var(--of-success)" : "var(--of-muted)") : "var(--of-danger)" }}>
        <Icon name={e.ok ? (e.write ? "check" : "eye") : "warning"} size={12} />
      </span>
      <span className="what">{e.ok ? label : `${label}: ${e.error ?? "failed"}`}</span>
      {nested ? <span className="tool">{e.tool}</span> : null}
    </div>
  );
}

function ReadsRow({ entries }: { entries: AgentLogEntry[] }) {
  const [open, setOpen] = useState(false);
  const { title, detail } = readsSummary(entries);
  return (
    <>
      <button className="of-step reads" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={open ? "Hide reads" : "Show each read"}>
        <span style={{ width: 12, display: "inline-flex", flexShrink: 0, color: "var(--of-muted)" }}>
          <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />
        </span>
        <span className="what">
          {title}
          <span className="of-muted">{detail ? `, ${detail}` : ""}</span>
        </span>
      </button>
      {open ? entries.map((e) => <StepRow key={e.id} entry={e} nested />) : null}
    </>
  );
}

const CHECKS = ["Spacing and rhythm", "Type size and hierarchy", "Contrast", "Alignment", "Clipping at the artboard edge"];

export function AgentTab({ fileId }: { fileId: string }) {
  const log = useAgentLog(fileId);
  const doc = useDoc(fileId);
  const agents = useRecentAgents();
  const work = useWorkspace((s) => s.agentWork[fileId]);
  const bridge = useWorkspace((s) => s.bridgeConnected);
  useMinuteTick();
  // group consecutive calls by client into sessions
  const sessions = useMemo(() => {
    const out: Array<{ client: string; entries: AgentLogEntry[] }> = [];
    for (const e of log.slice(-120)) {
      const last = out[out.length - 1];
      if (last && last.client === e.client && e.time - last.entries[last.entries.length - 1].time < 5 * 60_000) last.entries.push(e);
      else out.push({ client: e.client, entries: [e] });
    }
    return out;
  }, [log]);

  const sinceScreenshot = useMemo(() => {
    let n = 0;
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].tool === "get_screenshot") break;
      if (log[i].write && log[i].ok) n++;
    }
    return n;
  }, [log]);

  const working = Object.entries(work ?? {});

  return (
    <AgentChat key={fileId} fileId={fileId} activity={<>
        {(doc?.briefs ?? []).map((b) => <section key={b.id} className="of-card" aria-label="Design brief">
          <strong style={{ fontSize: "var(--of-text-xs)" }}>Design brief{b.artboardId ? `: ${doc?.nodes[b.artboardId]?.name ?? "Artboard"}` : ""}</strong>
          {(["mood", "palette", "type", "direction"] as const).map((k) => <div key={k} className="of-hint"><strong style={{ textTransform: "capitalize" }}>{k}</strong> {b[k]}</div>)}
        </section>)}
        {working.map(([artboardId, w]) => (
          <div key={artboardId} className="of-card" style={{ background: "var(--of-agent-soft)", color: "var(--of-agent)", cursor: "default" }} onClick={() => setSelection(fileId, [artboardId])}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <AgentAvatar client={w.client} size={18} />
              <span style={{ fontWeight: 600 }}>{clientLabel(w.client)} is working</span>
            </div>
            <span style={{ fontSize: "var(--of-text-xs)" }}>{w.label || (doc?.nodes[artboardId] ? `Editing ${doc.nodes[artboardId].name}` : "")}</span>
          </div>
        ))}

        {sessions.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 8 }}>
            <span style={{ fontWeight: 600, fontSize: "var(--of-text-md)" }}>No agent activity on this file yet</span>
            <span className="of-hint">
              Agents edit this file through the local MCP server. Ask Claude Code, Codex or any MCP client to work on “{doc?.name ?? "this file"}”, and every tool call shows up here as it happens.
            </span>
            <span className="of-hint">
              {agents.length ? `Connected recently: ${agents.map((a) => clientLabel(a.name)).join(", ")}.` : bridge ? "The editor is connected to the server, no agent has called in yet." : "The editor is not connected to the server right now."}
            </span>
          </div>
        ) : null}

        {sessions.map((s, si) => (
          <div key={si} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <AgentAvatar client={s.client} size={20} />
              <span style={{ fontWeight: 600, fontSize: "var(--of-text-md)" }}>{clientLabel(s.client)}</span>
              <span className="of-hint" style={{ marginLeft: "auto" }}>{relativeTime(s.entries[s.entries.length - 1].time)}</span>
            </div>
            <div className="of-steps">
              {groupActivity(s.entries.slice(-60)).map((row) =>
                row.kind === "reads" ? <ReadsRow key={`r-${row.entries[0].id}`} entries={row.entries} /> : <StepRow key={row.entry.id} entry={row.entry} />,
              )}
            </div>
          </div>
        ))}

        {log.length > 0 ? (
          <div className="of-card">
            <span style={{ fontWeight: 600, fontSize: "var(--of-text-xs)" }}>Review checklist</span>
            <span className="of-hint">After each section, agents are asked to take a screenshot and check:</span>
            {CHECKS.map((c) => (
              <span key={c} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "var(--of-text-xs)", color: "var(--of-ink-2)" }}>
                <Icon name="check" size={11} style={{ color: "var(--of-muted)" }} />
                {c}
              </span>
            ))}
            {sinceScreenshot >= 3 ? (
              <span style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "var(--of-text-xs)", color: "var(--of-accent-ink)" }}>
                <Icon name="warning" size={11} />
                {sinceScreenshot} edits since the last screenshot
              </span>
            ) : null}
          </div>
        ) : null}
    </>} />
  );
}
