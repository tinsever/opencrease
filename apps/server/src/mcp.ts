// MCP server construction (shared by Streamable HTTP and stdio) and the /mcp session manager.
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest, CallToolRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SERVER_INSTRUCTIONS, TOOLS, type AgentClientInfo } from "@opencrease/protocol";
import { VERSION } from "./config";
import type { CallTool } from "./tools";

/** Build an McpServer exposing every tool in TOOLS, routed to callTool. */
export function createMcpServer(callTool: CallTool): McpServer {
  const server = new McpServer({ name: "opencrease", title: "OpenCrease", version: VERSION }, { instructions: SERVER_INSTRUCTIONS });

  const clientInfo = (): AgentClientInfo => {
    const v = server.server.getClientVersion();
    if (!v) return { name: "unknown" };
    return v.version ? { name: v.name, version: v.version } : { name: v.name };
  };

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputShape,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.readOnly,
          destructiveHint: tool.readOnly ? false : tool.destructive === true,
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => (await callTool(tool.name, args, clientInfo())) as CallToolResult,
    );
  }
  // Keep tools/list canonical, but route raw calls through our compatibility and validation layer.
  server.server.setRequestHandler(CallToolRequestSchema, async (request) =>
    (await callTool(request.params.name, request.params.arguments ?? {}, clientInfo())) as CallToolResult,
  );
  return server;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

/** Stateful Streamable HTTP sessions at /mcp, one McpServer per session. */
export class McpHttpSessions {
  private sessions = new Map<string, Session>();

  constructor(private callTool: CallTool) {}

  get size(): number {
    return this.sessions.size;
  }

  async handle(req: IncomingMessage, res: ServerResponse, body?: unknown): Promise<void> {
    const header = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(header) ? header[0] : header;

    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) return sendJsonRpcError(res, 404, -32001, "Session not found. Start a new session.");
      await session.transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === "POST" && isInitializeRequest(body)) {
      const server = createMcpServer(this.callTool);
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          this.sessions.set(id, { transport, server });
        },
      });
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id && this.sessions.get(id)?.transport === transport) this.sessions.delete(id);
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    sendJsonRpcError(res, 400, -32000, "Bad request: send an initialize request first, or include a valid Mcp-Session-Id header.");
  }

  async close(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(all.map((s) => s.server.close()));
  }
}

function sendJsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}
