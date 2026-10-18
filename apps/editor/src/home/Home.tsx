// Files home: local workspace browser (recent, starred, folders), search and file grid.
import "../ui";
import "./home.css";
import { useMemo, useState, useSyncExternalStore } from "react";
import { t } from "../i18n";
import type { FileEntry } from "../state/api";
import { api } from "../state/api";
import { closeFile, createAndOpenFile, getOpenFile, openFile } from "../state/workspace";
import { AgentAvatar, Button, clientLabel, fuzzyFilter, Icon, InlineRename, Tooltip, useMenu } from "../ui";
import { refreshFiles, tildePath, useFiles, useServerStatus } from "../panels/files";
import { openConnectDialog, useMinuteTick, useRecentAgents } from "../panels/shared";
import { cardMeta, editedAgo } from "./time";
import { desktop } from "../desktop/desktop";

// ---------------------------------------------------------------- stars (local preference)
const STAR_KEY = "opencrease.starred";
const starListeners = new Set<() => void>();
function readStars(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STAR_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
let stars = readStars();
function toggleStar(id: string) {
  stars = stars.includes(id) ? stars.filter((s) => s !== id) : [...stars, id];
  try {
    localStorage.setItem(STAR_KEY, JSON.stringify(stars));
  } catch {
    /* ignore */
  }
  starListeners.forEach((l) => l());
}
function useStars(): string[] {
  return useSyncExternalStore(
    (l) => {
      starListeners.add(l);
      return () => starListeners.delete(l);
    },
    () => stars,
  );
}

type View = { kind: "recent" } | { kind: "starred" } | { kind: "folder"; folder: string };

interface FolderNode {
  path: string;
  name: string;
  depth: number;
  count: number;
}

function folderTree(files: FileEntry[]): FolderNode[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    const parts = f.folder ? f.folder.split("/") : [];
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join("/");
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  return [...counts.keys()].sort().map((p) => ({ path: p, name: p.split("/").pop() ?? p, depth: p.split("/").length, count: counts.get(p) ?? 0 }));
}

function folderDisplay(folder: string, workspace: string | undefined): string {
  const ws = workspace ? tildePath(workspace) : "";
  return folder ? `${ws ? `${ws}/` : ""}${folder}` : ws || t("home.nav.workspace");
}

export function Home() {
  const { files, error } = useFiles();
  const status = useServerStatus();
  const starred = useStars();
  const agents = useRecentAgents();
  useMinuteTick();
  const [view, setView] = useState<View>({ kind: "recent" });
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [menu, openMenu] = useMenu();

  const all = files ?? [];
  const folders = useMemo(() => folderTree(all), [all]);
  const visible = useMemo(() => {
    let list = [...all].sort((a, b) => b.updatedAt - a.updatedAt);
    if (view.kind === "starred") list = list.filter((f) => starred.includes(f.id));
    if (view.kind === "folder") list = list.filter((f) => f.folder === view.folder || f.folder.startsWith(`${view.folder}/`));
    return fuzzyFilter(list, query, (f) => [f.name, f.folder]);
  }, [all, view, starred, query]);

  const newFile = async (folder?: string) => {
    setCreating(true);
    try {
      if (folder !== undefined) {
        const created = await api.createFile({ folder });
        void refreshFiles();
        await openFile(created.id);
      } else {
        await createAndOpenFile();
        void refreshFiles();
      }
    } catch (e) {
      alert(t("home.error.create", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setCreating(false);
    }
  };

  const rename = async (f: FileEntry, name: string) => {
    try {
      await api.renameFile(f.id, name);
      const open = getOpenFile(f.id);
      if (open) open.store.transact("Rename file", (tx) => tx.setDocName(name));
    } catch (e) {
      alert(t("home.error.rename", { error: e instanceof Error ? e.message : String(e) }));
    }
    void refreshFiles();
  };

  const cardMenu = (f: FileEntry, at: { x: number; y: number }) =>
    openMenu(
      [
        { label: t("home.menu.open"), onSelect: () => void openFile(f.id) },
        { label: t("home.menu.rename"), onSelect: () => setRenaming(f.id) },
        {
          label: t("home.menu.duplicate"),
          onSelect: async () => {
            await api.createFile({ cloneFileId: f.id, name: t("home.card.copyName", { name: f.name }) });
            void refreshFiles();
          },
        },
        { label: starred.includes(f.id) ? t("home.menu.unstar") : t("home.menu.star"), onSelect: () => toggleStar(f.id) },
        { type: "separator" },
        {
          label: t("home.menu.trash"),
          danger: true,
          onSelect: async () => {
            if (!confirm(t("home.menu.trashConfirm", { name: f.name }))) return;
            if (getOpenFile(f.id)) closeFile(f.id);
            await api.deleteFile(f.id).catch((e) => alert(String(e)));
            void refreshFiles();
          },
        },
      ],
      at,
    );

  const title = view.kind === "recent" ? t("home.nav.recent") : view.kind === "starred" ? t("home.nav.starred") : (view.folder.split("/").pop() ?? t("home.folder.fallbackTitle"));
  const subtitle =
    view.kind === "folder"
      ? folderDisplay(view.folder, status?.workspace)
      : t("home.subtitle", { workspace: status ? tildePath(status.workspace) : t("home.subtitle.workspaceFallback") });

  return (
    <div className="of-home">
      <aside className="of-home-side">
        <div className="of-home-brand">
          <Icon name="home" size={22} />
          OpenCrease
        </div>
        <nav className="of-home-nav" aria-label="Files">
          <button className={`of-home-item${view.kind === "recent" ? " on" : ""}`} onClick={() => setView({ kind: "recent" })}>
            <Icon name="clock" size={15} />
            <span className="label">{t("home.nav.recent")}</span>
          </button>
          <button className={`of-home-item${view.kind === "starred" ? " on" : ""}`} onClick={() => setView({ kind: "starred" })}>
            <Icon name="star" size={15} />
            <span className="label">{t("home.nav.starred")}</span>
            {starred.length ? <span className="count">{all.filter((f) => starred.includes(f.id)).length}</span> : null}
          </button>
        </nav>
        <div className="of-home-nav">
          <div className="of-list-head" style={{ padding: "0 4px 0 8px" }}>
            <span className="of-caps" style={{ flex: 1 }}>{t("home.nav.folders")}</span>
            <Tooltip label={t("home.folder.newTooltip")}>
              <button
                className="of-icon-btn xs"
                aria-label={t("home.folder.new")}
                onClick={() => {
                  const name = prompt(t("home.folder.prompt"));
                  const clean = name?.trim().replace(/^\/+|\/+$/g, "");
                  if (clean) void newFile(clean);
                }}
              >
                <Icon name="plus" size={12} />
              </button>
            </Tooltip>
          </div>
          <button className={`of-home-item${view.kind === "folder" && view.folder === "" ? " on" : ""}`} onClick={() => setView({ kind: "folder", folder: "" })} title={status?.workspace}>
            <Icon name="folder" size={15} />
            <span className="label">{status ? tildePath(status.workspace) : t("home.nav.workspace")}</span>
            <span className="count">{all.length}</span>
          </button>
          {folders.map((f) => (
            <button
              key={f.path}
              className={`of-home-item${view.kind === "folder" && view.folder === f.path ? " on" : ""}`}
              style={{ paddingLeft: 8 + f.depth * 16 }}
              onClick={() => setView({ kind: "folder", folder: f.path })}
            >
              <Icon name="folder" size={15} />
              <span className="label">{f.name}</span>
              <span className="count">{f.count}</span>
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div className="of-home-agent">
          {agents.length ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AgentAvatar client={agents[0].name} size={20} />
                <span style={{ flex: 1, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{clientLabel(agents[0].name)}</span>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--of-success)" }} />
              </div>
              <span className="of-hint">
                {t("home.agent.connected", { more: agents.length - 1, ago: editedAgo(agents[0].lastSeen) })}
              </span>
              <Button onClick={openConnectDialog}>{t("home.agent.connectAnother")}</Button>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 20, height: 20, borderRadius: 999, background: "var(--of-chrome)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--of-muted)" }}>
                  <Icon name="plug" size={12} />
                </span>
                <span style={{ flex: 1, fontWeight: 600 }}>{t("home.agent.none")}</span>
              </div>
              <span className="of-hint">{t("home.agent.noneHint")}</span>
              <Button onClick={openConnectDialog}>{t("home.agent.connect")}</Button>
            </>
          )}
        </div>
      </aside>
      <main className="of-home-main">
        <div className="of-home-header">
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="of-home-title">{title}</div>
            <div className="of-muted" style={{ fontSize: "var(--of-text-sm)" }}>{subtitle}</div>
          </div>
          <label className="of-home-search">
            <Icon name="search" size={13} />
            <input aria-label={t("home.search.placeholder")} placeholder={t("home.search.placeholder")} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} />
          </label>
          {desktop ? (
            <Tooltip label={t("home.openFolder.hint")}>
              <Button size="md" onClick={() => void desktop!.openFolder()}>{t("home.openFolder")}</Button>
            </Tooltip>
          ) : (
            <Tooltip label={t("home.openFolder.desktop")}>
              <Button size="md" disabled>{t("home.openFolder")}</Button>
            </Tooltip>
          )}
          <Button size="md" variant="primary" disabled={creating} onClick={() => void newFile(view.kind === "folder" ? view.folder : undefined)}>
            <Icon name="plus" size={12} /> {t("home.newFile")}
          </Button>
        </div>
        {error ? <div className="of-hint" style={{ color: "var(--of-danger)" }}>{t("home.error.server", { error })}</div> : null}
        <div className="of-grid">
          {visible.map((f) => (
            <FileCard
              key={f.id}
              file={f}
              workspace={status?.workspace}
              starred={starred.includes(f.id)}
              renaming={renaming === f.id}
              onRenaming={(v) => setRenaming(v ? f.id : null)}
              onRename={(n) => void rename(f, n)}
              onMenu={(at) => cardMenu(f, at)}
            />
          ))}
          {!query && view.kind !== "starred" ? (
            <button className="of-card-new" onClick={() => void newFile(view.kind === "folder" ? view.folder : undefined)} disabled={creating}>
              <Icon name="plus" size={18} />
              <span style={{ fontWeight: 500 }}>{t("home.newFile")}</span>
              <span className="of-hint">{t("home.newFile.hint")}</span>
            </button>
          ) : null}
        </div>
        {files && visible.length === 0 && (query || view.kind === "starred") ? (
          <div className="of-hint">{query ? t("home.empty.query", { query }) : t("home.empty.starred")}</div>
        ) : null}
      </main>
      {menu}
    </div>
  );
}

function FileCard({
  file, workspace, starred, renaming, onRenaming, onRename, onMenu,
}: {
  file: FileEntry;
  workspace: string | undefined;
  starred: boolean;
  renaming: boolean;
  onRenaming: (v: boolean) => void;
  onRename: (name: string) => void;
  onMenu: (at: { x: number; y: number }) => void;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const folder = file.folder ? file.folder.split("/").join(" / ") : "";
  void workspace;
  return (
    <div
      className="of-card-file"
      tabIndex={0}
      role="group"
      aria-label={t("home.card.open", { name: file.name })}
      onClick={() => !renaming && void openFile(file.id)}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !renaming && e.target === e.currentTarget) { e.preventDefault(); void openFile(file.id); }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className="of-card-thumb">
        {file.hasThumbnail !== false && !thumbFailed ? (
          <img src={api.thumbnailUrl(file.id, file.updatedAt)} alt="" onError={() => setThumbFailed(true)} draggable={false} />
        ) : (
          <div className="of-card-initial">{(file.name.trim()[0] ?? "?").toUpperCase()}</div>
        )}
      </div>
      <div className="of-card-meta">
        <div className="text">
          <div className="name" title={file.name}>
            <InlineRename value={file.name} editing={renaming} onEditingChange={onRenaming} onCommit={onRename} style={{ overflow: "hidden", textOverflow: "ellipsis" }} />
          </div>
          <div className="sub" title={file.path}>
            {cardMeta(file.updatedAt, folder)}
          </div>
        </div>
        {starred ? <Icon name="star" size={14} className="of-card-star" /> : null}
        <button
          className="of-icon-btn xs"
          aria-label={t("home.card.actions")}
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            onMenu({ x: r.left, y: r.bottom + 4 });
          }}
        >
          <Icon name="more" size={14} />
        </button>
      </div>
    </div>
  );
}
