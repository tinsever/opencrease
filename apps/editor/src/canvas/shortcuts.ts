// Global keyboard shortcuts for the editor (see docs/EDITOR.md, "Canvas behaviour").
import { openPreview } from "../preview/preview";
import { useEffect } from "react";
import type { NodeId } from "@opencrease/model";
import { deleteSelection, redo, setStyles, undo, wrapSelection } from "../state/actions";
import { getActiveFile, getState, setHover, setSelection, setTool, toggleUiHidden } from "../state/workspace";
import { installClipboard } from "./clipboard";
import { handleExtraShortcut } from "./shortcuts-extra";
import { pickAndInsertImages } from "./insert";
import { isDragging } from "./interactions";
import { getViewportLive, setViewportLive, getNodeElement } from "./registry";
import { flexAxis, isAbsolutelyPositioned, isFlex, isLockedDeep, pxValue, selectionLevel, topmostOnly } from "./selection-logic";
import { startTextEdit } from "./text-edit";
import { installTextShortcuts } from "./text-shortcuts";
import { canvasUi } from "./ui-state";
import { handleComponentShortcut } from "./component-shortcuts";
import { panBy, zoomStep, zoomTo, zoomToFit, zoomToSelection } from "./view";

function isTypingTarget(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

function selectionNodes() {
  const file = getActiveFile();
  if (!file) return null;
  const doc = file.store.doc;
  const ids = file.selection.filter((id) => doc.nodes[id]);
  return { file, doc, ids };
}

function nudge(dx: number, dy: number) {
  const ctx = selectionNodes();
  if (!ctx) return;
  const { file, doc } = ctx;
  if (ctx.ids.length === 0) {
    panBy(-dx * 40, -dy * 40);
    return;
  }
  const ids = topmostOnly(doc, ctx.ids).filter((id) => !isLockedDeep(doc, id) && doc.nodes[id].type !== "SVGElement");
  const abs = ids.filter((id) => isAbsolutelyPositioned(doc, doc.nodes[id]));
  if (abs.length) {
    file.store.transact(
      "Nudge",
      (tx) => {
        for (const id of abs) {
          const node = tx.doc.nodes[id];
          const el = getNodeElement(id);
          const left = pxValue(node.styles.left) ?? (el instanceof HTMLElement ? el.offsetLeft : 0);
          const top = pxValue(node.styles.top) ?? (el instanceof HTMLElement ? el.offsetTop : 0);
          tx.setStyles(id, { left: left + dx, top: top + dy, right: null, bottom: null });
        }
      },
      { mergeKey: `nudge:${abs.join(",")}` },
    );
    return;
  }
  // flow children: arrows along the main axis reorder among siblings
  const first = doc.nodes[ids[0]];
  const parent = first?.parentId ? doc.nodes[first.parentId] : undefined;
  if (!parent || ids.some((id) => doc.nodes[id].parentId !== parent.id)) return;
  const axis = isFlex(parent) ? flexAxis(parent) : "column";
  const step = axis === "row" ? Math.sign(dx) : Math.sign(dy);
  if (!step) return;
  const ordered = [...ids].sort((a, b) => parent.children.indexOf(a) - parent.children.indexOf(b));
  const indices = ordered.map((id) => parent.children.indexOf(id));
  if (step < 0 && indices[0] === 0) return;
  if (step > 0 && indices[indices.length - 1] === parent.children.length - 1) return;
  file.store.transact("Reorder", (tx) => {
    const list = step > 0 ? [...ordered].reverse() : ordered;
    for (const id of list) {
      const at = tx.doc.nodes[parent.id].children.indexOf(id);
      tx.moveNode(id, parent.id, at + step);
    }
  });
}

function reorderZ(dir: 1 | -1, toEnd: boolean) {
  const ctx = selectionNodes();
  if (!ctx || ctx.ids.length === 0) return;
  const { file, doc } = ctx;
  const ids = topmostOnly(doc, ctx.ids);
  file.store.transact(dir > 0 ? "Bring forward" : "Send backward", (tx) => {
    const list = dir > 0 ? [...ids].reverse() : ids;
    for (const id of list) {
      const node = tx.doc.nodes[id];
      if (!node?.parentId) continue;
      const siblings = tx.doc.nodes[node.parentId].children;
      const at = siblings.indexOf(id);
      const to = toEnd ? (dir > 0 ? siblings.length - 1 : 0) : Math.max(0, Math.min(siblings.length - 1, at + dir));
      if (to !== at) tx.moveNode(id, node.parentId, to);
    }
  });
}

function selectParentOrClear() {
  const ctx = selectionNodes();
  if (!ctx) return;
  const { file, doc, ids } = ctx;
  if (ids.length === 0) return;
  const parents = [...new Set(ids.map((id) => doc.nodes[id].parentId).filter((p): p is NodeId => !!p))];
  const real = parents.filter((p) => doc.nodes[p]?.type !== "Root");
  setSelection(file.id, real.length ? real : []);
}

function enterSelection(shift: boolean) {
  const ctx = selectionNodes();
  if (!ctx) return;
  const { file, doc, ids } = ctx;
  if (shift) return selectParentOrClear();
  if (ids.length === 1 && doc.nodes[ids[0]].type === "Text") {
    startTextEdit(ids[0]);
    return;
  }
  const children = ids.flatMap((id) => doc.nodes[id].children.filter((c) => doc.nodes[c]?.visible).slice(0, 1));
  if (children.length) setSelection(file.id, children);
}

function tabSibling(dir: 1 | -1) {
  const ctx = selectionNodes();
  if (!ctx) return;
  const { file, doc, ids } = ctx;
  const rootId = doc.pages[file.activePageId]?.rootId;
  const level = selectionLevel(doc, rootId, ids);
  if (level.length === 0) return;
  const cur = ids.length ? level.indexOf(ids[ids.length - 1]) : -1;
  const next = level[(cur + dir + level.length) % level.length];
  if (next) setSelection(file.id, [next]);
}

function selectAll() {
  const ctx = selectionNodes();
  if (!ctx) return;
  const { file, doc, ids } = ctx;
  const rootId = doc.pages[file.activePageId]?.rootId;
  setSelection(file.id, selectionLevel(doc, rootId, ids));
}

function addFlex() {
  const ctx = selectionNodes();
  if (!ctx || ctx.ids.length === 0) return;
  const { doc, ids } = ctx;
  const only = ids.length === 1 ? doc.nodes[ids[0]] : undefined;
  if (only && only.type === "Frame" && !isFlex(only)) {
    setStyles([only.id], { display: "flex", flexDirection: "row", gap: 8 }, "Add flex layout");
    return;
  }
  wrapSelection("flex-row");
}

function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing || (e.target instanceof Element && e.target.closest("[role=dialog], [role=menu]"))) return;
  const s = getState();
  const meta = e.metaKey || e.ctrlKey;
  const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();

  if (meta && key === "k" && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("opencrease:command-palette"));
    return;
  }
  const previewShortcut = !meta && e.altKey && !e.shiftKey && key === "p";
  if (!meta && !previewShortcut && e.target instanceof Element && e.target.closest(".of-panel, .of-titlebar")) return;
  if (s.route.kind !== "file" || !getActiveFile()) return;
  if (s.editingTextId || isTypingTarget(document.activeElement) || canvasUi.get().renaming) return;
  if (isDragging()) return;
  if (handleExtraShortcut(e)) return;
  if (handleComponentShortcut(e)) return;

  if (previewShortcut) {
    e.preventDefault();
    openPreview();
    return;
  }
  if (meta) {
    if (e.shiftKey && !e.altKey && (key === "i" || key === "j")) {
      // AI image (⇧⌘I) and SVG (⇧⌘J) generation, see dialogs/AiGenerateDialog.tsx
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("opencrease:ai-generate", { detail: { mode: key === "i" ? "image" : "svg" } }));
    } else if (key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (key === "y") {
      e.preventDefault();
      redo();
    } else if (key === "g" && !e.shiftKey) {
      e.preventDefault();
      wrapSelection("frame");
    } else if (key === "a") {
      e.preventDefault();
      selectAll();
    } else if (e.code === "Backslash") {
      e.preventDefault();
      toggleUiHidden();
    } else if (e.code === "Digit0" || key === "0") {
      e.preventDefault();
      zoomTo(1);
    } else if (key === "=" || key === "+") {
      e.preventDefault();
      zoomStep(1);
    } else if (key === "-" || key === "_") {
      e.preventDefault();
      zoomStep(-1);
    } else if (e.code === "BracketRight") {
      e.preventDefault();
      reorderZ(1, e.altKey);
    } else if (e.code === "BracketLeft") {
      e.preventDefault();
      reorderZ(-1, e.altKey);
    }
    // Cmd+C / X / V go through the clipboard events (see clipboard.ts)
    return;
  }

  if (e.shiftKey && !e.altKey && e.code === "Digit1") {
    e.preventDefault();
    zoomToFit();
    return;
  }
  if (e.shiftKey && !e.altKey && e.code === "Digit2") {
    e.preventDefault();
    zoomToSelection();
    return;
  }
  if (e.shiftKey && key === "a" && !e.altKey) {
    e.preventDefault();
    addFlex();
    return;
  }

  switch (e.key) {
    case "Backspace":
    case "Delete":
      e.preventDefault();
      deleteSelection();
      setHover(null);
      return;
    case "Escape":
      e.preventDefault();
      if (s.tool !== "move") setTool("move");
      else selectParentOrClear();
      return;
    case "Enter":
      e.preventDefault();
      enterSelection(e.shiftKey);
      return;
    case "Tab":
      e.preventDefault();
      tabSibling(e.shiftKey ? -1 : 1);
      return;
    case "ArrowLeft":
    case "ArrowRight":
    case "ArrowUp":
    case "ArrowDown": {
      e.preventDefault();
      const n = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0;
      const dy = e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0;
      if (getActiveFile()?.selection.length) nudge(dx, dy);
      else {
        const vp = getViewportLive();
        setViewportLive({ ...vp, x: vp.x - dx * 40, y: vp.y - dy * 40 });
      }
      return;
    }
  }
  if (e.altKey || e.shiftKey) return;
  switch (key) {
    case "v":
    case "m":
      setTool("move");
      break;
    case "f":
    case "a":
      setTool("frame");
      break;
    case "r":
      setTool("rect");
      break;
    case "t":
      setTool("text");
      break;
    case "h":
      setTool("hand");
      break;
    case "i":
      pickAndInsertImages();
      break;
    default:
      return;
  }
  e.preventDefault();
}

/** Mount once at the app root: keyboard shortcuts and clipboard handling. */
export function useGlobalShortcuts() {
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    const uninstall = installClipboard();
    const uninstallText = installTextShortcuts();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      uninstall();
      uninstallText();
    };
  }, []);
}
