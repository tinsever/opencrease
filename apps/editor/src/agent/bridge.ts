// WebSocket client for the server's /bridge: announces the open files, runs forwarded tool calls
// and answers with their results. Reconnects with exponential backoff.
import {
  BRIDGE_PATH, errorResult,
  type EditorToServer, type OpenFileInfo, type ServerToEditor, type ToolResult,
} from "@opencrease/protocol";
import { api } from "../state/api";
import { getOpenFile, getState, openFile, reloadFile, setBridgeConnected, subscribe } from "../state/workspace";
import { askPermission } from "./permissions";
import { executeToolCall } from "./runtime";
import { importHtml } from "../import/snapshot";

const VERSION = "0.1.0";
const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

/** Exponential backoff with a little jitter: 500 ms, 1 s, 2 s, ... capped at 10 s. */
export function backoffDelay(attempt: number, random = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.85 + random() * 0.3));
}

function editorId(): string {
  const KEY = "opencrease:editor-id";
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function snapshot(): { openFiles: OpenFileInfo[]; activeFileId: string | null } {
  const s = getState();
  return {
    openFiles: s.openFiles.map((f) => ({ id: f.id, name: f.store.doc.name, activePageId: f.activePageId })),
    activeFileId: s.activeFileId,
  };
}

let started = false;
let ws: WebSocket | null = null;
let attempt = 0;
let lastSent = "";
let queue: Promise<unknown> = Promise.resolve();

function send(msg: EditorToServer): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

function sendState(force = false): void {
  const snap = snapshot();
  const key = JSON.stringify(snap);
  if (!force && key === lastSent) return;
  if (send({ type: "state", ...snap })) lastSent = key;
}

/** Tool calls run one at a time so page switches and undo steps never interleave. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

async function handleCall(msg: Extract<ServerToEditor, { type: "call" }>): Promise<void> {
  let result: ToolResult;
  try {
    result = await enqueue(() => executeToolCall(msg.tool, msg.args ?? {}, msg.client ?? { name: "unknown" }, msg.policy));
  } catch (err) {
    result = errorResult(`${msg.tool} failed in the editor: ${(err as Error).message}`);
  }
  if (!send({ type: "result", callId: msg.callId, result })) {
    console.warn("[opencrease bridge] connection lost before the result of", msg.tool, "could be sent");
  }
}

async function handleFileChanged(fileId: string): Promise<void> {
  const file = getOpenFile(fileId);
  if (!file) return;
  const disk = await api.getFile(fileId);
  const local = file.store.doc;
  const strip = (d: typeof local) => JSON.stringify({ ...d, name: "", updatedAt: 0 });
  const contentDiffers = strip(disk) !== strip(local);
  if (contentDiffers && file.saveState === "saved") {
    await reloadFile(fileId);
    return;
  }
  if (contentDiffers) console.warn("[opencrease bridge] file changed on disk while it has unsaved edits; keeping the editor copy", fileId);
  // renames (rename_resource, Home screen) must survive the next autosave
  if (disk.name !== local.name) file.store.transact("Rename file", (tx) => tx.setDocName(disk.name), { origin: "system" });
}

function onMessage(ev: MessageEvent): void {
  let msg: ServerToEditor;
  try {
    msg = JSON.parse(String(ev.data));
  } catch {
    return;
  }
  switch (msg.type) {
    case "call":
      void handleCall(msg);
      break;
    case "open-file":
      void enqueue(() => openFile(msg.fileId, msg.pageId)).catch((err) => console.warn("[opencrease bridge] open-file failed", err));
      break;
    case "import-html":
      void enqueue(() => importHtml(msg.request)).then((result) => send({ type: "result", callId: msg.callId, result })).catch((err) => {
        send({ type: "result", callId: msg.callId, result: { isError: true, content: [{ type: "text", text: String(err) }] } });
      });
      break;
    case "file-changed-on-disk":
      void handleFileChanged(msg.fileId).catch((err) => console.warn("[opencrease bridge] reload failed", err));
      break;
    case "permission-request":
      void askPermission(msg.client).then((allow) => send({ type: "permission-response", requestId: msg.requestId, allow }));
      break;
  }
}

function connect(): void {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${proto}//${location.host}${BRIDGE_PATH}`);
  ws = socket;
  socket.onopen = () => {
    attempt = 0;
    const snap = snapshot();
    socket.send(JSON.stringify({ type: "hello", editorId: editorId(), version: VERSION, ...snap } satisfies EditorToServer));
    lastSent = JSON.stringify(snap);
    setBridgeConnected(true);
  };
  socket.onmessage = onMessage;
  socket.onclose = () => {
    if (ws === socket) ws = null;
    setBridgeConnected(false);
    setTimeout(connect, backoffDelay(attempt++));
  };
  socket.onerror = () => {
    // onclose follows and schedules the reconnect
  };
}

/** Connect to the server's /bridge and keep the connection alive. Safe to call more than once. */
export function startBridge(): void {
  if (started || typeof window === "undefined" || typeof WebSocket === "undefined") return;
  started = true;
  subscribe(() => sendState());
  // when the tab comes back to the foreground, become the active editor again
  const reassert = () => {
    if (document.visibilityState === "visible") sendState(true);
  };
  document.addEventListener("visibilitychange", reassert);
  window.addEventListener("focus", reassert);
  connect();
}
