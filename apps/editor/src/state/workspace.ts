// Editor-wide state: open files (one DocStore each), routing, selection, tools,
// viewports and agent activity. A tiny external store consumed with
// useSyncExternalStore (see hooks.ts). Mutate only through the exported actions.
import { DocStore, type FoldDocument, type NodeId, type PageId } from "@opencrease/model";
import { api } from "./api";

export type Tool = "move" | "hand" | "frame" | "rect" | "text" | "pen" | "image" | "shader" | "line" | "ellipse" | "polygon" | "star" | "zoom" | "scale";
export type LeftTab = "layers" | "theme" | "assets";
export type RightTab = "design" | "code" | "agent";

export interface Viewport {
  x: number; // screen offset of world origin, in px
  y: number;
  zoom: number;
}

export interface OpenFile {
  id: string;
  store: DocStore;
  activePageId: PageId;
  viewports: Record<PageId, Viewport>;
  selection: NodeId[];
  saveState: "saved" | "saving" | "dirty" | "error";
  lastSavedAt: number;
}

export interface AgentWork {
  client: string; // MCP client name, e.g. "claude-code"
  label: string; // last action, e.g. "Editing Featured grid"
  lastAt: number;
}

export interface WorkspaceState {
  route: { kind: "home" } | { kind: "file"; fileId: string };
  openFiles: OpenFile[];
  activeFileId: string | null;
  hoverId: NodeId | null;
  tool: Tool;
  leftTab: LeftTab;
  rightTab: RightTab;
  editingTextId: NodeId | null;
  /** fileId → artboardId → work */
  agentWork: Record<string, Record<NodeId, AgentWork>>;
  /** clients seen over the bridge recently (name → last seen) */
  agentClients: Record<string, number>;
  bridgeConnected: boolean;
  /** bumps whenever any open document changes, cheap way to re-render consumers */
  docVersion: number;
  /** minimal mode: panels hidden (Cmd+\\) */
  uiHidden: boolean;
}

const DEFAULT_VIEWPORT: Viewport = { x: 80, y: 80, zoom: 1 };

let state: WorkspaceState = {
  route: { kind: "home" },
  openFiles: [],
  activeFileId: null,
  hoverId: null,
  tool: "move",
  leftTab: "layers",
  rightTab: "design",
  editingTextId: null,
  agentWork: {},
  agentClients: {},
  bridgeConnected: false,
  docVersion: 0,
  uiHidden: false,
};

const listeners = new Set<() => void>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const unsubscribers = new Map<string, () => void>();

export function getState(): WorkspaceState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(patch: Partial<WorkspaceState> | ((s: WorkspaceState) => Partial<WorkspaceState>)) {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function updateFile(fileId: string, patch: Partial<OpenFile> | ((f: OpenFile) => Partial<OpenFile>)) {
  setState((s) => ({
    openFiles: s.openFiles.map((f) => (f.id === fileId ? { ...f, ...(typeof patch === "function" ? patch(f) : patch) } : f)),
  }));
}

// ---------------------------------------------------------------- queries

export function getOpenFile(fileId: string | null | undefined): OpenFile | undefined {
  if (!fileId) return undefined;
  return state.openFiles.find((f) => f.id === fileId);
}

export function getActiveFile(): OpenFile | undefined {
  return getOpenFile(state.activeFileId);
}

export function getViewport(file: OpenFile, pageId: PageId = file.activePageId): Viewport {
  return file.viewports[pageId] ?? DEFAULT_VIEWPORT;
}

// ---------------------------------------------------------------- routing

function pathFor(route: WorkspaceState["route"], pageId?: string): string {
  if (route.kind === "home") return "/";
  return `/file/${route.fileId}${pageId ? `/${pageId}` : ""}`;
}

function pushPath(path: string) {
  if (window.location.pathname !== path) window.history.pushState(null, "", path);
}

export function goHome() {
  setState({ route: { kind: "home" } });
  pushPath("/");
}

/** Sync state from the current URL (initial load and back/forward). */
export async function syncFromLocation() {
  const m = window.location.pathname.match(/^\/file\/([^/]+)(?:\/([^/]+))?/);
  if (m) await openFile(decodeURIComponent(m[1]), m[2] ? decodeURIComponent(m[2]) : undefined, { push: false });
  else setState({ route: { kind: "home" } });
}

// ---------------------------------------------------------------- files

const loading = new Map<string, Promise<OpenFile>>();

/** Open (or focus) a file tab. Loads from the server if needed. */
export async function openFile(fileId: string, pageId?: string, opts: { push?: boolean; focus?: boolean } = {}): Promise<OpenFile> {
  const focus = opts.focus ?? true;
  let file = getOpenFile(fileId);
  if (!file) {
    let pending = loading.get(fileId);
    if (!pending) {
      pending = api.getFile(fileId).then((doc) => addOpenFile(doc));
      loading.set(fileId, pending);
      pending.finally(() => loading.delete(fileId));
    }
    file = await pending;
  }
  if (pageId && file.store.doc.pages[pageId] && file.activePageId !== pageId) {
    updateFile(fileId, { activePageId: pageId, selection: [] });
  }
  if (focus) {
    setState({ activeFileId: fileId, route: { kind: "file", fileId }, hoverId: null, editingTextId: null });
    if (opts.push !== false) pushPath(pathFor({ kind: "file", fileId }, getOpenFile(fileId)!.activePageId));
  }
  return getOpenFile(fileId)!;
}

function addOpenFile(doc: FoldDocument): OpenFile {
  const existing = getOpenFile(doc.id);
  if (existing) return existing;
  const store = new DocStore(doc);
  const firstPage = doc.pageList.find((p) => p.type === "page")?.id ?? Object.keys(doc.pages)[0];
  const file: OpenFile = {
    id: doc.id,
    store,
    activePageId: firstPage,
    viewports: {},
    selection: [],
    saveState: "saved",
    lastSavedAt: Date.now(),
  };
  const unsub = store.subscribe((next) => {
    // drop selection entries that no longer exist
    const f = getOpenFile(doc.id);
    if (f) {
      const selection = f.selection.filter((id) => next.nodes[id]);
      const activePageId = next.pages[f.activePageId] ? f.activePageId : (next.pageList.find((p) => p.type === "page")?.id ?? f.activePageId);
      updateFile(doc.id, { saveState: "dirty", selection, activePageId });
    }
    setState((s) => ({ docVersion: s.docVersion + 1 }));
    scheduleSave(doc.id);
  });
  unsubscribers.set(doc.id, unsub);
  setState((s) => ({ openFiles: [...s.openFiles, file] }));
  return file;
}

export function closeFile(fileId: string) {
  const idx = state.openFiles.findIndex((f) => f.id === fileId);
  if (idx < 0) return;
  void flushSave(fileId);
  unsubscribers.get(fileId)?.();
  unsubscribers.delete(fileId);
  const openFiles = state.openFiles.filter((f) => f.id !== fileId);
  if (state.route.kind === "home") {
    // closing from Home (e.g. deleting a file card) keeps the user on Home
    const next = state.activeFileId === fileId ? openFiles[Math.min(idx, openFiles.length - 1)] : undefined;
    setState({ openFiles, ...(state.activeFileId === fileId ? { activeFileId: next?.id ?? null } : {}) });
  } else if (state.activeFileId === fileId) {
    const next = openFiles[Math.min(idx, openFiles.length - 1)];
    setState({ openFiles, activeFileId: next?.id ?? null, route: next ? { kind: "file", fileId: next.id } : { kind: "home" } });
    pushPath(next ? pathFor({ kind: "file", fileId: next.id }, next.activePageId) : "/");
  } else {
    setState({ openFiles });
  }
}

export async function createAndOpenFile(name?: string): Promise<OpenFile> {
  const { id } = await api.createFile({ name });
  return openFile(id);
}

function scheduleSave(fileId: string) {
  clearTimeout(saveTimers.get(fileId));
  saveTimers.set(fileId, setTimeout(() => void flushSave(fileId), 600));
}

export async function flushSave(fileId: string) {
  clearTimeout(saveTimers.get(fileId));
  saveTimers.delete(fileId);
  const file = getOpenFile(fileId);
  if (!file || file.saveState === "saved") return;
  updateFile(fileId, { saveState: "saving" });
  try {
    await api.saveFile(file.store.doc);
    // a newer change may have arrived while saving
    if (!saveTimers.has(fileId)) updateFile(fileId, { saveState: "saved", lastSavedAt: Date.now() });
  } catch (err) {
    console.error("save failed", err);
    updateFile(fileId, { saveState: "error" });
  }
}

/** Replace a file's content with the copy on disk (used when the file changed outside the editor). */
export async function reloadFile(fileId: string) {
  const file = getOpenFile(fileId);
  if (!file) return;
  const before = file.store.doc;
  const doc = await api.getFile(fileId);
  const current = getOpenFile(fileId);
  // A paste or edit can land while the disk read is in flight. Never replace that newer state.
  if (!current || current.store !== file.store || current.store.doc !== before || current.saveState !== "saved") return;
  file.store.reset(doc);
  updateFile(fileId, { saveState: "saved" });
}

// ---------------------------------------------------------------- per-file view state

export function setActivePage(fileId: string, pageId: PageId) {
  updateFile(fileId, { activePageId: pageId, selection: [] });
  setState({ hoverId: null, editingTextId: null });
  if (state.activeFileId === fileId) pushPath(pathFor({ kind: "file", fileId }, pageId));
}

export function setViewport(fileId: string, viewport: Viewport, pageId?: PageId) {
  updateFile(fileId, (f) => ({ viewports: { ...f.viewports, [pageId ?? f.activePageId]: viewport } }));
}

export function setSelection(fileId: string, ids: NodeId[]) {
  updateFile(fileId, { selection: [...new Set(ids)] });
}

export function select(ids: NodeId[], opts: { additive?: boolean; toggle?: boolean } = {}) {
  const file = getActiveFile();
  if (!file) return;
  let next = ids;
  if (opts.additive || opts.toggle) {
    const set = new Set(file.selection);
    for (const id of ids) {
      if (opts.toggle && set.has(id)) set.delete(id);
      else set.add(id);
    }
    next = [...set];
  }
  setSelection(file.id, next);
}

// ---------------------------------------------------------------- ui state

export function setHover(id: NodeId | null) {
  if (state.hoverId !== id) setState({ hoverId: id });
}
export function setTool(tool: Tool) {
  setState({ tool });
}
export function setLeftTab(leftTab: LeftTab) {
  setState({ leftTab });
}
export function setRightTab(rightTab: RightTab) {
  setState({ rightTab });
}
export function setEditingText(id: NodeId | null) {
  setState({ editingTextId: id });
}
export function toggleUiHidden() {
  setState((s) => ({ uiHidden: !s.uiHidden }));
}
export function setBridgeConnected(bridgeConnected: boolean) {
  setState({ bridgeConnected });
}

// ---------------------------------------------------------------- agent activity

export function markAgentWork(fileId: string, artboardIds: NodeId[], client: string, label: string) {
  const now = Date.now();
  setState((s) => {
    const forFile = { ...(s.agentWork[fileId] ?? {}) };
    for (const id of artboardIds) forFile[id] = { client, label, lastAt: now };
    return { agentWork: { ...s.agentWork, [fileId]: forFile }, agentClients: { ...s.agentClients, [client]: now } };
  });
}

export function clearAgentWork(fileId: string, artboardIds?: NodeId[]) {
  setState((s) => {
    if (!artboardIds) {
      const { [fileId]: _, ...rest } = s.agentWork;
      return { agentWork: rest };
    }
    const forFile = { ...(s.agentWork[fileId] ?? {}) };
    for (const id of artboardIds) delete forFile[id];
    return { agentWork: { ...s.agentWork, [fileId]: forFile } };
  });
}

export function noteAgentClient(client: string) {
  setState((s) => ({ agentClients: { ...s.agentClients, [client]: Date.now() } }));
}

/** Expire agent work markers after 90 s of inactivity. */
setInterval(() => {
  const cutoff = Date.now() - 90_000;
  let changed = false;
  const agentWork: WorkspaceState["agentWork"] = {};
  for (const [fileId, map] of Object.entries(state.agentWork)) {
    const kept: Record<NodeId, AgentWork> = {};
    for (const [id, w] of Object.entries(map)) {
      if (w.lastAt >= cutoff) kept[id] = w;
      else changed = true;
    }
    agentWork[fileId] = kept;
  }
  if (changed) setState({ agentWork });
}, 5_000);

window.addEventListener("popstate", () => void syncFromLocation());
window.addEventListener("beforeunload", () => {
  for (const f of state.openFiles) void flushSave(f.id);
});
