// Test helpers: temp workspaces, a running server and a fake editor that answers bridge calls.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { textResult, type EditorToServer, type OpenFileInfo, type ServerToEditor, type ToolResult } from "@opencrease/protocol";
import { startServer, type RunningServer, type StartOptions } from "./http";

export async function tempDir(prefix = "opencrease-test-"): Promise<{ dir: string; cleanup(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export interface TestServer extends RunningServer {
  dir: string;
  opened: string[];
  stop(): Promise<void>;
}

export async function startTestServer(opts: Partial<StartOptions> = {}): Promise<TestServer> {
  const tmp = await tempDir();
  const opened: string[] = [];
  const server = await startServer({
    workspaceDir: join(tmp.dir, "workspace"),
    userConfigDir: join(tmp.dir, "home"),
    editorDist: join(tmp.dir, "no-dist"),
    port: 0,
    connectTimeoutMs: 1500,
    openBrowser: (url) => opened.push(url),
    // token auth and agent approval have their own tests (auth.test.ts, agents.test.ts)
    auth: false,
    approveAgents: false,
    ...opts,
  });
  return Object.assign(server, {
    dir: tmp.dir,
    opened,
    async stop() {
      await server.close();
      await tmp.cleanup();
    },
  });
}

export type CallHandler = (tool: string, args: Record<string, unknown>, editor: FakeEditor) => ToolResult | Promise<ToolResult>;

export class FakeEditor {
  ws!: WebSocket;
  calls: Array<Extract<ServerToEditor, { type: "call" }>> = [];
  messages: ServerToEditor[] = [];
  openFiles: OpenFileInfo[];
  activeFileId: string | null;
  /** answer to permission-request messages (undefined: never answer) */
  permission: boolean | undefined = undefined;

  constructor(
    private url: string,
    private handler: CallHandler = (tool, args) => textResult({ tool, args }),
    openFiles: OpenFileInfo[] = [],
  ) {
    this.openFiles = openFiles;
    this.activeFileId = openFiles[0]?.id ?? null;
  }

  async connect(editorId = "fake-editor"): Promise<this> {
    this.ws = new WebSocket(`${this.url.replace(/^http/, "ws")}/bridge`);
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
    this.ws.on("message", (data) => void this.onMessage(JSON.parse(String(data)) as ServerToEditor));
    this.send({ type: "hello", editorId, version: "test", openFiles: this.openFiles, activeFileId: this.activeFileId });
    return this;
  }

  send(msg: EditorToServer): void {
    this.ws.send(JSON.stringify(msg));
  }

  private async onMessage(msg: ServerToEditor): Promise<void> {
    this.messages.push(msg);
    if (msg.type === "open-file") {
      if (!this.openFiles.some((f) => f.id === msg.fileId)) {
        this.openFiles.push({ id: msg.fileId, name: msg.fileId, activePageId: msg.pageId ?? "p-1-0" });
      }
      this.activeFileId = msg.fileId;
      this.send({ type: "state", openFiles: this.openFiles, activeFileId: this.activeFileId });
    } else if (msg.type === "permission-request") {
      if (this.permission !== undefined) this.send({ type: "permission-response", requestId: msg.requestId, allow: this.permission });
    } else if (msg.type === "call") {
      this.calls.push(msg);
      const result = await this.handler(msg.tool, msg.args, this);
      this.send({ type: "result", callId: msg.callId, result });
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) return resolve();
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }
}

export async function waitUntil(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("waitUntil timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

export function firstText(result: ToolResult): string {
  const block = result.content[0];
  return block && block.type === "text" ? block.text : "";
}
