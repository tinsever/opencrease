// Clipboard commands beyond ⌘C/⌘X/⌘V: copy as PNG, React, Tailwind or HTML, and paste (or paste to
// replace) through the async Clipboard API for menus and ⇧⌘R, which have no native paste event.
import { nodeToHtml, nodeToJsx } from "@opencrease/css";
import type { NodeId } from "@opencrease/model";
import { getWorldRect } from "./registry";
import { unionRects, type Rect } from "./geometry";
import { captureNode } from "../agent/exporter";
import { api } from "../state/api";
import { getActiveFile } from "../state/workspace";
import { copyText } from "../ui";
import { clipboardTrees, OPENCREASE_MARKER, pasteHtml, pastePlainText, replaceWithTrees, selectionToClipboard } from "./clipboard";
import { insertImageFiles } from "./insert";
import { sortByDocumentOrder, topmostOnly } from "./selection-logic";

export type CodeFormat = "react" | "tailwind" | "html";

function selected(): { fileId: string; ids: NodeId[] } | null {
  const file = getActiveFile();
  if (!file) return null;
  const doc = file.store.doc;
  const ids = sortByDocumentOrder(doc, topmostOnly(doc, file.selection.filter((id) => doc.nodes[id] && doc.nodes[id].type !== "Root")));
  return ids.length ? { fileId: file.id, ids } : null;
}

/** Selected layers as code: React with inline styles (⌥R), React with Tailwind classes (⌥T) or HTML. */
export function selectionAsCode(format: CodeFormat): string | null {
  const sel = selected();
  const file = getActiveFile();
  if (!sel || !file) return null;
  const doc = file.store.doc;
  return sel.ids
    .map((id) =>
      format === "html"
        ? nodeToHtml(doc, id)
        : nodeToJsx(doc, id, { format: format === "tailwind" ? "tailwind" : "inline-styles", includeNodeIds: false }),
    )
    .join("\n\n");
}

export async function copyAsCode(format: CodeFormat): Promise<boolean> {
  const code = selectionAsCode(format);
  if (!code) return false;
  return await copyText(code);
}

/** Copy selected layers as one transparent 2x PNG, retaining their relative canvas positions. */
export async function copyAsPng(): Promise<boolean> {
  const sel = selected();
  if (!sel || typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
  // the write must start inside the user gesture; hand the clipboard a promise of the blob
  const blob = (async () => {
    let canvas: HTMLCanvasElement;
    if (sel.ids.length === 1) ({ canvas } = await captureNode(sel.fileId, sel.ids[0], 2));
    else {
      const rects = sel.ids.map((id) => getWorldRect(id));
      const bounds = unionRects(rects.filter((r): r is Rect => !!r));
      if (!bounds) throw new Error("Selection has no rendered bounds");
      const scale = Math.min(2, 8192 / Math.max(1, bounds.width, bounds.height));
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(bounds.width * scale));
      canvas.height = Math.max(1, Math.ceil(bounds.height * scale));
      const ctx = canvas.getContext("2d")!;
      for (let i = 0; i < sel.ids.length; i++) {
        const r = rects[i];
        if (!r) continue;
        const shot = await captureNode(sel.fileId, sel.ids[i], scale);
        ctx.drawImage(shot.canvas, (r.x - bounds.x) * scale, (r.y - bounds.y) * scale, r.width * scale, r.height * scale);
      }
    }
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));
  })();
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch (err) {
    console.warn("Copy as PNG failed", err);
    return false;
  }
}

/** Copy the selection the same way ⌘C does, from a menu (no native copy event there). */
export async function copySelection(): Promise<boolean> {
  const data = selectionToClipboard();
  if (!data) return false;
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": new Blob([data.html], { type: "text/html" }), "text/plain": new Blob([data.text], { type: "text/plain" }) }),
      ]);
    } else await copyText(data.text);
    return true;
  } catch (err) {
    console.warn("Copy failed", err);
    return false;
  }
}

/**
 * Paste from the system clipboard through the async API. With `replace`, the selected layers are
 * replaced by what is pasted (⇧⌘R, since ⌘R reloads the page in browsers). Resolves to false when the
 * browser does not allow reading the clipboard.
 */
export async function pasteFromSystem(opts: { replace?: boolean } = {}): Promise<boolean> {
  if (!navigator.clipboard?.read) return false;
  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch (err) {
    console.warn("Clipboard read was not allowed", err);
    return false;
  }
  for (const item of items) {
    if (item.types.includes("text/html")) {
      const html = await (await item.getType("text/html")).text();
      if (html.includes(OPENCREASE_MARKER) || /<[a-z]/i.test(html)) {
        pasteHtml(html, opts);
        return true;
      }
    }
    const image = item.types.find((t) => t.startsWith("image/") && t !== "image/svg+xml");
    if (image) {
      const blob = await item.getType(image);
      if (opts.replace) {
        const file = getActiveFile();
        if (!file) return false;
        const meta = await api.uploadAsset(file.id, blob);
        if (getActiveFile()?.id !== file.id) return false;
        file.store.transact("Paste image asset", (tx) => tx.addAsset(meta));
        replaceWithTrees([{ type: "Image", src: `asset://${meta.hash}`, styles: { width: meta.width ?? 400, height: meta.height ?? 300, objectFit: "cover" } }]);
      } else await insertImageFiles([blob]);
      return true;
    }
    if (item.types.includes("text/plain")) {
      const text = await (await item.getType("text/plain")).text();
      if (opts.replace && /^\s*</.test(text)) replaceWithTrees(clipboardTrees(text));
      else pastePlainText(text, opts);
      return true;
    }
  }
  return false;
}
