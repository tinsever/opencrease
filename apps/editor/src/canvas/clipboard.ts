// Copy, cut and paste of layers through the system clipboard.
import { nodeToHtml } from "@opencrease/css";
import type { NodeId, NodeTree, StyleMap } from "@opencrease/model";
import { getActiveFile, getState, setSelection } from "../state/workspace";
import { clipboardTrees, copyTree, looksLikeMarkup, cleanForeignHtml, OPENCREASE_MARKER, SOURCE_FILE_ATTR, TREES_ATTR } from "./clipboard-data";
export { clipboardTrees, OPENCREASE_MARKER } from "./clipboard-data";
import { api } from "../state/api";
import { deleteSelection } from "../state/actions";
import { unionRects, type Rect } from "./geometry";
import { getWorldRect } from "./registry";
import { insertImageFiles, pageRootId, viewportCentre } from "./insert";
import { placeBesideExisting } from "./placement";
import { revealNodes } from "./view";
import { isContainer, isFlex, pxValue, sortByDocumentOrder, topmostOnly } from "./selection-logic";
import { isFigmaHtml } from "../import/figma-kiwi";
import { importFigmaHtml } from "../import/figma";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/** Should the canvas handle this clipboard event? */
function canvasOwnsClipboard(e: ClipboardEvent): boolean {
  const s = getState();
  if (s.route.kind !== "file" || s.editingTextId) return false;
  if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return false;
  const sel = window.getSelection();
  // let the user copy selected text in panels
  if (e.type !== "paste" && sel && !sel.isCollapsed && sel.toString().trim()) return false;
  return true;
}

export function selectionToClipboard(): { html: string; text: string } | null {
  const file = getActiveFile();
  if (!file || file.selection.length === 0) return null;
  const doc = file.store.doc;
  const ids = sortByDocumentOrder(doc, topmostOnly(doc, file.selection.filter((id) => doc.nodes[id])));
  if (ids.length === 0) return null;
  const parts = ids.map((id) => nodeToHtml(doc, id));
  const encoded = encodeURIComponent(JSON.stringify(ids.map((id) => copyTree(doc, id))));
  const html = `<div ${OPENCREASE_MARKER}="1" ${SOURCE_FILE_ATTR}="${file.id}" ${TREES_ATTR}="${encoded}" style="display: contents">\n${parts.join("\n")}\n</div>`;
  const textNodes = ids.map((id) => doc.nodes[id]).filter((n) => n.type === "Text").map((n) => n.text ?? "");
  const text = textNodes.length === ids.length ? textNodes.join("\n") : parts.join("\n");
  return { html, text };
}

function onCopy(e: ClipboardEvent, cut: boolean) {
  if (!canvasOwnsClipboard(e)) return;
  const data = selectionToClipboard();
  if (!data || !e.clipboardData) return;
  e.preventDefault();
  e.clipboardData.setData("text/html", data.html);
  e.clipboardData.setData("text/plain", data.text);
  if (cut) deleteSelection();
}

const POSITION_KEYS = ["position", "left", "top", "right", "bottom"];

function withoutPosition(styles: StyleMap | undefined): StyleMap {
  const out: StyleMap = {};
  for (const [k, v] of Object.entries(styles ?? {})) if (!POSITION_KEYS.includes(k)) out[k] = v;
  return out;
}

/**
 * Paste to replace (⇧⌘R): every selected layer is swapped for the pasted layers, which take its place
 * in the parent and, for positioned layers, its position.
 */
export function replaceWithTrees(trees: NodeTree[]): NodeId[] {
  const file = getActiveFile();
  if (!file || trees.length === 0) return [];
  const doc = file.store.doc;
  const targets = sortByDocumentOrder(doc, topmostOnly(doc, file.selection.filter((id) => doc.nodes[id] && !doc.nodes[id].locked && doc.nodes[id].type !== "Root")));
  if (targets.length === 0) return pasteTrees(trees);
  const lefts = trees.map((t) => pxValue(t.styles?.left));
  const tops = trees.map((t) => pxValue(t.styles?.top));
  const minLeft = Math.min(...lefts.map((v) => v ?? 0));
  const minTop = Math.min(...tops.map((v) => v ?? 0));
  try {
    const created = file.store.transact("Paste to replace", (tx) => {
      const out: NodeId[] = [];
      for (const id of targets) {
        const node = tx.doc.nodes[id];
        if (!node?.parentId) continue;
        const parent = tx.doc.nodes[node.parentId];
        const index = parent.children.indexOf(id);
        const positioned = parent.type === "Root" || node.styles.position === "absolute";
        const left = pxValue(node.styles.left);
        const top = pxValue(node.styles.top);
        const prepared = trees.map((t, i) => {
          const styles = withoutPosition(t.styles);
          if (positioned) {
            if (parent.type !== "Root") styles.position = "absolute";
            styles.left = Math.round((left ?? 0) + (lefts[i] ?? minLeft) - minLeft);
            styles.top = Math.round((top ?? 0) + (tops[i] ?? minTop) - minTop);
          }
          return { ...t, styles };
        });
        tx.deleteNode(id);
        out.push(...tx.insertTrees(parent.id, prepared, index));
      }
      return out;
    });
    setSelection(file.id, created);
    return created;
  } catch (err) {
    console.warn("Paste to replace failed", err);
    return [];
  }
}

/** Insert pasted trees relative to the current selection. */
export function pasteTrees(trees: NodeTree[]): NodeId[] {
  const file = getActiveFile();
  if (!file || trees.length === 0) return [];
  const doc = file.store.doc;
  const rootId = pageRootId(doc, file.activePageId);
  if (!rootId) return [];

  // target: selected container, else after the selected layer in its parent, else the page
  const selected = file.selection.map((id) => doc.nodes[id]).filter(Boolean);
  let parentId = rootId;
  let index: number | undefined;
  if (selected.length === 1 && isContainer(selected[0]) && selected[0].type !== "Root") {
    parentId = selected[0].id;
  } else if (selected.length >= 1 && selected[0].parentId) {
    parentId = selected[0].parentId;
    const parent = doc.nodes[parentId];
    const last = Math.max(...selected.filter((n) => n.parentId === parentId).map((n) => parent.children.indexOf(n.id)));
    index = last + 1;
  }
  const parent = doc.nodes[parentId];
  const onPage = parentId === rootId;

  let prepared: NodeTree[];
  if (onPage) {
    // page-level: keep left/top when present, else centre in view; avoid covering existing layers
    const sizes = trees.map((t) => ({
      left: pxValue(t.styles?.left),
      top: pxValue(t.styles?.top),
      width: pxValue(t.styles?.width) ?? 200,
      height: pxValue(t.styles?.height) ?? 100,
    }));
    const centre = viewportCentre();
    const placed: Rect[] = sizes.map((s, i) => ({
      x: s.left ?? Math.round(centre.x - s.width / 2 + i * 24),
      y: s.top ?? Math.round(centre.y - s.height / 2 + i * 24),
      width: s.width,
      height: s.height,
    }));
    const group = unionRects(placed)!;
    const existing = doc.nodes[rootId].children.map((id) => getWorldRect(id)).filter((r): r is Rect => !!r);
    const { dx, dy } = placeBesideExisting(group, existing);
    prepared = trees.map((t, i) => ({
      ...t,
      styles: { ...withoutPosition(t.styles), left: Math.round(placed[i].x + dx), top: Math.round(placed[i].y + dy) },
    }));
  } else if (isFlex(parent)) {
    prepared = trees.map((t) => ({ ...t, styles: withoutPosition(t.styles) }));
  } else {
    // block container: keep absolute children absolute, offset by 16 when pasting next to the original
    prepared = trees.map((t) => {
      const abs = t.styles?.position === "absolute";
      if (!abs) return t;
      const left = pxValue(t.styles?.left);
      const top = pxValue(t.styles?.top);
      return {
        ...t,
        styles: { ...t.styles, ...(left !== undefined ? { left: left + 16 } : {}), ...(top !== undefined ? { top: top + 16 } : {}) },
      };
    });
  }

  try {
    const ids = file.store.transact("Paste", (tx) => tx.insertTrees(parentId, prepared, index));
    setSelection(file.id, ids);
    revealNodes(ids);
    return ids;
  } catch (err) {
    // e.g. pasting a Frame into an SVG: fall back to the page
    console.warn("Paste into selection failed, pasting on the page", err);
    if (parentId === rootId) return [];
    const ids = file.store.transact("Paste", (tx) => tx.insertTrees(rootId, prepared.map((t) => ({ ...t, styles: withoutPosition(t.styles) }))));
    setSelection(file.id, ids);
    return ids;
  }
}

function treeAssets(trees: NodeTree[], out = new Set<string>()): Set<string> {
  for (const t of trees) {
    for (const v of [t.src, JSON.stringify(t.paint), JSON.stringify(t.shader), ...Object.values(t.styles ?? {})]) {
      if (typeof v !== "string") continue;
      for (const m of v.matchAll(/asset:\/\/([a-f0-9]{64})/g)) out.add(m[1]);
    }
    if (t.children) treeAssets(t.children, out);
  }
  return out;
}

/** Copy assets the pasted layers use from the file they were copied from (pasting between files). */
async function bringAssets(fromFileId: string, trees: NodeTree[]): Promise<void> {
  const file = getActiveFile();
  if (!file || fromFileId === file.id) return;
  const missing = [...treeAssets(trees)].filter((h) => !file.store.doc.assets[h]);
  const metas = await Promise.all(
    missing.map(async (hash) => {
      try {
        const res = await fetch(api.assetUrl(fromFileId, hash));
        if (!res.ok) return null;
        return await api.uploadAsset(file.id, await res.blob());
      } catch {
        return null;
      }
    }),
  );
  const ok = metas.filter((m): m is NonNullable<typeof m> => !!m);
  if (ok.length) file.store.transact("Copy assets", (tx) => ok.forEach((m) => tx.addAsset(m)));
}

function sourceFileOf(html: string): string | null {
  return new RegExp(`${SOURCE_FILE_ATTR}="([^"]+)"`).exec(html)?.[1] ?? null;
}

export function pasteHtml(html: string, opts: { replace?: boolean } = {}): NodeId[] {
  const file = getActiveFile();
  if (!file) return [];
  if (isFigmaHtml(html)) {
    const { trees, warnings } = importFigmaHtml(html);
    if (warnings.length) console.info("Figma paste warnings", warnings);
    return (opts.replace ? replaceWithTrees : pasteTrees)(trees);
  }
  const trees = clipboardTrees(html);
  const from = sourceFileOf(html);
  const insert = () => (opts.replace ? replaceWithTrees(trees) : pasteTrees(trees));
  if (from && from !== file.id && treeAssets(trees).size) {
    // pasting into another file: bring the images along first, then insert
    void bringAssets(from, trees).then(() => { if (getActiveFile()?.id === file.id) insert(); });
    return [];
  }
  return insert();
}

export function pastePlainText(text: string, opts: { replace?: boolean } = {}): NodeId[] {
  if (looksLikeMarkup(text)) return pasteHtml(text, opts);
  const value = text.replace(/\r\n?/g, "\n");
  if (!value.trim()) return [];
  return (opts.replace ? replaceWithTrees : pasteTrees)([{ type: "Text", text: value, styles: { fontFamily: "Inter", fontSize: 16, lineHeight: "24px", color: "#000000" } }]);
}

function onPaste(e: ClipboardEvent) {
  if (!canvasOwnsClipboard(e) || !e.clipboardData) return;
  const data = e.clipboardData;
  const svg = [...data.files].find((f) => f.type === "image/svg+xml");
  const files = [...data.files].filter((f) => f.type.startsWith("image/") && f.type !== "image/svg+xml");
  const html = data.getData("text/html");
  const text = data.getData("text/plain");
  e.preventDefault();
  if (html && isFigmaHtml(html)) {
    try { pasteHtml(html); }
    catch (err) {
      console.warn("Figma paste could not be decoded", err);
      if (files.length) void insertImageFiles(files).catch((error) => console.error("Image paste failed", error));
      else if (text) pastePlainText(text);
    }
  } else if (html && html.includes(OPENCREASE_MARKER)) {
    pasteHtml(html);
  } else if (svg) {
    void svg.text().then(pasteHtml).catch((err) => console.error("SVG paste failed", err));
  } else if (files.length) {
    void insertImageFiles(files).catch((err) => console.error("Image paste failed", err));
  } else if (text && /^\s*<svg[\s>]/i.test(text)) {
    pasteHtml(text);
  } else if (html && looksLikeMarkup(cleanForeignHtml(html)) && !/^\s*$/.test(cleanForeignHtml(html))) {
    pasteHtml(html);
  } else if (text) {
    pastePlainText(text);
  }
}

const copyHandler = (e: ClipboardEvent) => onCopy(e, false);
const cutHandler = (e: ClipboardEvent) => onCopy(e, true);

/** Install document-level clipboard handlers. Returns an uninstall function. */
export function installClipboard(): () => void {
  document.addEventListener("copy", copyHandler);
  document.addEventListener("cut", cutHandler);
  document.addEventListener("paste", onPaste);
  return () => {
    document.removeEventListener("copy", copyHandler);
    document.removeEventListener("cut", cutHandler);
    document.removeEventListener("paste", onPaste);
  };
}
