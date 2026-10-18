// Runs the OpenCrease server inside the Electron main process (the same code as `opencrease`, bundled).
import { DEFAULT_PORT } from "../../server/src/config";
import { startServer, type RunningServer } from "../../server/src/http";

export interface HostOptions {
  workspace: string;
  port: number;
  /** fail instead of falling back to a free port when `port` is taken (explicit --port or OPENCREASE_PORT) */
  strictPort: boolean;
  editorDist: string;
  guidesDir: string;
  /** Vite dev server URL in development; the server itself otherwise */
  editorBaseUrl?: string;
  /** the server needs an editor and none is connected */
  openEditor(url: string): void;
}

export class ServerHost {
  private server: RunningServer | null = null;
  private opts: HostOptions;

  constructor(opts: HostOptions) {
    this.opts = opts;
  }

  get running(): RunningServer | null {
    return this.server;
  }

  get port(): number {
    return this.server?.port ?? this.opts.port;
  }

  get workspace(): string {
    return this.server?.workspace.root ?? this.opts.workspace;
  }

  /** URL windows load: the Vite dev server in development, else the server itself. */
  get editorUrl(): string {
    return (this.opts.editorBaseUrl || this.server?.url || `http://127.0.0.1:${this.port}`).replace(/\/$/, "");
  }

  async start(): Promise<RunningServer> {
    const base = {
      workspaceDir: this.opts.workspace,
      editorDist: this.opts.editorDist,
      builtinGuidesDir: this.opts.guidesDir,
      openBrowser: (url: string) => this.opts.openEditor(url),
      ...(this.opts.editorBaseUrl ? { editorBaseUrl: this.opts.editorBaseUrl } : {}),
    };
    try {
      this.server = await startServer({ ...base, port: this.opts.port });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE" || this.opts.strictPort) throw err;
      // Another OpenCrease (the CLI, or a second copy of the app) owns the default port. Run on a free
      // port; the Connect dialog and the agent configs pick up the real port from /api/status.
      console.warn(`[opencrease] port ${this.opts.port} is in use, using a free port instead`);
      this.server = await startServer({ ...base, port: 0 });
    }
    return this.server;
  }

  /** Switch to another workspace folder on the same port. */
  async restart(workspace: string): Promise<RunningServer> {
    const port = this.server?.port ?? this.opts.port;
    await this.stop();
    this.opts = { ...this.opts, workspace, port, strictPort: true };
    return this.start();
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (s) await s.close();
  }

  /** Arguments after `opencrease` for the stdio proxy of this server. */
  mcpArgs(): string[] {
    return this.port === DEFAULT_PORT ? ["mcp"] : ["mcp", "--port", String(this.port)];
  }
}
