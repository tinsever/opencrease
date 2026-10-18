// React bindings for the workspace store.
import { useSyncExternalStore } from "react";
import type { FoldDocument, OFNode, Page } from "@opencrease/model";
import { getOpenFile, getState, subscribe, type OpenFile, type WorkspaceState } from "./workspace";

/** Subscribe to a slice of workspace state. Keep selectors cheap and return stable values. */
export function useWorkspace<T>(selector: (s: WorkspaceState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getState()));
}

export function useActiveFile(): OpenFile | undefined {
  return useWorkspace((s) => s.openFiles.find((f) => f.id === s.activeFileId));
}

/** The current document of a file (re-renders on every change). */
export function useDoc(fileId?: string | null): FoldDocument | undefined {
  return useWorkspace((s) => {
    const id = fileId ?? s.activeFileId;
    return id ? getOpenFile(id)?.store.doc : undefined;
  });
}

export function useNode(fileId: string | null | undefined, nodeId: string | null | undefined): OFNode | undefined {
  const doc = useDoc(fileId);
  return nodeId && doc ? doc.nodes[nodeId] : undefined;
}

export function useActivePage(): Page | undefined {
  const file = useActiveFile();
  const doc = useDoc(file?.id);
  return file && doc ? doc.pages[file.activePageId] : undefined;
}

export function useSelection(): string[] {
  return useWorkspace((s) => s.openFiles.find((f) => f.id === s.activeFileId)?.selection ?? EMPTY);
}

const EMPTY: string[] = [];
