// ⌘K command palette: actions, layers on the page, pages and files with fuzzy search.
import { openPreview } from "../preview/preview";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ALIGN_ACTIONS, DISTRIBUTE_ACTIONS, arrangeLabel, arrangeSelection, canArrange } from "../canvas/arrange-actions";
import { copyAsCode, copyAsPng, pasteFromSystem } from "../canvas/clipboard-extra";
import { nodeToJsx } from "@opencrease/css";
import { artboardOf, listPages } from "@opencrease/model";
import { exportNodes } from "../agent/exporter";
import { zoomToFit, zoomToSelection } from "../canvas/view";
import { deleteSelection, duplicateSelection, redo, toggleLocked, toggleVisible, undo, wrapSelection } from "../state/actions";
import { useWorkspace } from "../state/hooks";
import { createAndOpenFile, getOpenFile, goHome, openFile, setActivePage, setLeftTab, setRightTab, setSelection } from "../state/workspace";
import { copyText, fuzzyFilter, fuzzyMatch, Icon, Kbd, type IconName } from "../ui";
import { addPage } from "../panels/left/PagesSection";
import { nodeIcon } from "../panels/nodeIcon";
import { useFiles } from "../panels/files";
import { openConnectDialog, openSettings } from "../panels/shared";
import { Dialog } from "./Dialog";
import { componentActions, componentInserts } from "./component-commands";

interface Command {
  id: string;
  group: "Actions" | "Components" | "Layers" | "Pages" | "Files";
  label: string;
  icon: IconName;
  shortcut?: string;
  hint?: string;
  keywords?: string[];
  run: () => void;
}

const GROUP_LIMIT: Record<Command["group"], number> = { Actions: 8, Components: 6, Layers: 8, Pages: 5, Files: 6 };

function Highlighted({ text, query }: { text: string; query: string }) {
  const m = query ? fuzzyMatch(query, text) : null;
  if (!m || m.indices.length === 0) return <>{text}</>;
  const set = new Set(m.indices);
  const out: ReactNode[] = [];
  let buf = "";
  let inMark = false;
  const flush = (k: number) => {
    if (!buf) return;
    out.push(inMark ? <mark key={k}>{buf}</mark> : buf);
    buf = "";
  };
  [...text].forEach((ch, i) => {
    const marked = set.has(i);
    if (marked !== inMark) {
      flush(i);
      inMark = marked;
    }
    buf += ch;
  });
  flush(text.length);
  return <>{out}</>;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const activeFileId = useWorkspace((s) => (s.route.kind === "file" ? s.activeFileId : null));
  const docVersion = useWorkspace((s) => s.docVersion);
  const { files } = useFiles();

  const commands = useMemo<Command[]>(() => {
    const file = getOpenFile(activeFileId);
    const doc = file?.store.doc;
    const sel = file?.selection ?? [];
    const has = sel.length > 0;
    const first = has && doc ? doc.nodes[sel[0]] : undefined;
    const out: Command[] = [];
    const action = (c: Omit<Command, "group">, when = true) => when && out.push({ ...c, group: "Actions" });
    if (file && doc) {
      action({ id: "preview", label: "Preview artboard", icon: "play", shortcut: "⌥P", keywords: ["play", "browser"], run: () => openPreview(file.id) });
      action({ id: "plugins", label: "Plugins", icon: "plug", keywords: ["scripts"], run: () => window.dispatchEvent(new Event("opencrease:plugins")) });
      action({ id: "history", label: "Version history", icon: "clock", keywords: ["restore", "diff", "snapshot"], run: () => window.dispatchEvent(new Event("opencrease:history")) });
      action({ id: "wrap-row", label: "Wrap in flex row", icon: "flexRow", shortcut: "⇧A", run: () => wrapSelection("flex-row") }, has);
      action({ id: "wrap-col", label: "Wrap in flex column", icon: "flexColumn", run: () => wrapSelection("flex-column") }, has);
      action({ id: "wrap-frame", label: "Wrap in frame", icon: "sides", shortcut: "⌘G", run: () => wrapSelection("frame") }, has);
      action({ id: "dup", label: "Duplicate", icon: "copy", shortcut: "⌘D", run: duplicateSelection }, has);
      action({ id: "del", label: "Delete", icon: "trash", shortcut: "⌫", keywords: ["remove"], run: deleteSelection }, has);
      for (const a of [...ALIGN_ACTIONS, ...DISTRIBUTE_ACTIONS]) action({ id: `arrange-${JSON.stringify(a)}`, label: arrangeLabel(a), icon: "alignCenter", run: () => { arrangeSelection(a); } }, canArrange(a));
      if (first) {
        action({ id: "copy-html", label: "Copy as HTML", icon: "code", run: () => { void copyAsCode("html"); } });
        action({ id: "copy-inline", label: "Copy as React", icon: "code", shortcut: "⌥R", run: () => { void copyAsCode("react"); } });
        action({ id: "copy-png", label: "Copy as PNG", icon: "image", shortcut: "⇧⌘C", run: () => { void copyAsPng(); } });
        action({ id: "paste-replace", label: "Paste to replace", icon: "copy", shortcut: "⇧⌘R", run: () => { void pasteFromSystem({ replace: true }); } });
        action({ id: "vis", label: first.visible ? "Hide layer" : "Show layer", icon: first.visible ? "eyeOff" : "eye", run: () => sel.forEach(toggleVisible) });
        action({ id: "lock", label: first.locked ? "Unlock layer" : "Lock layer", icon: first.locked ? "unlock" : "lock", run: () => sel.forEach(toggleLocked) });
        action({
          id: "copy-jsx",
          label: "Copy as React code",
          icon: "code",
          keywords: ["jsx", "tailwind"],
          run: () => void copyText(sel.map((id) => nodeToJsx(doc, id, { format: "tailwind" })).join("\n\n")),
        });
        action({ id: "export", label: "Export selection", icon: "download", keywords: ["png", "download"], run: () => void exportNodes(file.id, sel).catch((e) => alert(String(e))) });
        action({ id: "zoom-sel", label: "Zoom to selection", icon: "search", shortcut: "⇧2", run: () => void zoomToSelection() });
      }
      action({ id: "select-all", label: "Select all layers on page", icon: "artboard", shortcut: "⌘A", run: () => setSelection(file.id, doc.nodes[doc.pages[file.activePageId]?.rootId ?? ""]?.children ?? []) });
      action({ id: "zoom-fit", label: "Zoom to fit", icon: "corners", shortcut: "⇧1", run: () => void zoomToFit() });
      action({ id: "undo", label: "Undo", icon: "refresh", shortcut: "⌘Z", run: undo }, file.store.canUndo);
      action({ id: "redo", label: "Redo", icon: "refresh", shortcut: "⇧⌘Z", run: redo }, file.store.canRedo);
      action({ id: "add-page", label: "Add page", icon: "plus", run: () => addPage(file.id) });
      action({ id: "tab-code", label: "Show code", icon: "code", run: () => setRightTab("code") });
      action({ id: "tab-agent", label: "Show agent activity", icon: "plug", run: () => setRightTab("agent") });
      action({ id: "tab-theme", label: "Show theme tokens", icon: "tokens", keywords: ["variables", "tokens"], run: () => setLeftTab("theme") });
      action({ id: "tab-assets", label: "Show assets", icon: "image", run: () => setLeftTab("assets") });
      action({ id: "guide-file", label: "Edit design guide", icon: "guide", run: () => openSettings("guide") });
      action({ id: "home", label: "Go to all files", icon: "folder", run: goHome });
      for (const c of componentActions(file.id, doc, sel)) action(c);
      for (const c of componentInserts(doc)) out.push({ ...c, group: "Components" });
    }
    action({ id: "new-file", label: "New file", icon: "plus", run: () => void createAndOpenFile() });
    action({ id: "connect", label: "Connect an agent", icon: "plug", keywords: ["mcp", "claude", "codex"], run: openConnectDialog });
    action({ id: "settings", label: "Settings", icon: "settings", run: () => openSettings("general") });
    action({ id: "shortcuts", label: "Keyboard shortcuts", icon: "keyboard", run: () => openSettings("shortcuts") });

    if (file && doc) {
      const page = doc.pages[file.activePageId];
      const walk = (id: string, depth: number) => {
        for (const c of doc.nodes[id]?.children ?? []) {
          const n = doc.nodes[c];
          if (!n || n.type === "SVGElement") continue;
          const ab = artboardOf(doc, n.id);
          out.push({
            id: `layer-${n.id}`,
            group: "Layers",
            label: n.name,
            icon: nodeIcon(n, depth === 0 && n.type === "Frame"),
            hint: ab && ab.id !== n.id ? ab.name : undefined,
            run: () => setSelection(file.id, [n.id]),
          });
          walk(c, depth + 1);
        }
      };
      if (page) walk(page.rootId, 0);
      for (const p of listPages(doc)) {
        if (p.id === file.activePageId) continue;
        out.push({ id: `page-${p.id}`, group: "Pages", label: `Go to ${p.name}`, icon: "pageBlank", keywords: [p.name], run: () => setActivePage(file.id, p.id) });
      }
    }
    for (const f of files ?? []) {
      if (f.id === activeFileId) continue;
      out.push({ id: `file-${f.id}`, group: "Files", label: f.name, icon: "paper", hint: f.folder || undefined, run: () => void openFile(f.id) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileId, docVersion, files]);

  const visible = useMemo(() => {
    const q = query.trim();
    const groups: Command["group"][] = ["Actions", "Components", "Layers", "Pages", "Files"];
    const result: Command[] = [];
    for (const g of groups) {
      const items = commands.filter((c) => c.group === g);
      if (!q && (g === "Layers" || g === "Pages" || g === "Components")) continue;
      if (!q && g === "Files" && activeFileId) continue;
      const filtered = fuzzyFilter(items, q, (c) => [c.label, ...(c.keywords ?? [])]);
      result.push(...filtered.slice(0, q ? GROUP_LIMIT[g] : g === "Actions" ? 12 : 6));
    }
    return result;
  }, [commands, query, activeFileId]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    // Preview must retain the user gesture for browser popup permission.
    if (c.id === "preview") c.run();
    else setTimeout(c.run, 0);
  };

  let lastGroup = "";
  return (
    <Dialog onClose={onClose} width={580} top="12vh" label="Command palette" style={{ maxHeight: "min(560px, 76vh)" }}>
      <div className="of-palette-input">
        <Icon name="search" size={16} />
        <input
          autoFocus
          placeholder={activeFileId ? "Search actions, layers, pages and files" : "Search actions and files"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(visible.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(visible[active]);
            }
          }}
        />
        <Kbd>esc</Kbd>
      </div>
      <div className="of-palette-list" ref={listRef}>
        {visible.length === 0 ? <div className="of-empty">Nothing matches “{query}”.</div> : null}
        {visible.map((c, i) => {
          const head = c.group !== lastGroup ? <div key={`g-${c.group}`} className="of-palette-group of-caps">{c.group}</div> : null;
          lastGroup = c.group;
          return [
            head,
            <div
              key={c.id}
              data-index={i}
              className={`of-palette-item${i === active ? " active" : ""}`}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => run(c)}
            >
              <Icon name={c.icon} size={14} />
              <span className="plabel"><Highlighted text={c.label} query={query.trim()} /></span>
              {c.hint ? <span className="phint">{c.hint}</span> : null}
              {c.shortcut ? <Kbd>{c.shortcut}</Kbd> : null}
            </div>,
          ];
        })}
      </div>
      <div className="of-palette-foot">
        <span>↑↓ to move</span>
        <span>↵ to run</span>
        <span>esc to close</span>
      </div>
    </Dialog>
  );
}
