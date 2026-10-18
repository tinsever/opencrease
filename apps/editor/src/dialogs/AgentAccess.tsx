// Settings, Agents: which agent clients may use OpenCrease (answers to the first-connection prompt).
import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";
import { relativeTime } from "../panels/right/AgentTab";
import { AgentAvatar, Button, clientLabel } from "../ui";

interface AgentRecord {
  name: string;
  decision: "allow" | "deny";
  decidedAt: number;
  lastSeen?: number;
  version?: string;
}

export function AgentAccessList() {
  const [agents, setAgents] = useState<AgentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch("/api/agents")
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        setAgents(((await r.json()) as { agents: AgentRecord[] }).agents);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  const act = async (name: string, method: "DELETE" | "PUT", decision?: AgentRecord["decision"]) => {
    await fetch(`/api/agents/${encodeURIComponent(name)}`, {
      method,
      headers: decision ? { "content-type": "application/json" } : {},
      body: decision ? JSON.stringify({ decision }) : undefined,
    }).catch(() => undefined);
    load();
  };

  return (
    <section aria-labelledby="of-agent-access" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "16px 24px", borderBottom: "1px solid var(--of-hairline)" }}>
      <span id="of-agent-access" style={{ fontWeight: 600, fontSize: "var(--of-text-xs)" }}>{t("settings.agents.access")}</span>
      <span className="of-hint">{t("settings.agents.accessHint")}</span>
      {error ? <span className="of-hint" style={{ color: "var(--of-danger)" }}>{t("settings.agents.error", { error })}</span> : null}
      {agents && agents.length === 0 ? <span className="of-hint">{t("settings.agents.none")}</span> : null}
      {agents?.map((a) => {
        const allowed = a.decision === "allow";
        return (
          <div key={a.name} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40 }}>
            <AgentAvatar client={a.name} size={24} shape="square" />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: 600, fontSize: "var(--of-text-md)" }}>
                {clientLabel(a.name)} <span className="of-mono of-muted" style={{ fontWeight: 400, fontSize: "var(--of-text-xs)" }}>{a.name}</span>
              </span>
              <span className="of-hint" style={{ color: allowed ? "var(--of-success)" : "var(--of-danger)" }}>
                {t("settings.agents.decided", { decision: t(allowed ? "settings.agents.allowed" : "settings.agents.denied"), ago: relativeTime(a.decidedAt) })}
              </span>
            </div>
            {allowed ? null : (
              <Button size="sm" onClick={() => void act(a.name, "PUT", "allow")}>
                {t("settings.agents.allow")}
              </Button>
            )}
            <Button size="sm" variant={allowed ? "danger" : "ghost"} onClick={() => void act(a.name, "DELETE")}>
              {t(allowed ? "settings.agents.revoke" : "settings.agents.forget")}
            </Button>
          </div>
        );
      })}
    </section>
  );
}
