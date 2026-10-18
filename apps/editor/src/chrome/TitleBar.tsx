// Title bar: home button, open file tabs, save status, file path and agent bridge status.
import { useEffect, useState } from "react";
import { useWorkspace } from "../state/hooks";
import { api } from "../state/api";
import { closeFile, goHome, openFile, type OpenFile } from "../state/workspace";
import { CloseIcon, LogoIcon, PlusIcon } from "./icons";
import "./titlebar.css";

const SAVE_LABEL: Record<OpenFile["saveState"], string> = {
  saved: "Saved",
  saving: "Saving",
  dirty: "Unsaved changes",
  error: "Save failed",
};

/** Shorten an absolute path for display: /Users/me/Design/x.fold → ~/Design/x.fold */
export function displayPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~").replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~");
}

function useFilePaths(openIds: string): Record<string, string> {
  const [paths, setPaths] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!openIds) return;
    let cancelled = false;
    api
      .listFiles()
      .then((files) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const f of files) next[f.id] = f.path;
        setPaths(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [openIds]);
  return paths;
}

function Tab({ file, active, agentBusy }: { file: OpenFile; active: boolean; agentBusy: boolean }) {
  const name = useWorkspace(() => file.store.doc.name);
  const dirty = file.saveState === "dirty" || file.saveState === "saving" || file.saveState === "error";
  return (
    <div
      className="of-filetab"
      data-active={active || undefined}
      role="group"
      aria-label={name}
      title={name}
      onAuxClick={(e) => {
        if (e.button === 1) closeFile(file.id);
      }}
    >
      {agentBusy && <span className="of-filetab-dot" style={{ background: "var(--of-agent)" }} role="img" aria-label="Agent working" />}
      <button type="button" className="of-filetab-name" aria-current={active ? "page" : undefined} style={{ all: "unset", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "default" }} onClick={() => void openFile(file.id)}>{name}</button>
      <button
        type="button"
        className="of-filetab-close"
        aria-label={`Close ${name}`}
        data-dirty={dirty || undefined}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          closeFile(file.id);
        }}
      >
        <span className="of-filetab-unsaved" aria-hidden />
        <CloseIcon />
      </button>
    </div>
  );
}

export function TitleBar() {
  const openFiles = useWorkspace((s) => s.openFiles);
  const activeFileId = useWorkspace((s) => s.activeFileId);
  const route = useWorkspace((s) => s.route);
  const bridgeConnected = useWorkspace((s) => s.bridgeConnected);
  const agentWork = useWorkspace((s) => s.agentWork);
  useWorkspace((s) => s.docVersion); // re-render on renames
  const paths = useFilePaths(openFiles.map((f) => `${f.id}:${f.store.doc.name}`).join(","));
  const onHome = route.kind === "home" || !activeFileId;
  const active = onHome ? undefined : openFiles.find((f) => f.id === activeFileId);
  const path = active ? paths[active.id] : undefined;

  return (
    <header className="of-titlebar" data-of-chrome="">
      <button
        type="button"
        className="of-titlebar-home"
        data-active={onHome || undefined}
        aria-label="Files"
        title="Files"
        onClick={goHome}
      >
        <LogoIcon />
      </button>
      <nav className="of-filetabs" aria-label="Open files">
        {openFiles.map((f) => (
          <Tab
            key={f.id}
            file={f}
            active={!onHome && f.id === activeFileId}
            agentBusy={Object.keys(agentWork[f.id] ?? {}).length > 0}
          />
        ))}
        <button type="button" className="of-filetab-new" aria-label="Open another file" title="Open another file" onClick={goHome}>
          <PlusIcon />
        </button>
      </nav>
      <div className="of-titlebar-spacer" />
      <div className="of-titlebar-status">
        {active && (
          <span className="of-save-state" data-state={active.saveState}>
            {SAVE_LABEL[active.saveState]}
          </span>
        )}
        {active && path && (
          <span className="of-file-path" title={path}>
            {displayPath(path)}
          </span>
        )}
        <span
          className="of-bridge-dot"
          data-on={bridgeConnected || undefined}
          role="status"
          aria-label={bridgeConnected ? "Agent bridge connected" : "Agent bridge offline"}
          title={bridgeConnected ? "Agent bridge connected" : "Agent bridge offline"}
        />
      </div>
    </header>
  );
}
