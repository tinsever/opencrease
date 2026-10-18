// Canvas context menus: the layer menu on right-click, and "layers under cursor" on ⌘ + right-click.
import { useCallback } from "react";
import { deleteSelection, duplicateSelection } from "../state/actions";
import { getActiveFile, setSelection, setRightTab } from "../state/workspace";
import { Icon, Menu, type MenuItem } from "../ui";
import { nodeIcon } from "../panels/nodeIcon";
import { arrangeLabel, arrangeSelection, canArrange, ALIGN_ACTIONS, DISTRIBUTE_ACTIONS } from "./arrange-actions";
import { copyAsCode, copyAsPng, copySelection, pasteFromSystem } from "./clipboard-extra";
import { repeatDuplicate } from "./duplicate-repeat";
import { breakpointsFor, responsiveWidths, setResponsivePreview } from "./render/ResponsivePreview";
import { isArtboardNode, pxValue } from "./selection-logic";
import { canvasUi } from "./ui-state";
import { useStore } from "./store";
import { lastKnownRect } from "./registry";
import { zoomToSelection } from "./view";

function canvasItems(): MenuItem[] {
  const file = getActiveFile();
  if (!file) return [];
  const doc = file.store.doc;
  const sel = file.selection.filter((id) => doc.nodes[id]);
  const has = sel.length > 0;
  const single = sel.length === 1 ? doc.nodes[sel[0]] : undefined;
  const items: MenuItem[] = [];
  if (has) {
    items.push(
      { label: "Copy", shortcut: "⌘C", onSelect: () => void copySelection() },
      { label: "Paste", shortcut: "⌘V", onSelect: () => void pasteFromSystem() },
      { label: "Paste to replace", shortcut: "⇧⌘R", onSelect: () => void pasteFromSystem({ replace: true }) },
      { type: "separator" },
      { label: "Copy as PNG", shortcut: "⇧⌘C", onSelect: () => void copyAsPng() },
      { label: "Copy as React", shortcut: "⌥R", onSelect: () => void copyAsCode("react") },
      { label: "Copy as Tailwind", shortcut: "⌥T", onSelect: () => void copyAsCode("tailwind") },
      { label: "Copy as HTML", onSelect: () => void copyAsCode("html") },
      { type: "separator" },
      { label: "Duplicate", shortcut: "⌘D", onSelect: () => repeatDuplicate() || duplicateSelection() },
      { label: "Zoom to selection", shortcut: "⇧2", onSelect: () => void zoomToSelection() },
    );
    const arrange = [...ALIGN_ACTIONS, ...DISTRIBUTE_ACTIONS].filter(canArrange);
    if (arrange.length) {
      items.push({ type: "separator" });
      for (const a of arrange) items.push({ label: arrangeLabel(a), onSelect: () => arrangeSelection(a) });
    }
    if (single && isArtboardNode(doc, single)) {
      const on = !!responsiveWidths(file.id, single.id);
      const width = pxValue(single.styles.width) ?? lastKnownRect(single.id)?.width ?? null;
      const widths = breakpointsFor(doc, width);
      items.push(
        { type: "separator" },
        {
          label: on ? "Hide responsive preview" : `Responsive preview (${widths.join(", ")})`,
          checked: on,
          disabled: widths.length === 0,
          onSelect: () => setResponsivePreview(file.id, single.id, on ? null : widths),
        },
      );
    }
    items.push(
      { type: "separator" },
      { label: "Show code", onSelect: () => setRightTab("code") },
      { label: "Delete", shortcut: "⌫", danger: true, onSelect: deleteSelection },
    );
  } else {
    items.push({ label: "Paste", shortcut: "⌘V", onSelect: () => void pasteFromSystem() });
  }
  return items;
}

function layerItems(ids: string[]): MenuItem[] {
  const file = getActiveFile();
  if (!file) return [];
  const doc = file.store.doc;
  const items: MenuItem[] = [{ type: "label", label: "Layers under cursor" }];
  for (const id of ids) {
    const n = doc.nodes[id];
    if (!n) continue;
    let depth = 0;
    for (let p = n.parentId; p && doc.nodes[p]?.type !== "Root"; p = doc.nodes[p]?.parentId ?? null) depth++;
    items.push({
      label: n.name,
      checked: file.selection.includes(id),
      icon: <span style={{ display: "inline-flex", paddingLeft: Math.min(depth, 6) * 8, color: "var(--of-muted)" }}><Icon name={nodeIcon(n, isArtboardNode(doc, n))} size={14} /></span>,
      onSelect: () => setSelection(file.id, [id]),
    });
  }
  return items;
}

export function CanvasContextMenu() {
  const menu = useStore(canvasUi, (s) => s.contextMenu);
  const close = useCallback(() => canvasUi.set({ contextMenu: null }), []);
  if (!menu) return null;
  const items = menu.kind === "layers" ? layerItems(menu.ids) : canvasItems();
  if (items.length === 0) return null;
  return <Menu items={items} anchor={{ x: menu.x, y: menu.y }} onClose={close} minWidth={menu.kind === "layers" ? 220 : 236} />;
}
