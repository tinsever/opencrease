// Theme tab: the document's text styles (named typography bundles). Created from the Typography
// section; here they are listed with a preview, renamed, duplicated and deleted.
import { useState } from "react";
import { resolveToken, type FoldDocument, type StyleValue, type TextStyle } from "@opencrease/model";
import { canvasUi } from "../../canvas/ui-state";
import { getOpenFile, setSelection } from "../../state/workspace";
import { fuzzyFilter, Icon, InlineRename, useMenu } from "../../ui";
import { runTx } from "./theme-modes";

function resolved(doc: FoldDocument, v: StyleValue | undefined): StyleValue | undefined {
  if (typeof v === "string" && /^var\(/.test(v.trim())) return resolveToken(doc, v.trim()) ?? undefined;
  return v;
}

/** "Geist 16/24 Semibold" style summary of a text style. */
export function textStyleSummary(doc: FoldDocument, s: TextStyle): string {
  const fam = String(resolved(doc, s.styles.fontFamily) ?? "").split(",")[0].replace(/["']/g, "").trim();
  const size = resolved(doc, s.styles.fontSize);
  const lh = resolved(doc, s.styles.lineHeight);
  const w = resolved(doc, s.styles.fontWeight);
  const sz = size !== undefined ? `${String(size).replace(/px$/, "")}${lh !== undefined ? `/${String(lh).replace(/px$/, "")}` : ""}` : "";
  return [fam, sz, w !== undefined && String(w) !== "400" ? String(w) : ""].filter(Boolean).join(" ") || "No values";
}

function usersOf(doc: FoldDocument, id: string, pageId: string | undefined): string[] {
  const root = pageId ? doc.pages[pageId]?.rootId : undefined;
  return Object.values(doc.nodes)
    .filter((n) => n.textStyle === id)
    .filter((n) => {
      let p = n;
      while (p.parentId) p = doc.nodes[p.parentId];
      return p.id === root;
    })
    .map((n) => n.id);
}

export function TextStylesList({ fileId, doc, query, onNotice }: { fileId: string; doc: FoldDocument; query: string; onNotice: (m: string) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, openMenu] = useMenu();
  const styles = fuzzyFilter(doc.textStyles ?? [], query, (s) => [s.name, s.description ?? ""]);
  if (!styles.length) return null;
  const pageId = getOpenFile(fileId)?.activePageId;
  const highlight = (ids: string[]) => canvasUi.set({ highlight: ids });

  return (
    <div>
      <div className="of-token-group" onClick={() => setCollapsed((c) => !c)}>
        <Icon name={collapsed && !query ? "chevronRight" : "chevronDown"} size={12} />
        <span className="of-caps">Text styles</span>
        <span className="of-mono" style={{ fontSize: "var(--of-text-xs)" }}>{styles.length}</span>
      </div>
      {!collapsed || query
        ? styles.map((s) => {
            const fam = String(resolved(doc, s.styles.fontFamily) ?? "").split(",")[0].replace(/["']/g, "").trim();
            return (
              <div
                key={s.id}
                className="of-token-row"
                data-text-style={s.name}
                title={s.description ?? "Click to select the layers using this style on this page"}
                onMouseEnter={() => highlight(usersOf(doc, s.id, pageId))}
                onMouseLeave={() => highlight([])}
                onClick={() => {
                  const ids = usersOf(doc, s.id, pageId);
                  if (ids.length) setSelection(fileId, ids);
                  else onNotice(`No layers on this page use ${s.name}`);
                }}
                onDoubleClick={() => setRenaming(s.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu(
                    [
                      { label: "Rename", onSelect: () => setRenaming(s.id) },
                      {
                        label: "Duplicate",
                        onSelect: () => {
                          const names = new Set((doc.textStyles ?? []).map((x) => x.name.toLowerCase()));
                          let name = `${s.name} copy`;
                          for (let i = 2; names.has(name.toLowerCase()); i++) name = `${s.name} copy ${i}`;
                          const err = runTx(fileId, "Duplicate text style", (tx) => tx.createTextStyle({ name, styles: s.styles, description: s.description }));
                          if (err) onNotice(err);
                        },
                      },
                      { type: "separator" },
                      {
                        label: "Delete",
                        danger: true,
                        onSelect: () => {
                          const err = runTx(fileId, "Delete text style", (tx) => tx.deleteTextStyle(s.id));
                          if (err) onNotice(err);
                        },
                      },
                    ],
                    { x: e.clientX, y: e.clientY },
                  );
                }}
              >
                <span className="of-token-preview" style={{ fontFamily: fam ? `"${fam}", var(--of-font-sans)` : undefined, fontWeight: Number(resolved(doc, s.styles.fontWeight)) || undefined }}>
                  Ag
                </span>
                <span className="tname" style={{ fontFamily: "var(--of-font-sans)" }}>
                  <InlineRename
                    value={s.name}
                    editing={renaming === s.id}
                    onEditingChange={(e) => setRenaming(e ? s.id : null)}
                    onCommit={(n) => {
                      const err = runTx(fileId, "Rename text style", (tx) => tx.updateTextStyle(s.id, { name: n }));
                      if (err) onNotice(err);
                    }}
                    style={{ overflow: "hidden", textOverflow: "ellipsis" }}
                  />
                </span>
                <span className="tval">{textStyleSummary(doc, s)}</span>
              </div>
            );
          })
        : null}
      {menu}
    </div>
  );
}
