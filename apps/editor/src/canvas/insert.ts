// Creating layers from insertion tools, image files and the clipboard.
import type { FoldDocument, NodeId, NodeTree, StyleMap } from "@opencrease/model";
import { api } from "../state/api";
import { getActiveFile, setSelection, setTool } from "../state/workspace";
import type { Point, Rect } from "./geometry";
import { canvasSize, elementWorldRect, getNodeElement, getViewportLive, getWorldElement, getWorldRect } from "./registry";
import { computeInsertSlot } from "./reorder";
import { DEFAULT_SHADER } from "./render/ShaderView";
import { centredAt, fitSize } from "./placement";
import { flexAxis, isContainer, isFlex } from "./selection-logic";
import { toWorld } from "./viewport-math";
import { revealNodes } from "./view";

export type LayerKind = "frame" | "rect" | "text" | "shader" | "image";

export function pageRootId(doc: FoldDocument, pageId: string): NodeId | undefined {
  return doc.pages[pageId]?.rootId;
}

/**
 * World origin of the containing block that `left/top` of an absolutely positioned child of `parentId`
 * are relative to (nearest positioned ancestor element, inside its border).
 */
export function containingBlockOrigin(parentId: NodeId): Point {
  const world = getWorldElement();
  let el: HTMLElement | null = getNodeElement(parentId);
  while (el && el !== world) {
    if (getComputedStyle(el).position !== "static") {
      const r = elementWorldRect(el);
      if (r) return { x: r.x + el.clientLeft, y: r.y + el.clientTop };
      break;
    }
    el = el.parentElement;
  }
  return { x: 0, y: 0 };
}

/** Index among `parentId`'s children where something centred at `point` (world) should go. */
export function flowInsertIndex(doc: FoldDocument, parentId: NodeId, point: Point, exclude: Set<NodeId> = new Set()) {
  const parent = doc.nodes[parentId];
  const kept = parent.children.filter((id) => !exclude.has(id));
  const flowIds = kept.filter((id) => {
    const n = doc.nodes[id];
    return n && n.visible && n.styles.position !== "absolute" && n.styles.position !== "fixed";
  });
  const rects: Rect[] = [];
  const ids: NodeId[] = [];
  for (const id of flowIds) {
    const r = getWorldRect(id);
    if (r) {
      rects.push(r);
      ids.push(id);
    }
  }
  const container = getWorldRect(parentId) ?? { x: point.x, y: point.y, width: 0, height: 0 };
  const axis = isFlex(parent) ? flexAxis(parent) : "column";
  const slot = computeInsertSlot(rects, point, axis, container);
  // map the slot among measured flow siblings to an index in the full child list (minus excluded)
  const index = slot.index < ids.length ? kept.indexOf(ids[slot.index]) : ids.length ? kept.indexOf(ids[ids.length - 1]) + 1 : kept.length;
  return { index, line: slot.line };
}

function defaultStyles(kind: LayerKind): StyleMap {
  switch (kind) {
    case "frame":
      return { backgroundColor: "#FFFFFF" };
    case "rect":
      return { backgroundColor: "#D9D9D9" };
    case "text":
      return { fontFamily: "Inter", fontSize: 16, lineHeight: "24px", color: "#000000" };
    default:
      return {};
  }
}

function treeFor(kind: LayerKind, styles: StyleMap): NodeTree {
  switch (kind) {
    case "frame":
      return { type: "Frame", name: "Frame", styles };
    case "rect":
      return { type: "Rectangle", name: "Rectangle", styles };
    case "text":
      return { type: "Text", text: "", name: "Text", styles };
    case "shader":
      return { type: "Shader", name: "Mesh gradient", shader: structuredClone(DEFAULT_SHADER), styles };
    default:
      return { type: "Frame", styles };
  }
}

/**
 * Insert a layer of `kind` occupying `rect` (world) inside `containerId` (null = the page).
 * Flex containers get a flow child at the matching index; block containers an absolute child;
 * the page gets a page-level layer. Returns the new id.
 */
export function insertLayer(kind: LayerKind, rect: Rect, containerId: NodeId | null, opts: { autoSize?: boolean } = {}): NodeId | null {
  const file = getActiveFile();
  if (!file) return null;
  const doc = file.store.doc;
  const rootId = pageRootId(doc, file.activePageId);
  if (!rootId) return null;
  const container = containerId ? doc.nodes[containerId] : undefined;
  const parentId = container && isContainer(container) ? container.id : rootId;
  const parent = doc.nodes[parentId];
  const onPage = parentId === rootId;
  const styles: StyleMap = { ...defaultStyles(kind) };
  if (!opts.autoSize) {
    styles.width = Math.max(1, Math.round(rect.width));
    styles.height = Math.max(1, Math.round(rect.height));
  }
  let index: number | undefined;
  if (onPage) {
    styles.left = Math.round(rect.x);
    styles.top = Math.round(rect.y);
  } else if (isFlex(parent)) {
    styles.flexShrink = 0;
    index = flowInsertIndex(doc, parentId, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }).index;
  } else {
    const o = containingBlockOrigin(parentId);
    styles.position = "absolute";
    styles.left = Math.round(rect.x - o.x);
    styles.top = Math.round(rect.y - o.y);
  }
  const tree = treeFor(kind, styles);
  const [id] = file.store.transact(`Add ${kind === "rect" ? "rectangle" : kind}`, (tx) => tx.insertTrees(parentId, [tree], index));
  setSelection(file.id, [id]);
  setTool("move");
  return id;
}

/** World point at the centre of the visible canvas. */
export function viewportCentre(): Point {
  const s = canvasSize();
  return toWorld(getViewportLive(), { x: s.width / 2, y: (s.height - 56) / 2 });
}

function imageSize(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 400, height: 300 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/**
 * Upload image files and insert them as Image layers: into the selected frame when one is selected,
 * otherwise on the page centred at `at` (default: the middle of the view).
 */
export async function insertImageFiles(files: Blob[], at?: Point): Promise<NodeId[]> {
  const file = getActiveFile();
  if (!file || files.length === 0) return [];
  const prepared = await Promise.all(
    files.map(async (blob) => {
      const [meta, natural] = await Promise.all([
        api.uploadAsset(file.id, blob, blob instanceof File ? blob.name : undefined),
        imageSize(blob),
      ]);
      return { meta, natural, name: blob instanceof File ? blob.name.replace(/\.[^.]+$/, "") : "Image" };
    }),
  );
  const doc = file.store.doc;
  const rootId = pageRootId(doc, file.activePageId);
  if (!rootId) return [];
  const sel = file.selection.length === 1 ? doc.nodes[file.selection[0]] : undefined;
  const parentId = sel && isContainer(sel) ? sel.id : rootId;
  const parent = doc.nodes[parentId];
  const centre = at ?? viewportCentre();
  const parentRect = parentId !== rootId ? getWorldRect(parentId) : null;
  const maxBox = parentRect
    ? { width: Math.max(40, parentRect.width), height: Math.max(40, parentRect.height) }
    : { width: 800, height: 800 };

  let offset = 0;
  const trees: NodeTree[] = prepared.map(({ meta, natural, name }) => {
    const size = fitSize({ width: meta.width ?? natural.width, height: meta.height ?? natural.height }, maxBox);
    const styles: StyleMap = { width: size.width, height: size.height, objectFit: "cover" };
    if (parentId === rootId) {
      const r = centredAt({ x: centre.x + offset, y: centre.y + offset }, size);
      styles.left = r.x;
      styles.top = r.y;
    } else if (!isFlex(parent)) {
      const o = containingBlockOrigin(parentId);
      const r = centredAt(parentRect ? { x: parentRect.x + parentRect.width / 2, y: parentRect.y + parentRect.height / 2 } : centre, size);
      styles.position = "absolute";
      styles.left = r.x - o.x + offset;
      styles.top = r.y - o.y + offset;
    } else {
      styles.flexShrink = 0;
    }
    offset += 24;
    return { type: "Image", name, src: `asset://${meta.hash}`, styles };
  });
  const ids = file.store.transact("Add image", (tx) => {
    for (const p of prepared) tx.addAsset(p.meta);
    return tx.insertTrees(parentId, trees);
  });
  setSelection(file.id, ids);
  setTool("move");
  revealNodes(ids);
  return ids;
}

/** Open the system file picker for images and insert the chosen files. */
export function pickAndInsertImages() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.onchange = () => {
    const files = [...(input.files ?? [])];
    if (files.length) void insertImageFiles(files).catch((err) => console.error("Image upload failed", err));
  };
  input.click();
  setTool("move");
}
