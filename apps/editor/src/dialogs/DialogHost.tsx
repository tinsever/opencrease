// Renders the app dialogs in response to window events:
// opencrease:connect-agent, opencrease:settings ({ detail: { page } }), opencrease:command-palette,
// opencrease:ai-generate ({ detail: { mode: "image" | "edit" | "svg" } }).
import "../ui";
import "./dialogs.css";
import "./ai.css";
import { useCallback, useEffect, useState } from "react";
import { PluginsDialog } from "./PluginsDialog";
import { HistoryDialog } from "./HistoryDialog";
import { getActiveFile } from "../state/workspace";
import { IconDefs } from "../ui";
import { NoticeHost } from "../ui/Notice";
import { LibraryHost } from "./LibraryHost";
import { AiGenerateDialog, type AiGenerateMode } from "./AiGenerateDialog";
import { CommandPalette } from "./CommandPalette";
import { ConnectDialog } from "./ConnectDialog";
import { SettingsDialog, type SettingsPage } from "./SettingsDialog";

type Open = { kind: "connect" } | { kind: "settings"; page: SettingsPage } | { kind: "palette" } | { kind: "ai"; mode: AiGenerateMode } | { kind: "plugins"; fileId: string } | { kind: "history"; fileId: string } | null;

export function DialogHost() {
  const [open, setOpen] = useState<Open>(null);
  const close = useCallback(() => setOpen(null), []);
  useEffect(() => {
    const connect = () => setOpen({ kind: "connect" });
    const settings = (e: Event) => {
      const page = (e as CustomEvent<{ page?: SettingsPage } | undefined>).detail?.page ?? "guide";
      setOpen({ kind: "settings", page });
    };
    const plugins = () => { const f = getActiveFile(); if (f) setOpen({ kind: "plugins", fileId: f.id }); };
    const history = () => { const f = getActiveFile(); if (f) setOpen({ kind: "history", fileId: f.id }); };
    window.addEventListener("opencrease:plugins", plugins);
    window.addEventListener("opencrease:history", history);
    const palette = () => setOpen((o) => (o?.kind === "palette" ? null : { kind: "palette" }));
    const ai = (e: Event) => {
      const mode = (e as CustomEvent<{ mode?: AiGenerateMode } | undefined>).detail?.mode ?? "image";
      setOpen({ kind: "ai", mode });
    };
    window.addEventListener("opencrease:connect-agent", connect);
    window.addEventListener("opencrease:settings", settings);
    window.addEventListener("opencrease:command-palette", palette);
    window.addEventListener("opencrease:ai-generate", ai);
    return () => {
      window.removeEventListener("opencrease:plugins", plugins);
      window.removeEventListener("opencrease:history", history);
      window.removeEventListener("opencrease:connect-agent", connect);
      window.removeEventListener("opencrease:settings", settings);
      window.removeEventListener("opencrease:command-palette", palette);
      window.removeEventListener("opencrease:ai-generate", ai);
    };
  }, []);
  return (
    <>
      <IconDefs />
      <NoticeHost />
      <LibraryHost />
      {open?.kind === "plugins" ? <PluginsDialog fileId={open.fileId} onClose={close} /> : null}
      {open?.kind === "history" ? <HistoryDialog fileId={open.fileId} onClose={close} /> : null}
      {open?.kind === "connect" ? <ConnectDialog onClose={close} /> : null}
      {open?.kind === "settings" ? <SettingsDialog initialPage={open.page} onClose={close} /> : null}
      {open?.kind === "palette" ? <CommandPalette onClose={close} /> : null}
      {open?.kind === "ai" ? <AiGenerateDialog mode={open.mode} onClose={close} /> : null}
    </>
  );
}

export function openAiGenerate(mode: AiGenerateMode): void {
  window.dispatchEvent(new CustomEvent("opencrease:ai-generate", { detail: { mode } }));
}
