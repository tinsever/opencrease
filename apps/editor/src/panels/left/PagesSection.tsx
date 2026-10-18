import { useState } from "react";
import { PAGE_ICONS, type PageIcon, type PageListItem } from "@opencrease/model";
import { useDoc, useWorkspace } from "../../state/hooks";
import { getOpenFile, setActivePage } from "../../state/workspace";
import { Icon, IconButton, InlineRename, useMenu, type MenuItem } from "../../ui";
import { PAGE_ICON_LABEL, PAGE_ICON_MAP } from "../nodeIcon";

function tx(fileId: string, label: string, fn: Parameters<NonNullable<ReturnType<typeof getOpenFile>>["store"]["transact"]>[1]) {
  const file = getOpenFile(fileId);
  if (!file) return undefined;
  try {
    return file.store.transact(label, fn);
  } catch (e) {
    console.warn(label, e);
    return undefined;
  }
}

export function addPage(fileId: string) {
  const file = getOpenFile(fileId);
  if (!file) return;
  const id = tx(fileId, "Add page", (t) => t.createPage(undefined, null, file.activePageId));
  if (typeof id === "string") setActivePage(fileId, id);
}

export function PagesSection({ fileId }: { fileId: string }) {
  const doc = useDoc(fileId);
  const activePageId = useWorkspace((s) => s.openFiles.find((f) => f.id === fileId)?.activePageId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over?: string; pos?: "before" | "after" } | null>(null);
  const [menu, openMenu] = useMenu();
  if (!doc) return null;
  const pageCount = doc.pageList.filter((p) => p.type === "page").length;

  const arrange = (order: PageListItem[], removeDividerIds?: string[]) =>
    tx(fileId, "Reorder pages", (t) => t.arrangePages(order.map((i) => i.id), removeDividerIds));

  const iconMenu = (pageId: string, anchor: DOMRect) => {
    const current = doc.pages[pageId]?.icon ?? null;
    const items: MenuItem[] = [
      { label: "Default", checked: current === null, onSelect: () => tx(fileId, "Page icon", (t) => t.updatePage(pageId, { icon: null })) },
      { type: "separator" },
      ...PAGE_ICONS.map((icon: PageIcon) => ({
        label: PAGE_ICON_LABEL[icon],
        checked: current === icon,
        icon: <Icon name={PAGE_ICON_MAP[icon]} size={14} style={{ color: "var(--of-muted)" }} />,
        onSelect: () => tx(fileId, "Page icon", (t) => t.updatePage(pageId, { icon })),
      })),
    ];
    openMenu(items, anchor, { placement: "right" });
  };

  const pageMenu = (pageId: string, at: { x: number; y: number }) => {
    const index = doc.pageList.findIndex((p) => p.id === pageId);
    openMenu(
      [
        { label: "Rename", onSelect: () => setRenaming(pageId) },
        { label: "Change icon", onSelect: () => iconMenu(pageId, new DOMRect(at.x, at.y, 0, 0)) },
        {
          label: "Add divider below",
          onSelect: () => {
            const order: Array<string | { type: "divider" }> = doc.pageList.map((p) => p.id);
            order.splice(index + 1, 0, { type: "divider" });
            tx(fileId, "Add divider", (t) => t.arrangePages(order));
          },
        },
        { type: "separator" },
        {
          label: "Delete page",
          danger: true,
          disabled: pageCount <= 1,
          onSelect: () => tx(fileId, "Delete page", (t) => t.deletePage(pageId)),
        },
      ],
      at,
    );
  };

  const onDrop = (targetId: string, pos: "before" | "after") => {
    if (!drag || drag.id === targetId) return setDrag(null);
    const list = doc.pageList.filter((p) => p.id !== drag.id);
    const moved = doc.pageList.find((p) => p.id === drag.id);
    const at = list.findIndex((p) => p.id === targetId);
    if (!moved || at < 0) return setDrag(null);
    list.splice(pos === "before" ? at : at + 1, 0, moved);
    arrange(list);
    setDrag(null);
  };

  const dragProps = (id: string) => ({
    draggable: renaming !== id,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/x-opencrease-page", id);
      setDrag({ id });
    },
    onDragOver: (e: React.DragEvent) => {
      if (!drag) return;
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const pos = e.clientY < r.top + r.height / 2 ? "before" : "after";
      if (drag.over !== id || drag.pos !== pos) setDrag({ ...drag, over: id, pos });
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (drag?.pos) onDrop(id, drag.pos);
    },
    onDragEnd: () => setDrag(null),
  });

  return (
    <div className="of-pages">
      <div className="of-list-head">
        <span className="of-caps">Pages</span>
        <IconButton icon="plus" label="Add page" iconSize={12} onClick={() => addPage(fileId)} />
      </div>
      <div className="of-scroll" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        {doc.pageList.map((item) => {
          const dropCls = drag?.over === item.id ? ` drop-${drag.pos}` : "";
          if (item.type === "divider") {
            return (
              <div
                key={item.id}
                className={`of-page-divider-hit${dropCls}`}
                {...dragProps(item.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu([{ label: "Remove divider", onSelect: () => arrange(doc.pageList.filter((p) => p.id !== item.id), [item.id]) }], { x: e.clientX, y: e.clientY });
                }}
              >
                <div className="of-page-divider" />
              </div>
            );
          }
          const page = doc.pages[item.id];
          if (!page) return null;
          const active = page.id === activePageId;
          const icon = page.icon ? PAGE_ICON_MAP[page.icon] : "pageBlank";
          return (
            <div
              key={page.id}
              className={`of-page-row${active ? " active" : ""}${dropCls}`}
              onClick={() => setActivePage(fileId, page.id)}
              onDoubleClick={() => setRenaming(page.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                pageMenu(page.id, { x: e.clientX, y: e.clientY });
              }}
              {...dragProps(page.id)}
            >
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  iconMenu(page.id, (e.currentTarget as HTMLElement).getBoundingClientRect());
                }}
                title="Change icon"
                style={{ display: "inline-flex" }}
              >
                <Icon name={icon} size={14} />
              </span>
              <span className="label">
                <InlineRename
                  value={page.name}
                  editing={renaming === page.id}
                  onEditingChange={(v) => setRenaming(v ? page.id : null)}
                  onCommit={(name) => tx(fileId, "Rename page", (t) => t.updatePage(page.id, { name }))}
                  style={{ overflow: "hidden", textOverflow: "ellipsis" }}
                />
              </span>
            </div>
          );
        })}
      </div>
      {menu}
    </div>
  );
}
