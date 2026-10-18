// "Add automatically" in the Connect dialog (desktop app only): previews the exact change to the
// agent's config file, writes it after confirmation, and keeps a backup of the old file.
import { useState } from "react";
import type { AgentClientId, AgentConfigDiffLine, AgentConfigPreview } from "@opencrease/protocol";
import { desktop } from "../desktop/desktop";
import { tildePath } from "../panels/files";
import { Button, Icon } from "../ui";

const CLIENTS = new Set<string>(["claude-code", "codex", "cursor", "vscode", "zed", "opencode"]);

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "preview"; preview: AgentConfigPreview; changed?: boolean }
  | { kind: "writing"; preview: AgentConfigPreview }
  | { kind: "done"; path: string; backupPath: string | null; note: string }
  | { kind: "error"; message: string };

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function DiffView({ lines }: { lines: AgentConfigDiffLine[] }) {
  return (
    <div className="of-diff" role="figure" aria-label="Change to the config file">
      {lines.map((l, i) => (
        <div key={i} className={`of-diff-line ${l.kind}`}>
          <span className="sign" aria-hidden>
            {l.kind === "add" ? "+" : l.kind === "remove" ? "-" : ""}
          </span>
          <span className="text">{l.kind === "skip" ? l.text : l.text || " "}</span>
        </div>
      ))}
    </div>
  );
}

/** Renders nothing outside the desktop app or for clients it cannot configure. */
export function AutoConnect({ client, name }: { client: string; name: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  if (!desktop || !CLIENTS.has(client)) return null;
  const bridge = desktop;

  const preview = async () => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "preview", preview: await bridge.previewAgentConfig(client as AgentClientId) });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e) });
    }
  };

  const apply = async (p: AgentConfigPreview) => {
    setState({ kind: "writing", preview: p });
    const r = await bridge.applyAgentConfig(p.planId).catch((e: unknown) => ({ status: "error" as const, message: String(e) }));
    if (r.status === "written") setState({ kind: "done", path: r.path, backupPath: r.backupPath, note: p.note });
    else if (r.status === "changed") setState({ kind: "preview", preview: r.preview, changed: true });
    else setState({ kind: "error", message: r.message });
  };

  if (state.kind === "idle" || state.kind === "loading" || state.kind === "error") {
    return (
      <div className="of-auto-connect">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button size="md" variant="primary" style={{ height: 30 }} disabled={state.kind === "loading"} onClick={() => void preview()}>
            Add automatically
          </Button>
          <span className="of-hint" style={{ flex: 1 }}>
            OpenCrease edits the {name} config for you. You see the change before anything is written.
          </span>
        </div>
        {state.kind === "error" ? <span className="of-hint" style={{ color: "var(--of-danger)" }}>{state.message}</span> : null}
      </div>
    );
  }

  if (state.kind === "done") {
    return (
      <div className="of-auto-connect">
        <div className="of-auto-connect-ok">
          <Icon name="check" size={13} />
          <span>
            Added to <span className="of-mono">{tildePath(state.path)}</span>
          </span>
        </div>
        <span className="of-hint">
          {state.backupPath ? <>The previous file is saved as <span className="of-mono">{fileName(state.backupPath)}</span> next to it. </> : null}
          {state.note}
        </span>
      </div>
    );
  }

  const p = state.preview;
  if (p.upToDate) {
    return (
      <div className="of-auto-connect">
        <div className="of-auto-connect-ok">
          <Icon name="check" size={13} />
          <span>
            Already set up in <span className="of-mono">{tildePath(p.path)}</span>
          </span>
        </div>
        <span className="of-hint">{p.note}</span>
      </div>
    );
  }

  return (
    <div className="of-auto-connect">
      <div className="of-auto-connect-head">
        <span className="of-mono path" title={p.path}>{tildePath(p.path)}</span>
        <span className="of-auto-connect-badge">{p.creates ? "New file" : "Edit"}</span>
      </div>
      {state.kind === "preview" && state.changed ? (
        <span className="of-hint" style={{ color: "var(--of-accent-ink)" }}>The file changed since the preview. This is the change now.</span>
      ) : null}
      <DiffView lines={p.diff} />
      <span className="of-hint">
        {p.backupPath ? <>A copy of the current file is saved as <span className="of-mono">{fileName(p.backupPath)}</span> first.</> : "The file and its folder are created."}
      </span>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button size="md" style={{ height: 30 }} disabled={state.kind === "writing"} onClick={() => setState({ kind: "idle" })}>
          Cancel
        </Button>
        <Button size="md" variant="primary" style={{ height: 30 }} disabled={state.kind === "writing"} onClick={() => void apply(p)}>
          {p.creates ? "Create file" : "Write change"}
        </Button>
      </div>
    </div>
  );
}
