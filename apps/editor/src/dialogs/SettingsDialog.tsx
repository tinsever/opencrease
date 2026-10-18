import { CanvasSettings } from "./CanvasSettings";
// Settings window: General, Agents, Design guide (layered guide editor), Shortcuts.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { t, type MessageId } from "../i18n";
import { api, type GuideLayer } from "../state/api";
import { useWorkspace } from "../state/hooks";
import { Icon, Toggle } from "../ui";
import { tildePath, useServerStatus } from "../panels/files";
import { TokenSettings } from "./TokenSettings";
import { AgentAccessList } from "./AgentAccess";
import { AgentSetupList } from "./ConnectDialog";
import { AiSettingsPage } from "./AiSettingsPage";
import { connectInfo } from "./connect";
import { Dialog } from "./Dialog";
import { overridingLayer, REQUIRED_STEP_LABELS, REQUIRED_STEPS, stepsAtLayer, toggleStep } from "./guide";

export type SettingsPage = "general" | "agents" | "guide" | "ai" | "shortcuts";

const PAGES: SettingsPage[] = ["general", "agents", "guide", "ai", "shortcuts"];
const PAGE_LABEL: Record<SettingsPage, MessageId> = {
  ai: "settings.page.ai",
  general: "settings.page.general",
  agents: "settings.page.agents",
  guide: "settings.page.guide",
  shortcuts: "settings.page.shortcuts",
};
const PAGE_SUB: Record<SettingsPage, MessageId> = {
  ai: "settings.sub.ai",
  general: "settings.sub.general",
  agents: "settings.sub.agents",
  guide: "settings.sub.guide",
  shortcuts: "settings.sub.shortcuts",
};

export function SettingsDialog({ initialPage, onClose }: { initialPage: SettingsPage; onClose: () => void }) {
  const [page, setPage] = useState<SettingsPage>(initialPage);
  return (
    <Dialog onClose={onClose} width={880} top="8vh" label={t("settings.title")}>
      <div className="of-settings">
        <nav className="of-settings-side" aria-label={t("settings.title")}>
          <div className="stitle">{t("settings.title")}</div>
          {PAGES.map((p) => (
            <button key={p} className={`of-home-item${p === page ? " on" : ""}`} aria-current={p === page ? "page" : undefined} style={{ fontSize: "var(--of-text-sm)" }} onClick={() => setPage(p)}>
              <span className="label">{t(PAGE_LABEL[p])}</span>
            </button>
          ))}
        </nav>
        <div className="of-settings-main">
          <div className="of-dlg-head">
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <h2 className="of-dlg-title" style={{ margin: 0 }}>{t(PAGE_LABEL[page])}</h2>
              <div className="of-dlg-sub">{t(PAGE_SUB[page])}</div>
            </div>
            <button className="of-icon-btn sm" aria-label={t("settings.close")} onClick={onClose}>
              <Icon name="close" size={14} />
            </button>
          </div>
          {page === "guide" ? (
            <GuidePage />
          ) : page === "ai" ? <AiSettingsPage /> : page === "agents" ? (
            <div className="of-settings-body" style={{ padding: 0 }}>
              <TokenSettings />
              <AgentAccessList />
              <AgentSetupList />
            </div>
          ) : page === "general" ? (
            <GeneralPage />
          ) : (
            <ShortcutsPage />
          )}
        </div>
      </div>
    </Dialog>
  );
}

function GeneralPage() {
  const status = useServerStatus();
  const bridge = useWorkspace((s) => s.bridgeConnected);
  const loading = t("settings.loading");
  const row = (k: string, v: ReactNode) => (
    <div className="of-shortcut-row" style={{ height: 40 }}>
      <span className="of-muted">{k}</span>
      <span className="of-mono" style={{ fontSize: "var(--of-text-xs)" }}>{v}</span>
    </div>
  );
  return (
    <div className="of-settings-body">
      <CanvasSettings />
      {row(t("settings.general.workspace"), status ? tildePath(status.workspace) : loading)}
      {row(t("settings.general.mcp"), status ? connectInfo(status).url : loading)}
      {row(t("settings.general.stdio"), status ? connectInfo(status).stdio : loading)}
      {row(t("settings.general.token"), t("settings.general.tokenHint", { path: "$OPENCREASE_HOME/token (default ~/.opencrease/token)" }))}
      {row(t("settings.general.bridge"), bridge ? t("settings.general.bridge.on") : t("settings.general.bridge.off"))}
      {row(t("settings.general.version"), status?.version ?? "")}
      <p className="of-hint" style={{ marginTop: 16 }}>{t("settings.general.hint", { example: "opencrease ~/Design" })}</p>
    </div>
  );
}

const SHORTCUTS: Array<[MessageId, MessageId]> = [
  ["settings.shortcut.command_palette", "settings.shortcut.command_palette.keys"], ["settings.shortcut.undo", "settings.shortcut.undo.keys"], ["settings.shortcut.redo", "settings.shortcut.redo.keys"], ["settings.shortcut.duplicate", "settings.shortcut.duplicate.keys"], ["settings.shortcut.delete", "settings.shortcut.delete.keys"], ["settings.shortcut.wrap_in_frame", "settings.shortcut.wrap_in_frame.keys"],
  ["settings.shortcut.add_flex_layout", "settings.shortcut.add_flex_layout.keys"], ["settings.shortcut.select_all", "settings.shortcut.select_all.keys"], ["settings.shortcut.copy_cut_paste", "settings.shortcut.copy_cut_paste.keys"], ["settings.shortcut.move_tool", "settings.shortcut.move_tool.keys"], ["settings.shortcut.frame_tool", "settings.shortcut.frame_tool.keys"],
  ["settings.shortcut.rectangle_tool", "settings.shortcut.rectangle_tool.keys"], ["settings.shortcut.text_tool", "settings.shortcut.text_tool.keys"], ["settings.shortcut.image", "settings.shortcut.image.keys"], ["settings.shortcut.hand_tool", "settings.shortcut.hand_tool.keys"], ["settings.shortcut.zoom_to_fit", "settings.shortcut.zoom_to_fit.keys"], ["settings.shortcut.zoom_to_selection", "settings.shortcut.zoom_to_selection.keys"],
  ["settings.shortcut.zoom_to_100", "settings.shortcut.zoom_to_100.keys"], ["settings.shortcut.zoom_in_out", "settings.shortcut.zoom_in_out.keys"], ["settings.shortcut.nudge", "settings.shortcut.nudge.keys"], ["settings.shortcut.select_parent", "settings.shortcut.select_parent.keys"], ["settings.shortcut.select_first_child", "settings.shortcut.select_first_child.keys"],
  ["settings.shortcut.scale_tool", "settings.shortcut.scale_tool.keys"], ["settings.shortcut.zoom_tool", "settings.shortcut.zoom_tool.keys"], ["settings.shortcut.paste_to_replace", "settings.shortcut.paste_to_replace.keys"], ["settings.shortcut.copy_as_png", "settings.shortcut.copy_as_png.keys"],
  ["settings.shortcut.copy_as_react", "settings.shortcut.copy_as_react.keys"], ["settings.shortcut.copy_as_tailwind", "settings.shortcut.copy_as_tailwind.keys"], ["settings.shortcut.collapse_all_layers", "settings.shortcut.collapse_all_layers.keys"], ["settings.shortcut.next_previous_sibling", "settings.shortcut.next_previous_sibling.keys"],
  ["settings.shortcut.layers_under_cursor", "settings.shortcut.layers_under_cursor.keys"], ["settings.shortcut.pan_empty_selection", "settings.shortcut.pan_empty_selection.keys"], ["settings.shortcut.scroll_horizontally", "settings.shortcut.scroll_horizontally.keys"],
  ["settings.shortcut.tidy", "settings.shortcut.tidy.keys"],
  ["settings.shortcut.component", "settings.shortcut.component.keys"],
  ["settings.shortcut.detach", "settings.shortcut.detach.keys"],
  ["settings.shortcut.vector_tools", "settings.shortcut.vector_tools.keys"],
  ["settings.shortcut.hide_interface", "settings.shortcut.hide_interface.keys"],
  ["settings.shortcut.generate_image", "settings.shortcut.generate_image.keys"], ["settings.shortcut.generate_svg", "settings.shortcut.generate_svg.keys"],
];

function ShortcutsPage() {
  return (
    <div className="of-settings-body" style={{ columns: 2, columnGap: 32 }}>
      {SHORTCUTS.map(([k, v]) => (
        <div key={k} className="of-shortcut-row" style={{ breakInside: "avoid" }}>
          <span>{t(k)}</span>
          <span className="of-kbd">{t(v)}</span>
        </div>
      ))}
    </div>
  );
}

type SaveState = "saved" | "dirty" | "saving" | "error";

function GuidePage() {
  const fileId = useWorkspace((s) => (s.route.kind === "file" ? s.activeFileId : null));
  const [layers, setLayers] = useState<GuideLayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GuideLayer["id"]>(fileId ? "file" : "user");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [save, setSave] = useState<SaveState>("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    api
      .getGuide(fileId ?? undefined)
      .then((g) => {
        setLayers(g.layers);
        setDrafts(Object.fromEntries(g.layers.map((l) => [l.id, l.content])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [fileId]);

  const layer = layers?.find((l) => l.id === selected) ?? layers?.[0];
  const content = layer ? (drafts[layer.id] ?? layer.content) : "";

  const persist = useCallback(
    async (id: GuideLayer["id"], text: string) => {
      if (id === "builtin") return;
      setSave("saving");
      try {
        const res = await api.saveGuide(id, text, id === "file" ? (fileId ?? undefined) : undefined);
        if (!res.ok) throw new Error(`${res.status}`);
        setSave("saved");
      } catch {
        setSave("error");
      }
    },
    [fileId],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  const edit = (text: string) => {
    if (!layer || !layer.editable) return;
    setDrafts((d) => ({ ...d, [layer.id]: text }));
    setSave("dirty");
    clearTimeout(timer.current);
    const id = layer.id;
    timer.current = setTimeout(() => void persist(id, text), 700);
  };

  if (error) return <div className="of-settings-body of-hint" style={{ color: "var(--of-danger)" }}>{t("settings.guide.loadError", { error })}</div>;
  if (!layers || !layer) return <div className="of-settings-body of-hint">{t("settings.guide.loading")}</div>;

  const describe = (l: GuideLayer) =>
    l.id === "builtin"
      ? { title: t("settings.guide.layer.builtin"), sub: t("settings.guide.layer.builtinSub") }
      : l.id === "user"
        ? { title: t("settings.guide.layer.user"), sub: tildePath(l.path) }
        : { title: t("settings.guide.layer.file"), sub: l.path.split("/").slice(-2).join("/") };
  const saveLabel = !layer.editable
    ? t("settings.guide.save.readOnly")
    : t(save === "saved" ? "settings.guide.save.saved" : save === "saving" ? "settings.guide.save.saving" : save === "dirty" ? "settings.guide.save.dirty" : "settings.guide.save.error");
  const saveColor = !layer.editable ? "var(--of-muted)" : save === "saved" ? "var(--of-success)" : save === "error" ? "var(--of-danger)" : "var(--of-muted)";

  // required steps: the last layer with a "## Required steps" list wins
  const contents = layers.map((l) => drafts[l.id] ?? l.content);
  const index = layers.indexOf(layer);
  const active = stepsAtLayer(contents, index);
  const override = overridingLayer(contents, index);
  const stepsHint = !layer.editable
    ? t("settings.guide.steps.readOnly")
    : override !== -1
      ? t("settings.guide.steps.overridden", { layer: describe(layers[override]).title })
      : t("settings.guide.steps.inLayer", { layer: describe(layer).title });

  return (
    <div className="of-settings-body" style={{ display: "flex", gap: 20, minHeight: 0, overflow: "hidden" }}>
      <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" }}>
        <span id="of-guide-layers" style={{ fontWeight: 600, fontSize: "var(--of-text-xs)" }}>{t("settings.guide.layers")}</span>
        <div className="of-guide-layers" role="listbox" aria-labelledby="of-guide-layers">
          {layers.map((l, i) => {
            const d = describe(l);
            return (
              <button key={l.id} role="option" aria-selected={l.id === layer.id} className={`of-guide-layer${l.id === layer.id ? " on" : ""}`} onClick={() => setSelected(l.id)}>
                <span className="num">{i + 1}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span className="l1">{d.title}</span>
                  <span className="l2" title={l.path}>{d.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
        {!fileId ? <span className="of-hint">{t("settings.guide.openFile")}</span> : null}
        <span style={{ fontWeight: 600, fontSize: "var(--of-text-xs)", marginTop: 8 }}>{t("settings.guide.steps")}</span>
        <span className="of-hint" style={{ marginTop: -4 }}>{stepsHint}</span>
        {REQUIRED_STEPS.map((step) => {
          const label = REQUIRED_STEP_LABELS[step];
          return (
            <label key={step} className="of-row" style={{ minHeight: 24, gap: 8 }}>
              <span style={{ flex: 1, fontSize: "var(--of-text-sm)", color: "var(--of-ink-2)" }}>{label}</span>
              <Toggle label={label} on={active.includes(step)} disabled={!layer.editable} onChange={(v) => edit(toggleStep(contents, index, step, v))} />
            </label>
          );
        })}
      </div>
      <div className="of-guide-editor" style={{ flex: 1, minWidth: 0 }}>
        <div className="ghead">
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={layer.path}>{tildePath(layer.path)}</span>
          <span role="status" style={{ color: saveColor, fontFamily: "var(--of-font-sans)", fontWeight: 500 }}>{saveLabel}</span>
        </div>
        <textarea
          aria-label={describe(layer).title}
          value={content}
          readOnly={!layer.editable}
          spellCheck={false}
          placeholder={layer.id === "file" ? t("settings.guide.placeholder.file") : t("settings.guide.placeholder.user")}
          onChange={(e) => edit(e.target.value)}
          onBlur={() => {
            if (save === "dirty") {
              clearTimeout(timer.current);
              void persist(layer.id, content);
            }
          }}
          style={{ color: layer.editable ? undefined : "var(--of-ink-2)" }}
        />
      </div>
    </div>
  );
}
