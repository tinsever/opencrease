// WebSocket hub at /bridge. Editor tabs connect here; the server forwards editor-side tool calls to them.
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import {
  BRIDGE_PATH,
  DEFAULT_TOOL_TIMEOUT_MS,
  errorResult,
  type AgentClientInfo,
  type CallPolicy,
  type EditorToServer,
  type ImportHtmlRequest,
  type OpenFileInfo,
  type ServerToEditor,
  type ToolResult,
} from "@opencrease/protocol";
import { isLocalHostHeader, isLocalOrigin } from "./security";

export const EDITOR_CONNECT_TIMEOUT_MS = 15_000;

export interface EditorConnection {
  editorId: string;
  version: string;
  openFiles: OpenFileInfo[];
  activeFileId: string | null;
  lastSeen: number;
  ws: WebSocket;
}

interface PendingQuestion {
  editor: EditorConnection;
  timer: NodeJS.Timeout;
  resolve(allow: boolean | null): void;
}

interface PendingCall {
  editor: EditorConnection;
  tool: string;
  timer: NodeJS.Timeout;
  resolve(result: ToolResult): void;
}

export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeError";
  }
}

export interface BridgeOptions {
  /** Absolute editor URL for a path like "/" or "/file/<id>". */
  editorUrl(path: string): string;
  /** Called when a tool needs an editor and none is connected. */
  openBrowser(url: string): void;
  connectTimeoutMs?: number;
}

export class BridgeHub {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 * 1024 });
  private editors = new Map<WebSocket, EditorConnection>();
  private active: EditorConnection | null = null;
  private pending = new Map<string, PendingCall>();
  private questions = new Map<string, PendingQuestion>();
  private listeners = new Set<() => void>();
  private lastAutoOpen = 0;
  private heartbeat: NodeJS.Timeout;
  private alive = new WeakSet<WebSocket>();
  readonly connectTimeoutMs: number;

  constructor(private opts: BridgeOptions) {
    this.connectTimeoutMs = opts.connectTimeoutMs ?? EDITOR_CONNECT_TIMEOUT_MS;
    this.wss.on("connection", (ws) => this.onConnection(ws));
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (!this.alive.has(ws)) {
          ws.terminate();
          continue;
        }
        this.alive.delete(ws);
        ws.ping();
      }
    }, 30_000);
    this.heartbeat.unref();
  }

  /** Handle an HTTP upgrade. Returns false if the request is not for the bridge. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const path = (req.url ?? "/").split("?")[0];
    if (path !== BRIDGE_PATH) return false;
    if (!isLocalHostHeader(req.headers.host) || !isLocalOrigin(req.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return true;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req));
    return true;
  }

  // ----- state ----------------------------------------------------------------

  get connected(): boolean {
    return this.active !== null;
  }

  get activeEditor(): EditorConnection | null {
    return this.active;
  }

  get activeFileId(): string | null {
    return this.active?.activeFileId ?? null;
  }

  get editorCount(): number {
    return this.editors.size;
  }

  /** Files open in any editor, the active editor's first. */
  openFiles(): OpenFileInfo[] {
    const seen = new Map<string, OpenFileInfo>();
    const editors = [...this.editors.values()].sort((a, b) => (a === this.active ? -1 : b === this.active ? 1 : b.lastSeen - a.lastSeen));
    for (const ed of editors) for (const f of ed.openFiles) if (!seen.has(f.id)) seen.set(f.id, f);
    return [...seen.values()];
  }

  isOpen(fileId: string): boolean {
    return this.editorWithFile(fileId) !== undefined;
  }

  private editorWithFile(fileId: string): EditorConnection | undefined {
    if (this.active?.openFiles.some((f) => f.id === fileId)) return this.active;
    let best: EditorConnection | undefined;
    for (const ed of this.editors.values()) {
      if (ed.openFiles.some((f) => f.id === fileId) && (!best || ed.lastSeen > best.lastSeen)) best = ed;
    }
    return best;
  }

  /** Subscribe to editor state changes (connect, disconnect, hello, state). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emitChange(): void {
    for (const fn of [...this.listeners]) fn();
  }

  private waitFor<T>(check: () => T | null | undefined, timeoutMs: number): Promise<T | undefined> {
    const now = check();
    if (now) return Promise.resolve(now);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        off();
        resolve(undefined);
      }, timeoutMs);
      const off = this.onChange(() => {
        const v = check();
        if (v) {
          clearTimeout(timer);
          off();
          resolve(v);
        }
      });
    });
  }

  // ----- connections ----------------------------------------------------------

  private onConnection(ws: WebSocket): void {
    this.alive.add(ws);
    ws.on("pong", () => this.alive.add(ws));
    ws.on("message", (data) => {
      let msg: EditorToServer;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      this.onMessage(ws, msg);
    });
    ws.on("close", () => this.onClose(ws));
    ws.on("error", () => {});
  }

  private onMessage(ws: WebSocket, msg: EditorToServer): void {
    if (!msg || typeof msg !== "object") return;
    this.alive.add(ws);
    switch (msg.type) {
      case "hello": {
        const conn: EditorConnection = {
          editorId: String(msg.editorId || randomUUID()),
          version: String(msg.version ?? ""),
          openFiles: Array.isArray(msg.openFiles) ? msg.openFiles : [],
          activeFileId: msg.activeFileId ?? null,
          lastSeen: Date.now(),
          ws,
        };
        this.editors.set(ws, conn);
        this.active = conn;
        this.emitChange();
        break;
      }
      case "state": {
        const conn = this.editors.get(ws);
        if (!conn) return;
        conn.openFiles = Array.isArray(msg.openFiles) ? msg.openFiles : [];
        conn.activeFileId = msg.activeFileId ?? null;
        conn.lastSeen = Date.now();
        this.active = conn;
        this.emitChange();
        break;
      }
      case "result": {
        const call = this.pending.get(msg.callId);
        if (!call) return;
        this.pending.delete(msg.callId);
        clearTimeout(call.timer);
        const r = msg.result;
        call.resolve(r && Array.isArray(r.content) ? r : errorResult(`The editor sent a malformed result for ${call.tool}`));
        break;
      }
      case "permission-response": {
        const q = this.questions.get(msg.requestId);
        if (!q) return;
        this.questions.delete(msg.requestId);
        clearTimeout(q.timer);
        q.resolve(msg.allow === true);
        break;
      }
    }
  }

  private onClose(ws: WebSocket): void {
    const conn = this.editors.get(ws);
    this.editors.delete(ws);
    if (!conn) return;
    for (const [id, call] of this.pending) {
      if (call.editor !== conn) continue;
      this.pending.delete(id);
      clearTimeout(call.timer);
      call.resolve(errorResult(`The editor tab closed before ${call.tool} finished. Try again once the editor is open.`));
    }
    for (const [id, q] of this.questions) {
      if (q.editor !== conn) continue;
      this.questions.delete(id);
      clearTimeout(q.timer);
      q.resolve(null);
    }
    if (this.active === conn) {
      this.active = null;
      for (const ed of this.editors.values()) if (!this.active || ed.lastSeen > this.active.lastSeen) this.active = ed;
    }
    this.emitChange();
  }

  private send(conn: EditorConnection, msg: ServerToEditor): void {
    conn.ws.send(JSON.stringify(msg));
  }

  // ----- operations -----------------------------------------------------------

  /** Return the active editor, opening the browser and waiting for one if needed. */
  async ensureEditor(fileId?: string): Promise<EditorConnection> {
    if (this.active) return this.active;
    const url = this.opts.editorUrl(fileId ? `/file/${encodeURIComponent(fileId)}` : "/");
    const now = Date.now();
    if (now - this.lastAutoOpen > this.connectTimeoutMs) {
      this.lastAutoOpen = now;
      this.opts.openBrowser(url);
    }
    const ed = await this.waitFor(() => this.active, this.connectTimeoutMs);
    if (!ed) {
      throw new BridgeError(
        `No OpenCrease editor is connected. Tried to open ${url} in the browser, but no editor connected within ${Math.round(this.connectTimeoutMs / 1000)} s. Ask the user to open ${url}.`,
      );
    }
    return ed;
  }

  /** Make sure some editor has fileId open (asks the active editor to open it if needed). */
  async requestOpenFile(fileId: string, pageId?: string): Promise<EditorConnection> {
    const already = this.editorWithFile(fileId);
    if (already) return already;
    const ed = await this.ensureEditor(fileId);
    const opened = this.editorWithFile(fileId);
    if (opened) return opened;
    const msg: ServerToEditor = { type: "open-file", fileId };
    if (pageId) msg.pageId = pageId;
    this.send(ed, msg);
    const result = await this.waitFor(() => this.editorWithFile(fileId), this.connectTimeoutMs);
    if (!result) throw new BridgeError(`The editor did not open file ${fileId} within ${Math.round(this.connectTimeoutMs / 1000)} s.`);
    return result;
  }

  /**
   * Ask the user in the editor whether an agent client may use OpenCrease. Opens the editor when none
   * is connected. Resolves true or false, or null when nobody answered within timeoutMs.
   */
  async requestPermission(client: AgentClientInfo, timeoutMs = 120_000): Promise<boolean | null> {
    let ed: EditorConnection;
    try {
      ed = await this.ensureEditor();
    } catch {
      return null;
    }
    const requestId = randomUUID();
    return new Promise<boolean | null>((resolve) => {
      const timer = setTimeout(() => {
        this.questions.delete(requestId);
        resolve(null);
      }, timeoutMs);
      this.questions.set(requestId, { editor: ed, timer, resolve });
      try {
        this.send(ed, { type: "permission-request", requestId, client });
      } catch {
        clearTimeout(timer);
        this.questions.delete(requestId);
        resolve(null);
      }
    });
  }

  /** Forward a tool call to the editor that has the file open (or the active editor). */
  async callEditor(
    tool: string,
    args: Record<string, unknown>,
    client: AgentClientInfo,
    opts: { timeoutMs?: number; policy?: CallPolicy } = {},
  ): Promise<ToolResult> {
    const fileId = typeof args.fileId === "string" && args.fileId ? args.fileId : undefined;
    const ed = fileId ? await this.requestOpenFile(fileId) : await this.ensureEditor();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    const callId = randomUUID();
    return new Promise<ToolResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        resolve(errorResult(`The editor did not answer ${tool} within ${Math.round(timeoutMs / 1000)} s.`));
      }, timeoutMs);
      this.pending.set(callId, { editor: ed, tool, timer, resolve });
      try {
        const msg: Extract<ServerToEditor, { type: "call" }> = { type: "call", callId, tool, args, client };
        if (opts.policy) msg.policy = opts.policy;
        this.send(ed, msg);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(callId);
        resolve(errorResult(`Could not reach the editor: ${(err as Error).message}`));
      }
    });
  }

  /** Ask the editor that has the file open (opening it if needed) to import HTML as a new artboard. */
  async importHtml(request: ImportHtmlRequest, timeoutMs = 60_000): Promise<ToolResult> {
    const ed = await this.requestOpenFile(request.fileId);
    const callId = randomUUID();
    return new Promise<ToolResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        resolve(errorResult(`The editor did not finish the import within ${Math.round(timeoutMs / 1000)} s.`));
      }, timeoutMs);
      this.pending.set(callId, { editor: ed, tool: "snapshot import", timer, resolve });
      try {
        this.send(ed, { type: "import-html", callId, request });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(callId);
        resolve(errorResult(`Could not reach the editor: ${(err as Error).message}`));
      }
    });
  }

  /** Tell editors that a file changed outside the editor (rename, external edit). */
  notifyFileChanged(fileId: string): void {
    for (const ed of this.editors.values()) {
      if (ed.openFiles.some((f) => f.id === fileId)) this.send(ed, { type: "file-changed-on-disk", fileId });
    }
  }

  /** Force existing transports to authenticate again after a credential reset. */
  disconnectClients(): void {
    for (const ws of this.wss.clients) ws.terminate();
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const [id, call] of this.pending) {
      clearTimeout(call.timer);
      call.resolve(errorResult("The OpenCrease server is shutting down."));
      this.pending.delete(id);
    }
    for (const [id, q] of this.questions) {
      clearTimeout(q.timer);
      q.resolve(null);
      this.questions.delete(id);
    }
    for (const ws of this.wss.clients) ws.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
