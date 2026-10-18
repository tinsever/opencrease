// Theme tab: mode collections (light/dark, comfortable/compact) with a switcher for the mode whose
// values the token list shows, plus a small name popover used for collections and modes.
import { useState } from "react";
import { MODE_NAME_RE, modeLabel, normalizeModeName, type FoldDocument, type ModeCollection, type Tx } from "@opencrease/model";
import { getOpenFile } from "../../state/workspace";
import { Button, IconButton, Popover, Segmented, useMenu } from "../../ui";

export const MODE_PRESETS: Array<{ label: string; name: string; modes: string[] }> = [
  { label: "Light and dark", name: "Colour scheme", modes: ["light", "dark"] },
  { label: "Comfortable and compact", name: "Density", modes: ["comfortable", "compact"] },
];

export function runTx(fileId: string, label: string, fn: (tx: Tx) => void): string | null {
  const file = getOpenFile(fileId);
  if (!file) return "No file";
  try {
    file.store.transact(label, fn);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Adds a collection, picking free mode names when a preset's names are taken. */
export function addModeCollection(fileId: string, doc: FoldDocument, name: string, modes: string[]): string | null {
  const taken = new Set((doc.modeCollections ?? []).flatMap((c) => c.modes));
  const free = modes.map((m) => {
    let n = m;
    for (let i = 2; taken.has(n); i++) n = `${m}-${i}`;
    taken.add(n);
    return n;
  });
  const names = new Set((doc.modeCollections ?? []).map((c) => c.name));
  let label = name;
  for (let i = 2; names.has(label); i++) label = `${name} ${i}`;
  return runTx(fileId, "Add modes", (tx) => tx.createModeCollection(label, free));
}

export function NamePopover({
  anchor, title, hint, initial, mode, onClose, onCommit,
}: { anchor: HTMLElement | DOMRect; title: string; hint?: string; initial: string; mode?: boolean; onClose: () => void; onCommit: (v: string) => string | null }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const clean = mode ? normalizeModeName(value) : value.trim();
  const valid = mode ? MODE_NAME_RE.test(clean) : clean.length > 0;
  const submit = () => {
    if (!valid) return;
    const err = onCommit(clean);
    if (err) setError(err);
    else onClose();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={232} placement="bottom">
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="of-section-title">{title}</span>
        <input
          className="of-textfield"
          autoFocus
          value={value}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose();
          }}
        />
        {error ? <span className="of-hint" style={{ color: "var(--of-danger)" }}>{error}</span> : mode && value && clean !== value ? <span className="of-hint">Saved as <span className="of-mono">{clean || "nothing"}</span></span> : hint ? <span className="of-hint">{hint}</span> : null}
        <div className="of-row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>Save</Button>
        </div>
      </div>
    </Popover>
  );
}

type NameEdit = { anchor: DOMRect; title: string; hint?: string; initial: string; mode?: boolean; commit: (v: string) => string | null };

/** One row per collection: name, mode switcher, actions. `viewing` maps collection id to the shown mode. */
export function ModesBar({
  fileId, doc, viewing, onView, onNotice,
}: { fileId: string; doc: FoldDocument; viewing: Record<string, string>; onView: (collectionId: string, mode: string) => void; onNotice: (msg: string) => void }) {
  const [menu, openMenu] = useMenu();
  const [edit, setEdit] = useState<NameEdit | null>(null);
  const collections = doc.modeCollections ?? [];
  if (!collections.length) return null;

  const actions = (c: ModeCollection, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const tokenCount = doc.tokens.filter((t) => t.modes && Object.keys(t.modes).some((m) => c.modes.includes(m))).length;
    openMenu(
      [
        { label: "Rename collection", onSelect: () => setEdit({ anchor: rect, title: "Rename collection", initial: c.name, commit: (v) => runTx(fileId, "Rename modes", (tx) => tx.updateModeCollection(c.id, { name: v })) }) },
        {
          label: "Add mode",
          onSelect: () =>
            setEdit({
              anchor: rect, title: `Add a mode to ${c.name}`, hint: "Lowercase, used as data-mode on frames.", initial: "", mode: true,
              commit: (v) => runTx(fileId, "Add mode", (tx) => tx.updateModeCollection(c.id, { modes: [...c.modes, v] })),
            }),
        },
        { type: "separator" },
        { type: "label", label: "Rename mode" },
        ...c.modes.map((m, i) => ({
          label: `${modeLabel(m)}${i === 0 ? " (default)" : ""}`,
          onSelect: () =>
            setEdit({
              anchor: rect, title: `Rename ${modeLabel(m)}`, hint: "Frames pinned to it follow the new name.", initial: m, mode: true,
              commit: (v) => runTx(fileId, "Rename mode", (tx) => tx.updateModeCollection(c.id, { modes: c.modes.map((x) => (x === m ? v : x)), renames: { [m]: v } })),
            }),
        })),
        ...(c.modes.length > 2
          ? [
              { type: "separator" as const },
              { type: "label" as const, label: "Remove mode" },
              ...c.modes.slice(1).map((m) => ({
                label: modeLabel(m),
                danger: true,
                onSelect: () => {
                  const err = runTx(fileId, "Remove mode", (tx) => tx.updateModeCollection(c.id, { modes: c.modes.filter((x) => x !== m) }));
                  if (err) onNotice(err);
                },
              })),
            ]
          : []),
        { type: "separator" },
        {
          label: "Delete collection",
          danger: true,
          onSelect: () => {
            if (tokenCount && !confirm(`${tokenCount} tokens have values for ${c.name}. Delete the collection and keep only their default values?`)) return;
            const err = runTx(fileId, "Delete modes", (tx) => tx.deleteModeCollection(c.id));
            if (err) onNotice(err);
          },
        },
      ],
      anchor,
      { minWidth: 200 },
    );
  };

  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--of-hairline)", display: "flex", flexDirection: "column", gap: 6 }}>
      {collections.map((c) => (
        <div key={c.id} className="of-row" style={{ gap: 6 }}>
          <span className="of-hint" style={{ flex: "0 0 88px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--of-ink-2)" }} title={c.name}>
            {c.name}
          </span>
          <Segmented
            className="auto"
            ariaLabel={`${c.name} mode`}
            style={{ flex: 1, minWidth: 0 }}
            value={viewing[c.id] ?? c.modes[0]}
            onChange={(m) => onView(c.id, m)}
            options={c.modes.map((m) => ({ value: m, label: <span style={{ fontSize: "var(--of-text-xs)" }}>{modeLabel(m)}</span>, title: `Show ${modeLabel(m).toLowerCase()} values` }))}
          />
          <IconButton icon="more" iconSize={14} size="sm" label={`${c.name} actions`} onClick={(e) => actions(c, e.currentTarget)} />
        </div>
      ))}
      {edit ? (
        <NamePopover anchor={edit.anchor} title={edit.title} hint={edit.hint} initial={edit.initial} mode={edit.mode} onClose={() => setEdit(null)} onCommit={edit.commit} />
      ) : null}
      {menu}
    </div>
  );
}
