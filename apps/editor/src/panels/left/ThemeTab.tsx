// Theme tab: document tokens grouped by type, mode collections with a switcher, multi-select with
// copy/paste between files, usage highlighting on the canvas, text styles, import and export.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  importTokens, normalizeTokenName, resolveTokenIn, themeToCss, themeToTailwind, tokenCollection, tokensToDtcg, tokenValueIn, TOKEN_TYPES,
  type FoldDocument, type Token, type TokenType,
} from "@opencrease/model";
import { canvasUi } from "../../canvas/ui-state";
import { useDoc } from "../../state/hooks";
import { getOpenFile, setRightTab, setSelection } from "../../state/workspace";
import { Button, copyText, fuzzyFilter, Icon, InlineRename, Popover, useMenu, type MenuItem } from "../../ui";
import { resolveColor } from "../right/color/ColorPicker";
import { TOKEN_TYPE_LABEL, updateToken } from "../right/TokenDetail";
import { selectToken, usePanelState } from "../shared";
import { addModeCollection, ModesBar, MODE_PRESETS, NamePopover, runTx } from "./theme-modes";
import { parseThemeText, tokensClipboard, tokenUsers, uniqueTokenName } from "./theme-logic";
import { TextStylesList } from "./TextStylesList";

const DEFAULTS: Record<TokenType, { prefix: string; value: string | number }> = {
  color: { prefix: "--color-new", value: "#D97757" },
  spacing: { prefix: "--spacing-new", value: 16 },
  radius: { prefix: "--radius-new", value: 8 },
  fontFamily: { prefix: "--font-new", value: "Geist" },
  fontWeight: { prefix: "--font-weight-new", value: 500 },
  fontSize: { prefix: "--text-new", value: 16 },
  lineHeight: { prefix: "--leading-new", value: 1.4 },
  letterSpacing: { prefix: "--tracking-new", value: "-0.01em" },
  opacity: { prefix: "--opacity-new", value: 0.5 },
  container: { prefix: "--container-new", value: 1200 },
  breakpoint: { prefix: "--breakpoint-new", value: 768 },
};

const PLURAL: Record<TokenType, string> = {
  color: "Colour", spacing: "Spacing", radius: "Radius", fontFamily: "Typography", fontWeight: "Typography", fontSize: "Typography",
  lineHeight: "Typography", letterSpacing: "Typography", opacity: "Opacity", container: "Layout", breakpoint: "Breakpoint",
};
const GROUP_ORDER = ["Colour", "Typography", "Spacing", "Radius", "Opacity", "Layout", "Breakpoint"];

function displayValue(t: Token, value: string | number): { text: string; alias: boolean } {
  const v = String(value);
  const alias = /^var\(\s*--([\w-]+)/.exec(v);
  if (alias) return { text: alias[1], alias: true };
  if (typeof value === "number" && ["spacing", "radius", "fontSize", "container", "breakpoint"].includes(t.type)) return { text: `${value}px`, alias: false };
  if (/^oklch\(/i.test(v) && v.length > 14) return { text: "oklch(…)", alias: false };
  return { text: v, alias: false };
}

function Preview({ doc, t, modes }: { doc: FoldDocument; t: Token; modes: string[] }) {
  if (t.type === "color") {
    const literal = resolveTokenIn(doc, t.name, modes);
    return <span className="of-swatch"><i style={{ background: literal !== undefined ? resolveColor(doc, String(literal)) : resolveColor(doc, `var(${t.name})`) }} /></span>;
  }
  if (t.type === "fontFamily") return <span className="of-token-preview" style={{ fontFamily: `"${String(tokenValueIn(t, modes)).split(",")[0].replace(/["']/g, "")}"` }}>Aa</span>;
  if (t.type === "fontSize" || t.type === "fontWeight" || t.type === "lineHeight" || t.type === "letterSpacing") return <span className="of-token-preview"><Icon name="text" size={12} /></span>;
  if (t.type === "radius") return <span className="of-token-preview"><Icon name="radius" size={12} /></span>;
  if (t.type === "opacity") return <span className="of-token-preview"><Icon name="opacity" size={12} /></span>;
  return <span className="of-token-preview"><Icon name="gap" size={12} /></span>;
}

/** Mode shown per collection, kept per file while the editor runs. */
const viewingByFile = new Map<string, Record<string, string>>();

function setHighlight(ids: string[]) {
  const cur = canvasUi.get().highlight;
  if (cur.length === ids.length && cur.every((id, i) => id === ids[i])) return;
  canvasUi.set({ highlight: ids });
}

export function ThemeTab({ fileId }: { fileId: string }) {
  const doc = useDoc(fileId);
  const selected = usePanelState((s) => s.selectedTokenId);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [importAnchor, setImportAnchor] = useState<HTMLElement | null>(null);
  const [customModes, setCustomModes] = useState<DOMRect | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Record<string, string>>(() => viewingByFile.get(fileId) ?? {});
  const anchorRef = useRef<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menu, openMenu] = useMenu();

  const groups = useMemo(() => {
    if (!doc) return [];
    const list = fuzzyFilter(doc.tokens, query, (t) => [t.name, String(t.value), t.description ?? ""]);
    const by = new Map<string, Token[]>();
    for (const t of list) {
      const g = PLURAL[t.type];
      by.set(g, [...(by.get(g) ?? []), t]);
    }
    return GROUP_ORDER.filter((g) => by.has(g)).map((g) => ({ name: g, tokens: by.get(g)! }));
  }, [doc, query]);
  const flat = useMemo(() => groups.flatMap((g) => (collapsed[g.name] && !query ? [] : g.tokens)), [groups, collapsed, query]);

  // the selection is the picked set, or the token shown in the right panel
  const selectedIds = useMemo(() => {
    const ids = picked.filter((id) => doc?.tokens.some((t) => t.id === id));
    if (ids.length) return ids;
    return selected && doc?.tokens.some((t) => t.id === selected) ? [selected] : [];
  }, [picked, selected, doc]);

  // outline the layers that use the hovered token, otherwise the selected ones
  const highlightNames = useMemo(() => {
    if (!doc) return [];
    const ids = hovered ? [hovered] : selectedIds;
    return doc.tokens.filter((t) => ids.includes(t.id)).map((t) => t.name);
  }, [doc, hovered, selectedIds]);
  useEffect(() => {
    if (!doc) return;
    setHighlight(tokenUsers(doc, highlightNames));
  }, [doc, highlightNames]);
  useEffect(() => () => setHighlight([]), []);

  if (!doc) return null;
  const collections = doc.modeCollections ?? [];
  const viewModes = collections.map((c) => viewing[c.id] ?? c.modes[0]).filter((m, i) => m !== collections[i].modes[0]);

  const flash = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2400);
  };

  const view = (collectionId: string, mode: string) => {
    const next = { ...viewing, [collectionId]: mode };
    viewingByFile.set(fileId, next);
    setViewing(next);
  };

  const create = (type: TokenType) => {
    const file = getOpenFile(fileId);
    if (!file) return;
    const d = DEFAULTS[type];
    const token = file.store.transact("Add token", (tx) => tx.createToken({ type, name: uniqueTokenName(doc.tokens, d.prefix), value: d.value }));
    setPicked([]);
    selectToken(token.id);
    setRenaming(token.id);
    setRightTab("design");
  };

  const duplicate = (ids: string[]) => {
    const file = getOpenFile(fileId);
    if (!file || !ids.length) return;
    const made = file.store.transact("Duplicate tokens", (tx) =>
      doc.tokens
        .filter((t) => ids.includes(t.id))
        .map((t) => tx.createToken({ type: t.type, name: uniqueTokenName(tx.doc.tokens, `${t.name}-copy`), value: t.value, description: t.description, modes: t.modes })),
    );
    setPicked(made.map((t) => t.id));
    selectToken(made[made.length - 1]?.id ?? null);
  };

  const remove = (ids: string[]) => {
    if (!ids.length) return;
    const names = doc.tokens.filter((t) => ids.includes(t.id)).map((t) => t.name);
    const users = tokenUsers(doc, names).length;
    if (users && !confirm(`${users} ${users === 1 ? "layer uses" : "layers use"} ${names.length === 1 ? names[0] : `these ${names.length} tokens`}. Delete anyway? Layers keep the var() reference.`)) return;
    const err = runTx(fileId, ids.length > 1 ? "Delete tokens" : "Delete token", (tx) => {
      for (const id of ids) tx.deleteToken(id);
    });
    if (err) return flash(err);
    setPicked([]);
    if (selected && ids.includes(selected)) selectToken(null);
  };

  const copy = (ids: string[]) => {
    if (!ids.length) return;
    void copyText(tokensClipboard(doc, ids)).then(() => flash(`Copied ${ids.length} ${ids.length === 1 ? "token" : "tokens"}. Paste them into any file's Theme tab.`));
  };

  const importText = (text: string, label: string): boolean => {
    const parsed = parseThemeText(text, doc);
    if (!parsed.tokens.length) {
      flash(parsed.warnings[0] ?? "No tokens found in the clipboard");
      return false;
    }
    const file = getOpenFile(fileId);
    if (!file) return false;
    try {
      const res = file.store.transact(label, (tx) => importTokens(tx, parsed));
      const names = new Set(parsed.tokens.map((t) => normalizeTokenName(t.name)));
      setPicked(file.store.doc.tokens.filter((t) => names.has(t.name)).map((t) => t.id));
      flash([`${res.created} new, ${res.updated} updated`, ...res.warnings.slice(0, 1), ...parsed.warnings.slice(0, 1)].join(". "));
      return true;
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const paste = () => {
    void navigator.clipboard
      ?.readText()
      .then((text) => importText(text, "Paste tokens"))
      .catch(() => flash("The clipboard could not be read. Use Import and paste there."));
  };

  const click = (e: ReactMouseEvent, t: Token) => {
    const ids = selectedIds;
    if (e.metaKey || e.ctrlKey) {
      const next = ids.includes(t.id) ? ids.filter((x) => x !== t.id) : [...ids, t.id];
      setPicked(next);
      anchorRef.current = t.id;
      selectToken(next.length === 1 ? next[0] : next.includes(t.id) ? t.id : (next[next.length - 1] ?? null));
    } else if (e.shiftKey && anchorRef.current) {
      const a = flat.findIndex((x) => x.id === anchorRef.current);
      const b = flat.findIndex((x) => x.id === t.id);
      if (a >= 0 && b >= 0) setPicked(flat.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id));
      selectToken(t.id);
    } else {
      setPicked([]);
      anchorRef.current = t.id;
      selectToken(t.id);
    }
    setRightTab("design");
  };

  const onListKey = (e: ReactKeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const meta = e.metaKey || e.ctrlKey;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "Backspace" || e.key === "Delete") {
      handled();
      remove(selectedIds);
    } else if (meta && e.key === "c") {
      handled();
      copy(selectedIds);
    } else if (meta && e.key === "v") {
      handled();
      paste();
    } else if (meta && e.key === "d") {
      handled();
      duplicate(selectedIds);
    } else if (meta && e.key === "a") {
      handled();
      setPicked(flat.map((t) => t.id));
    } else if (e.key === "Escape") {
      handled();
      setPicked([]);
      selectToken(null);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      handled();
      const i = flat.findIndex((t) => t.id === (selected ?? ""));
      const next = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        setPicked([]);
        anchorRef.current = next.id;
        selectToken(next.id);
      }
    }
  };

  const rowMenu = (e: ReactMouseEvent, t: Token) => {
    e.preventDefault();
    const ids = selectedIds.includes(t.id) ? selectedIds : [t.id];
    if (!selectedIds.includes(t.id)) {
      setPicked([]);
      selectToken(t.id);
    }
    const many = ids.length > 1;
    const users = tokenUsers(doc, doc.tokens.filter((x) => ids.includes(x.id)).map((x) => x.name));
    const items: MenuItem[] = [
      ...(!many
        ? [
            { label: "Rename", onSelect: () => setRenaming(t.id) },
            { label: "Copy var()", onSelect: () => void copyText(`var(${t.name})`) },
          ]
        : []),
      { label: many ? `Copy ${ids.length} tokens` : "Copy token", shortcut: "⌘C", onSelect: () => copy(ids) },
      { label: "Paste tokens", shortcut: "⌘V", onSelect: paste },
      { label: many ? `Duplicate ${ids.length} tokens` : "Duplicate", shortcut: "⌘D", onSelect: () => duplicate(ids) },
      {
        label: users.length ? `Select ${users.length} ${users.length === 1 ? "layer" : "layers"} using ${many ? "them" : "it"}` : "No layers use it",
        disabled: !users.length,
        onSelect: () => setSelection(fileId, users.filter((id) => doc.nodes[id] && getOpenFile(fileId)?.activePageId === pageIdOf(doc, id))),
      },
      { type: "separator" },
      { label: many ? `Delete ${ids.length} tokens` : "Delete", shortcut: "⌫", danger: true, onSelect: () => remove(ids) },
    ];
    openMenu(items, { x: e.clientX, y: e.clientY });
  };

  const addMenu = (anchor: HTMLElement) => {
    const items: MenuItem[] = [
      { type: "label", label: "Token" },
      ...TOKEN_TYPES.map((t) => ({ label: TOKEN_TYPE_LABEL[t], onSelect: () => create(t) })),
      { type: "separator" },
      { type: "label", label: "Modes" },
      ...MODE_PRESETS.map((p) => ({
        label: p.label,
        onSelect: () => {
          const err = addModeCollection(fileId, doc, p.name, p.modes);
          if (err) flash(err);
        },
      })),
      { label: "Custom modes…", onSelect: () => setCustomModes(anchor.getBoundingClientRect()) },
    ];
    openMenu(items, anchor, { minWidth: 200 });
  };

  const exportMenu = (anchor: HTMLElement) =>
    openMenu(
      [
        { label: "Copy as CSS :root", onSelect: () => void copyText(themeToCss(doc)).then(() => flash("Copied the CSS variables")) },
        { label: "Copy as Tailwind @theme", onSelect: () => void copyText(themeToTailwind(doc)).then(() => flash("Copied the Tailwind theme")) },
        { label: "Copy as DTCG JSON", onSelect: () => void copyText(tokensToDtcg(doc)).then(() => flash("Copied the design tokens JSON")) },
        { type: "separator" },
        { label: "Download .tokens.json", onSelect: () => download(`${doc.name || "tokens"}.tokens.json`, tokensToDtcg(doc), "application/json") },
        { label: "Download theme.css", onSelect: () => download("theme.css", themeToCss(doc), "text/css") },
      ],
      anchor,
      { placement: "top", minWidth: 200 },
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", gap: 8, padding: "12px 12px 8px", borderBottom: collections.length ? undefined : "1px solid var(--of-hairline)" }}>
        <label className="of-search-row" style={{ flex: 1, margin: 0 }}>
          <Icon name="search" size={13} />
          <input placeholder={`Search ${doc.tokens.length} tokens`} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <button
          className="of-icon-btn"
          style={{ background: "var(--of-ink)", color: "var(--of-on-ink)", borderRadius: "var(--of-radius-sm)" }}
          aria-label="Add token or modes"
          title="Add token or modes"
          onClick={(e) => addMenu(e.currentTarget)}
        >
          <Icon name="plus" size={12} />
        </button>
      </div>
      <ModesBar fileId={fileId} doc={doc} viewing={viewing} onView={view} onNotice={flash} />
      <div className="of-scroll" style={{ flex: 1, minHeight: 0, padding: "8px 6px", outline: "none" }} tabIndex={0} onKeyDown={onListKey} aria-label="Tokens" data-of-token-list="">
        {doc.tokens.length === 0 ? (
          <div className="of-empty">
            No tokens yet. Tokens are CSS variables shared by the whole file: colours, spacing, type. Add one with the + button, import a :root block or DTCG file, or ask an agent to set up a theme.
          </div>
        ) : null}
        {doc.tokens.length > 0 && groups.length === 0 ? <div className="of-empty">No tokens match.</div> : null}
        {groups.map((g) => {
          const isCollapsed = collapsed[g.name] && !query;
          return (
            <div key={g.name}>
              <div className="of-token-group" onClick={() => setCollapsed((c) => ({ ...c, [g.name]: !c[g.name] }))}>
                <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} size={12} />
                <span className="of-caps">{g.name}</span>
                <span className="of-mono" style={{ fontSize: "var(--of-text-xs)" }}>{g.tokens.length}</span>
              </div>
              {!isCollapsed
                ? g.tokens.map((t) => {
                    const value = tokenValueIn(t, viewModes);
                    const v = displayValue(t, value);
                    const varies = !!tokenCollection(doc, t);
                    return (
                      <div
                        key={t.id}
                        className={`of-token-row${selectedIds.includes(t.id) ? " selected" : ""}`}
                        data-token={t.name}
                        onClick={(e) => click(e, t)}
                        onDoubleClick={() => setRenaming(t.id)}
                        onMouseEnter={() => setHovered(t.id)}
                        onMouseLeave={() => setHovered((h) => (h === t.id ? null : h))}
                        onContextMenu={(e) => rowMenu(e, t)}
                        title={t.description}
                      >
                        <Preview doc={doc} t={t} modes={viewModes} />
                        <span className="tname">
                          <InlineRename
                            value={t.name.slice(2)}
                            editing={renaming === t.id}
                            onEditingChange={(e) => setRenaming(e ? t.id : null)}
                            onCommit={(n) => {
                              const err = updateToken(fileId, t.id, { name: normalizeTokenName(n) }, "Rename token");
                              if (err) flash(err);
                            }}
                            style={{ overflow: "hidden", textOverflow: "ellipsis" }}
                          />
                        </span>
                        <span className="tval">
                          {varies ? <span className="of-token-modes-dot" title={`Varies by ${tokenCollection(doc, t)!.name}`} /> : null}
                          {v.alias ? <Icon name="link" size={10} style={{ display: "inline-block", verticalAlign: "-1px", marginRight: 3 }} /> : null}
                          {v.text}
                        </span>
                      </div>
                    );
                  })
                : null}
            </div>
          );
        })}
        <TextStylesList fileId={fileId} doc={doc} query={query} onNotice={flash} />
      </div>
      {notice ? <div className="of-hint" style={{ padding: "0 12px 6px" }} role="status">{notice}</div> : null}
      <div className="of-panel-footer">
        <Button onClick={(e) => setImportAnchor(e.currentTarget)}>Import</Button>
        <Button disabled={doc.tokens.length === 0} onClick={(e) => exportMenu(e.currentTarget)}>
          Export
        </Button>
      </div>
      {importAnchor ? <ImportPopover anchor={importAnchor} doc={doc} onClose={() => setImportAnchor(null)} onImport={(text) => importText(text, "Import tokens")} /> : null}
      {customModes ? (
        <NamePopover
          anchor={customModes}
          title="New mode collection"
          hint="Name it, then add modes from its menu. It starts with two modes."
          initial="Modes"
          onClose={() => setCustomModes(null)}
          onCommit={(name) => addModeCollection(fileId, doc, name, ["default", "alternate"])}
        />
      ) : null}
      {menu}
    </div>
  );
}

function pageIdOf(doc: FoldDocument, id: string): string | undefined {
  let n = doc.nodes[id];
  while (n?.parentId) n = doc.nodes[n.parentId];
  return n ? Object.values(doc.pages).find((p) => p.rootId === n!.id)?.id : undefined;
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[/\\]/g, "-");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ImportPopover({ anchor, doc, onClose, onImport }: { anchor: HTMLElement; doc: FoldDocument; onClose: () => void; onImport: (text: string) => boolean }) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => (text.trim() ? parseThemeText(text, doc) : null), [text, doc]);
  const count = parsed?.tokens.length ?? 0;
  const modes = parsed?.modeCollections?.reduce((n, c) => n + c.modes.length, 0) ?? 0;
  const readFile = (file: File) => void file.text().then(setText);
  return (
    <Popover anchor={anchor} onClose={onClose} placement="top" width={320}>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="of-section-title">Import tokens</span>
        <span className="of-hint">Paste a CSS :root block (with [data-mode] or .dark blocks for modes), a Tailwind @theme block, or W3C design tokens JSON. Tokens with the same name are updated.</span>
        <textarea
          className="of-textfield"
          autoFocus
          style={{ height: 150, padding: 8, fontFamily: "var(--of-font-mono)", fontSize: "var(--of-text-xs)", lineHeight: "16px", resize: "vertical" }}
          placeholder={':root {\n  --color-bg: #ffffff;\n  --spacing-4: 16px;\n}\n[data-mode~="dark"] {\n  --color-bg: #111111;\n}'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const f = e.dataTransfer.files[0];
            if (f) {
              e.preventDefault();
              readFile(f);
            }
          }}
        />
        <div className="of-row">
          <label className="of-btn ghost sm" style={{ height: 24, padding: "0 6px" }}>
            Choose file
            <input type="file" accept=".json,.css,.tokens,.tokens.json,application/json,text/css" hidden onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
          </label>
          <span className="of-hint" style={{ flex: 1, textAlign: "right" }}>
            {!parsed ? "Nothing pasted yet" : count ? `${count} tokens${modes ? `, ${modes} modes` : ""}${parsed.format === "dtcg" ? " (DTCG)" : ""}` : (parsed.warnings[0] ?? "No tokens found")}
          </span>
          <Button variant="primary" disabled={!count} onClick={() => onImport(text) && onClose()}>
            Import
          </Button>
        </div>
      </div>
    </Popover>
  );
}
