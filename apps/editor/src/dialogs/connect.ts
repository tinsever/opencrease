// Pure helpers for the Connect dialog: every URL and command comes from the running server's status.

/** Default server port; only used as a placeholder while the status request is in flight. */
export const DEFAULT_PORT = 29880;

export interface ConnectInfo {
  url: string;
  port: number;
  /** arguments after `opencrease` for the stdio proxy, e.g. ["mcp"] or ["mcp", "--port", "29894"] */
  stdioArgs: string[];
  stdio: string;
  loading: boolean;
  token?: string;
}

export function connectInfo(status: { port: number; mcpUrl: string } | null | undefined): ConnectInfo {
  const port = status?.port ?? DEFAULT_PORT;
  const url = status?.mcpUrl ?? `http://127.0.0.1:${port}/mcp`;
  const stdioArgs = port === DEFAULT_PORT ? ["mcp"] : ["mcp", "--port", String(port)];
  return { url, port, stdioArgs, stdio: ["opencrease", ...stdioArgs].join(" "), loading: !status };
}

export interface ClientSetup {
  id: string;
  name: string;
  /** substring of the MCP clientInfo name, for the connected marker */
  match: RegExp;
  where: string;
  steps: Array<{ label: string; code: string }>;
}

export function clientSetups(info: ConnectInfo): ClientSetup[] {
  const { stdioArgs } = info;
  const url = info.token ? `${info.url}?token=${encodeURIComponent(info.token)}` : info.url;
  const npx = `npx opencrease ${stdioArgs.join(" ")}`;
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      match: /claude/i,
      where: "Run once in a terminal",
      steps: [
        { label: "Local server over stdio (starts OpenCrease when needed)", code: `claude mcp add opencrease -- ${npx}` },
        { label: "Or connect to this running server over HTTP", code: `claude mcp add --transport http opencrease ${url}` },
      ],
    },
    {
      id: "codex",
      name: "Codex",
      match: /codex/i,
      where: "Run once in a terminal",
      steps: [{ label: "Adds OpenCrease to ~/.codex/config.toml", code: `codex mcp add opencrease -- ${npx}` }],
    },
    {
      id: "cursor",
      name: "Cursor",
      match: /cursor/i,
      where: "Add to ~/.cursor/mcp.json",
      steps: [{ label: "~/.cursor/mcp.json", code: JSON.stringify({ mcpServers: { opencrease: { url } } }, null, 2) }],
    },
    {
      id: "vscode",
      name: "VS Code",
      match: /vscode|visual studio code|copilot/i,
      where: "Add to .vscode/mcp.json",
      steps: [{ label: ".vscode/mcp.json", code: JSON.stringify({ servers: { opencrease: { type: "http", url } } }, null, 2) }],
    },
    {
      id: "zed",
      name: "Zed",
      match: /zed/i,
      where: "Add to Zed settings.json",
      steps: [{ label: "settings.json", code: JSON.stringify({ context_servers: { opencrease: { source: "custom", command: "npx", args: ["opencrease", ...stdioArgs] } } }, null, 2) }],
    },
    {
      id: "opencode",
      name: "OpenCode",
      match: /opencode/i,
      where: "Add to opencode.json",
      steps: [{ label: "opencode.json", code: JSON.stringify({ mcp: { opencrease: { type: "remote", url } } }, null, 2) }],
    },
  ];
}
