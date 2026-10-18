import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { canContain, canHaveChildren, isAncestor, type FoldDocument, type NodeId, type OFNode } from "@opencrease/model";
import { deleteSelection, duplicateSelection, renameNode, toggleLocked, toggleVisible, wrapSelection } from "../../state/actions";
import { useDoc, useWorkspace } from "../../state/hooks";
import { getOpenFile, select, setHover, setSelection, setRightTab, type AgentWork } from "../../state/workspace";
import { getWorldRect } from "../../canvas/registry";
import { inComponent } from "../../canvas/component-tone";
import { clientLabel, fuzzyFilter, Icon, IconButton, InlineRename, useMenu } from "../../ui";
import { nodeIcon } from "../nodeIcon";
import { setExpanded, usePanelState } from "../shared";
import { componentMenuItems } from "./component-menu";
import { showNotice } from "../../ui/Notice";

interface Row {
  node: OFNode;
  depth: number;
  artboard: boolean;
  hasChildren: boolean;
  open: boolean;
  /** inside (or equal to) a selected subtree */
  inSel: boolean;
  selected: boolean;
  roundTop: boolean;
  roundBottom: boolean;
  /** a component, an instance or a layer inside one (purple) */
  component: boolean;
}

function flatten(doc: FoldDocument, rootId: NodeId, expanded: Record<string, boolean>, selected: Set<string>): Row[] {
  const rows: Row[] = [];
  const walk = (id: NodeId, depth: number, inSel: boolean, inComp = false) => {
    const node = doc.nodes[id];
    if (!node) return;
    const artboard = depth === 0 && node.type === "Frame";
    const isSel = selected.has(id);
    const hasChildren = node.children.length > 0;
    // SVG internals stay collapsed by default
    const open = hasChildren && (expanded[id] ?? false);
    const component = inComp || node.source !== undefined || !!node.component || !!node.componentSet || !!node.instance;
    rows.push({ node, depth, artboard, hasChildren, open, inSel: inSel || isSel, selected: isSel, roundTop: false, roundBottom: false, component });
    if (open) for (const c of node.children) walk(c, depth + 1, inSel || isSel, component);
  };
  const root = doc.nodes[rootId];
  for (const c of root?.children ?? []) walk(c, 0, false);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.inSel) continue;
    r.roundTop = !rows[i - 1]?.inSel || r.selected;
    r.roundBottom = !rows[i + 1]?.inSel || rows[i + 1].selected;
  }
  return rows;
}

type DropPos = "before" | "after" | "inside";

export function LayerTree({ fileId }: { fileId: string }) {
  const doc = useDoc(fileId);
  const file = useWorkspace((s) => s.openFiles.find((f) => f.id === fileId));
  const hoverId = useWorkspace((s) => s.hoverId);
  const agentWork = useWorkspace((s) => s.agentWork[fileId]);
  const expanded = usePanelState((s) => s.expanded[fileId] ?? EMPTY_EXPANDED);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [drop, setDrop] = useState<{ id: string; pos: DropPos } | null>(null);
  const dragIds = useRef<string[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [menu, openMenu] = useMenu();
  const [scroll, setScroll] = useState({ top: 0, height: 600 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setScroll({ top: el.scrollTop, height: el.clientHeight });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();
    return () => observer.disconnect();
  }, []);

  const page = doc && file ? doc.pages[file.activePageId] : undefined;
  const selection = file?.selection ?? EMPTY_SEL;
  const selSet = useMemo(() => new Set(selection), [selection]);

  // reveal selected layers
  useEffect(() => {
    if (!doc || selection.length === 0) return;
    const toOpen: string[] = [];
    for (const id of selection) {
      let p = doc.nodes[id]?.parentId;
      while (p && doc.nodes[p] && doc.nodes[p].type !== "Root") {
        if (!expanded[p]) toOpen.push(p);
        p = doc.nodes[p].parentId;
      }
    }
    if (toOpen.length) setExpanded(fileId, toOpen, true);
    requestAnimationFrame(() => {
      const list = scrollRef.current;
      const index = rows.findIndex((r) => r.node.id === selection[selection.length - 1]);
      if (list && index >= 0) {
        const y = index * 28;
        if (y < list.scrollTop) list.scrollTop = y;
        else if (y + 28 > list.scrollTop + list.clientHeight) list.scrollTop = y + 28 - list.clientHeight;
        setScroll({ top: list.scrollTop, height: list.clientHeight });
      }
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(selection[selection.length - 1])}"]`);
      el?.scrollIntoView({ block: "nearest" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  const rows = useMemo(() => (doc && page ? flatten(doc, page.rootId, expanded, selSet) : []), [doc, page, expanded, selSet]);

  const searchRows = useMemo(() => {
    if (!doc || !page || !query.trim()) return null;
    const all: OFNode[] = [];
    const walk = (id: string) => {
      for (const c of doc.nodes[id]?.children ?? []) {
        const n = doc.nodes[c];
        if (!n) continue;
        all.push(n);
        walk(c);
      }
    };
    walk(page.rootId);
    return fuzzyFilter(all, query, (n) => n.name).slice(0, 200);
  }, [doc, page, query]);

  const start = Math.max(0, Math.floor(scroll.top / 28) - 8);
  const end = Math.min(rows.length, Math.ceil((scroll.top + scroll.height) / 28) + 8);

  if (!doc || !page || !file) return null;

  const onRowClick = (e: ReactMouseEvent, id: string) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) select([id], { toggle: true });
    else setSelection(fileId, [id]);
  };

  const contextMenu = (e: ReactMouseEvent, node: OFNode) => {
    e.preventDefault();
    if (!selSet.has(node.id)) setSelection(fileId, [node.id]);
    openMenu(
      [
        { label: "Rename", onSelect: () => setRenaming(node.id) },
        { label: "Duplicate", shortcut: "⌘D", onSelect: duplicateSelection },
        { label: node.visible ? "Hide" : "Show", onSelect: () => toggleVisible(node.id) },
        { label: node.locked ? "Unlock" : "Lock", onSelect: () => toggleLocked(node.id) },
        { type: "separator" },
        { label: "Wrap in flex row", shortcut: "⇧A", onSelect: () => wrapSelection("flex-row") },
        { label: "Wrap in flex column", onSelect: () => wrapSelection("flex-column") },
        { label: "Wrap in frame", shortcut: "⌘G", onSelect: () => wrapSelection("frame") },
        { type: "separator" },
        ...componentMenuItems(doc, selSet.has(node.id) ? selection : [node.id]),
        { label: "Show code", onSelect: () => setRightTab("code") },
        { type: "separator" },
        { label: "Delete", shortcut: "⌫", danger: true, onSelect: deleteSelection },
      ],
      { x: e.clientX, y: e.clientY },
      { minWidth: 200 },
    );
  };

  // ------------------------------------------------------------ drag and drop
  const draggedNodes = () => (dragIds.current ?? []).map((id) => doc.nodes[id]).filter(Boolean);

  const dropAllowed = (target: OFNode, pos: DropPos): boolean => {
    const dragged = draggedNodes();
    if (dragged.length === 0) return false;
    const parent = pos === "inside" ? target : doc.nodes[target.parentId ?? ""];
    if (!parent) return false;
    if (pos === "inside" && !canHaveChildren(target.type)) return false;
    return dragged.every((d) => d.id !== parent.id && d.id !== target.id && !isAncestor(doc, d.id, parent.id) && canContain(parent.type, d.type));
  };

  const onDragOver = (e: DragEvent, row: Row) => {
    if (!dragIds.current) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const container = canHaveChildren(row.node.type) && row.node.type !== "SVGElement";
    let pos: DropPos = y < 0.3 ? "before" : y > 0.7 ? "after" : container ? "inside" : y < 0.5 ? "before" : "after";
    if (pos === "after" && row.open) pos = "inside";
    if (!dropAllowed(row.node, pos)) {
      if (drop) setDrop(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (drop?.id !== row.node.id || drop.pos !== pos) setDrop({ id: row.node.id, pos });
  };

  const performDrop = () => {
    const target = drop ? doc.nodes[drop.id] : undefined;
    const ids = dragIds.current;
    setDrop(null);
    dragIds.current = null;
    if (!target || !ids || !drop) return;
    const parentId = drop.pos === "inside" ? target.id : target.parentId;
    if (!parentId) return;
    const f = getOpenFile(fileId);
    if (!f) return;
    // keep document order of the dragged nodes
    const order = new Map<string, number>();
    let k = 0;
    const walk = (id: string) => {
      order.set(id, k++);
      for (const c of doc.nodes[id]?.children ?? []) walk(c);
    };
    walk(page.rootId);
    const sorted = [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const rects = new Map(sorted.map((id) => [id, getWorldRect(id)]));
    try {
      f.store.transact("Move layers", (tx) => {
        const parent = tx.doc.nodes[parentId];
        const remaining = parent.children.filter((c) => !sorted.includes(c));
        let index = drop.pos === "inside" ? remaining.length : remaining.indexOf(target.id) + (drop.pos === "after" ? 1 : 0);
        const toRoot = parent.type === "Root";
        for (const id of sorted) {
          const node = tx.doc.nodes[id];
          const fromRoot = tx.doc.nodes[node.parentId ?? ""]?.type === "Root";
          tx.moveNode(id, parentId, index++);
          if (fromRoot && !toRoot && node.styles.position === "absolute") tx.setStyles(id, { position: null, left: null, top: null });
          if (toRoot && !fromRoot) {
            const r = rects.get(id);
            tx.setStyles(id, { position: "absolute", left: Math.round(r?.x ?? 0), top: Math.round(r?.y ?? 0) });
          }
        }
      });
    } catch (err) {
      showNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const renderRow = (row: Row) => (
    <LayerRow
      key={row.node.id}
      row={row}
      hovered={hoverId === row.node.id}
      renaming={renaming === row.node.id}
      agent={row.artboard ? agentWork?.[row.node.id] : undefined}
      drop={drop?.id === row.node.id ? drop.pos : null}
      onRenaming={(v) => setRenaming(v ? row.node.id : null)}
      onClick={onRowClick}
      onToggle={() => setExpanded(fileId, [row.node.id], !row.open)}
      onContextMenu={contextMenu}
      onDragStart={(e) => {
        dragIds.current = selSet.has(row.node.id) ? selection.filter((id) => doc.nodes[id]) : [row.node.id];
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/x-opencrease-layers", dragIds.current.join(","));
      }}
      onDragOver={(e) => onDragOver(e, row)}
      onDrop={(e) => {
        e.preventDefault();
        performDrop();
      }}
      onDragEnd={() => {
        dragIds.current = null;
        setDrop(null);
      }}
    />
  );

  return (
    <div className="of-layers">
      <div className="of-list-head">
        <span className="of-caps">Layers</span>
        <IconButton
          icon="search"
          label="Search layers"
          iconSize={14}
          active={searching}
          onClick={() => {
            setSearching((v) => !v);
            setQuery("");
          }}
        />
      </div>
      {searching ? (
        <div className="of-search-row">
          <Icon name="search" size={13} />
          <input
            autoFocus
            placeholder="Find layers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                setSearching(false);
                setQuery("");
              }
              if (e.key === "Enter" && searchRows?.[0]) setSelection(fileId, [searchRows[0].id]);
            }}
          />
        </div>
      ) : null}
      <div className="of-layer-scroll" ref={scrollRef} onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })} onMouseLeave={() => setHover(null)}>
        {searchRows
          ? searchRows.map((n) =>
              renderRow({ node: n, depth: 0, artboard: doc.nodes[n.parentId ?? ""]?.type === "Root" && n.type === "Frame", hasChildren: false, open: false, inSel: selSet.has(n.id), selected: selSet.has(n.id), roundTop: true, roundBottom: true, component: inComponent(doc, n.id) }),
            )
          : <div style={{ paddingTop: start * 28, paddingBottom: Math.max(0, rows.length - end) * 28 }}>{rows.slice(start, end).map(renderRow)}</div>}
        {rows.length === 0 && !searchRows ? <div className="of-empty">This page is empty. Press F and drag on the canvas to draw an artboard, or ask an agent to design something.</div> : null}
        {searchRows && searchRows.length === 0 ? <div className="of-empty">No layers match.</div> : null}
      </div>
      {menu}
    </div>
  );
}

const EMPTY_SEL: string[] = [];
const EMPTY_EXPANDED: Record<string, boolean> = {};

interface LayerRowProps {
  row: Row;
  hovered: boolean;
  renaming: boolean;
  agent: AgentWork | undefined;
  drop: DropPos | null;
  onRenaming: (v: boolean) => void;
  onClick: (e: ReactMouseEvent, id: string) => void;
  onToggle: () => void;
  onContextMenu: (e: ReactMouseEvent, node: OFNode) => void;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
}

const LayerRow = memo(function LayerRow({ row, hovered, renaming, agent, drop, onRenaming, onClick, onToggle, onContextMenu, onDragStart, onDragOver, onDrop, onDragEnd }: LayerRowProps) {
  const { node, depth } = row;
  const indent = 6 + depth * 12;
  const cls = [
    "of-layer",
    row.component ? "component" : "",
    row.artboard ? "top" : "",
    row.selected ? "selected" : row.inSel ? "in-selection" : "",
    row.inSel && row.roundTop ? "round-top" : "",
    row.inSel && row.roundBottom ? "round-bottom" : "",
    hovered ? "hovered" : "",
    !node.visible ? "hidden-node" : "",
    drop === "inside" ? "drop-inside" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={cls}
      data-layer-id={node.id}
      style={{ paddingLeft: indent }}
      draggable={!renaming}
      onClick={(e) => onClick(e, node.id)}
      onDoubleClick={() => onRenaming(true)}
      onMouseEnter={() => setHover(node.id)}
      onContextMenu={(e) => onContextMenu(e, node)}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {drop === "before" || drop === "after" ? <div className={`drop-line ${drop}`} style={{ left: indent }} /> : null}
      <button
        className="chev"
        tabIndex={-1}
        aria-label={row.open ? "Collapse" : "Expand"}
        onClick={(e) => {
          e.stopPropagation();
          if (row.hasChildren) onToggle();
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {row.hasChildren ? <Icon name={row.open ? "chevronDown" : "chevronRight"} size={12} /> : null}
      </button>
      <Icon name={nodeIcon(node, row.artboard)} size={14} />
      <span className="label">
        <InlineRename value={node.name} editing={renaming} onEditingChange={onRenaming} onCommit={(n) => renameNode(node.id, n)} style={{ overflow: "hidden", textOverflow: "ellipsis" }} />
      </span>
      {agent ? <span className="of-agent-chip" title={agent.label}>{clientLabel(agent.client).split(" ")[0]}</span> : null}
      <span className="trail">
        <button
          className={`of-icon-btn${node.locked ? " pinned" : ""}`}
          aria-label={node.locked ? "Unlock" : "Lock"}
          title={node.locked ? "Unlock" : "Lock"}
          onClick={(e) => {
            e.stopPropagation();
            toggleLocked(node.id);
          }}
        >
          <Icon name={node.locked ? "lock" : "unlock"} size={14} />
        </button>
        <button
          className={`of-icon-btn${!node.visible ? " pinned" : ""}`}
          aria-label={node.visible ? "Hide" : "Show"}
          title={node.visible ? "Hide" : "Show"}
          onClick={(e) => {
            e.stopPropagation();
            toggleVisible(node.id);
          }}
        >
          <Icon name={node.visible ? "eye" : "eyeOff"} size={14} />
        </button>
      </span>
    </div>
  );
});
