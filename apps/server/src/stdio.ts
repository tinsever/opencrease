// `opencrease mcp`: stdio MCP server that forwards every tool call to the running OpenCrease server.
import { spawn } from "node:child_process";
import { request } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { errorResult, type AgentClientInfo, type ToolResult } from "@opencrease/protocol";
import { readTokenSync, TOKEN_HEADER } from "./auth";
import { BIN_PATH, defaultWorkspaceDir, HOST, userConfigDir } from "./config";
import { createMcpServer } from "./mcp";
import type { CallTool } from "./tools";

const START_TIMEOUT_MS = 10_000;

interface HttpResponse {
  status: number;
  body: string;
}

function httpJson(method: string, url: string, body?: unknown, timeoutMs = 0): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    // the server writes the token file on start, so read it on every call
    const token = readTokenSync(userConfigDir(), new URL(url).port ? Number(new URL(url).port) : 80);
    const headers: Record<string, string | number> = payload ? { "content-type": "application/json", "content-length": payload.length } : {};
    if (token) headers[TOKEN_HEADER] = token;
    const req = request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    if (timeoutMs > 0) req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(payload);
  });
}

type Status = "opencrease" | "other" | "down";

async function probe(base: string): Promise<Status> {
  try {
    const res = await httpJson("GET", `${base}/api/status`, undefined, 2000);
    if (res.status !== 200) return "other";
    const data = JSON.parse(res.body);
    return data && data.app === "opencrease" ? "opencrease" : "other";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ECONNREFUSED" || code === "ECONNRESET" ? "down" : "other";
  }
}

/** The desktop app's command line tool sets OPENCREASE_DESKTOP_LAUNCH (a JSON array) so agents start the app, not a bare server. */
function desktopLaunch(): string[] | null {
  try {
    const v: unknown = JSON.parse(process.env.OPENCREASE_DESKTOP_LAUNCH ?? "null");
    return Array.isArray(v) && v.length && v.every((s) => typeof s === "string") ? (v as string[]) : null;
  } catch {
    return null;
  }
}

function spawnServer(port: number): void {
  const app = desktopLaunch();
  const env = { ...process.env };
  if (app) delete env.ELECTRON_RUN_AS_NODE;
  const [cmd, ...args] = app
    ? [...app, "--background", `--port=${port}`]
    : [process.execPath, BIN_PATH, "--no-open", "--port", String(port), defaultWorkspaceDir()];
  const child = spawn(cmd!, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env,
  });
  child.on("error", () => {});
  child.unref();
}

export interface RemoteCallOptions {
  port: number;
  /** spawn the server when it is not running (default true) */
  autoStart?: boolean;
}

/** A CallTool that goes through POST /api/tools/call on the local server. */
export function remoteCallTool(opts: RemoteCallOptions): CallTool {
  const base = `http://${HOST}:${opts.port}`;
  let starting: Promise<void> | null = null;

  const ensureServer = async (): Promise<void> => {
    const status = await probe(base);
    if (status === "opencrease") return;
    if (status === "other") throw new Error(`Port ${opts.port} is used by another program. Start OpenCrease with --port and pass the same port to "opencrease mcp".`);
    if (opts.autoStart === false) throw new Error(`OpenCrease is not running on port ${opts.port}. Start it with "opencrease".`);
    starting ??= (async () => {
      spawnServer(opts.port);
      const deadline = Date.now() + START_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
        if ((await probe(base)) === "opencrease") return;
      }
      throw new Error(`Started OpenCrease but it did not answer on port ${opts.port} within ${START_TIMEOUT_MS / 1000} s.`);
    })().finally(() => {
      starting = null;
    });
    await starting;
  };

  const post = async (tool: string, args: unknown, client: AgentClientInfo): Promise<ToolResult> => {
    const res = await httpJson("POST", `${base}/api/tools/call`, { tool, args, client });
    let data: unknown;
    try {
      data = JSON.parse(res.body);
    } catch {
      return errorResult(`OpenCrease server returned an invalid response (HTTP ${res.status}).`);
    }
    if (data && typeof data === "object" && Array.isArray((data as ToolResult).content)) return data as ToolResult;
    const msg = (data as { error?: string })?.error;
    if (res.status === 401) return errorResult(`OpenCrease rejected the session token (${msg ?? "unauthorized"}). "opencrease mcp" reads it from ${userConfigDir()}/sessions/${opts.port}.token; make sure the server uses the same OPENCREASE_HOME.`);
    return errorResult(msg ? `OpenCrease server error: ${msg}` : `OpenCrease server error (HTTP ${res.status}).`);
  };

  return async (tool, args, client = { name: "unknown" }) => {
    try {
      return await post(tool, args, client);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ECONNREFUSED" && code !== "ECONNRESET") return errorResult(`Could not reach OpenCrease: ${(err as Error).message}`);
    }
    try {
      await ensureServer();
      return await post(tool, args, client);
    } catch (err) {
      return errorResult((err as Error).message);
    }
  };
}

export async function runStdio(opts: RemoteCallOptions): Promise<void> {
  const server = createMcpServer(remoteCallTool(opts));
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const shutdown = () => {
    void server.close().finally(() => process.exit(0));
  };
  process.stdin.on("end", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
