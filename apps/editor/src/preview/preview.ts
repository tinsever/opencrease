import { artboardOf, type FoldDocument } from "@opencrease/model";
import { getActiveFile, getOpenFile, getState, subscribe } from "../state/workspace";

export function previewArtboard(doc: FoldDocument, selection: readonly string[], pageId: string): string | undefined {
  for (const id of selection) {
    if (!doc.nodes[id]) continue;
    const board = artboardOf(doc, id);
    if (board) return board.id;
  }
  return doc.nodes[doc.pages[pageId]?.rootId]?.children.find((id) => doc.nodes[id]?.type === "Frame");
}

export const previewChannel = (fileId: string) => `opencrease:preview:${fileId}`;
export const previewPath = (fileId: string, nodeId: string) => `/preview/${encodeURIComponent(fileId)}/${encodeURIComponent(nodeId)}`;

export function parsePreviewPath(path: string): { fileId: string; nodeId: string } | null {
  const match = /^\/preview\/([^/]+)\/([^/]+)\/?$/.exec(path);
  if (!match) return null;
  try { return { fileId: decodeURIComponent(match[1]), nodeId: decodeURIComponent(match[2]) }; }
  catch { return null; }
}

/** Called synchronously from user gestures so popup blockers allow the new tab. */
export function openPreview(fileId?: string): void {
  const file = fileId ? getOpenFile(fileId) : getActiveFile();
  if (!file) return;
  const nodeId = previewArtboard(file.store.doc, file.selection, file.activePageId);
  if (!nodeId) {
    alert("Add an artboard to this page to preview it.");
    return;
  }
  // The desktop window handler opens same-origin paths in a new BrowserWindow.
  window.open(previewPath(file.id, nodeId), "_blank", "noopener");
}

/** Publish only in response to a preview request; coalesce edits and clean up closed files. */
export function installPreviewPublisher(): () => void {
  const channels = new Map<string, { channel: BroadcastChannel; timer?: ReturnType<typeof setTimeout>; requestedAt: number; lastDoc?: FoldDocument }>();
  const sync = () => {
    for (const [id, state] of channels) {
      const file = getOpenFile(id);
      if (!file) { clearTimeout(state.timer); state.channel.close(); channels.delete(id); }
      else if (Date.now() - state.requestedAt < 5000 && state.lastDoc !== file.store.doc) {
        clearTimeout(state.timer);
        state.timer = setTimeout(() => {
          state.lastDoc = file.store.doc;
          state.channel.postMessage({ type: "document", doc: file.store.doc });
        }, 80);
      }
    }
    // Files can open after startup. Do not open a second editor/store in the preview.
    for (const file of getState().openFiles) if (!channels.has(file.id)) {
      const channel = new BroadcastChannel(previewChannel(file.id));
      const state: { channel: BroadcastChannel; requestedAt: number; lastDoc?: FoldDocument } = { channel, requestedAt: 0 };
      channels.set(file.id, state);
      channel.onmessage = (event: MessageEvent) => {
        if (event.data?.type !== "request") return;
        state.requestedAt = Date.now();
        const current = getOpenFile(file.id);
        if (current) {
          state.lastDoc = current.store.doc;
          channel.postMessage({ type: "document", doc: current.store.doc });
        }
      };
    }
  };
  const unsubscribe = subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    for (const state of channels.values()) { clearTimeout(state.timer); state.channel.close(); }
    channels.clear();
  };
}
