// opencrease [workspaceDir] [--port N] [--no-open]
// opencrease mcp [--port N]
import { request } from "node:http";
import { resolve } from "node:path";
import { launchPage, readTokenSync, tokenPath, writeLaunchFile } from "./auth";
import { DEFAULT_PORT, defaultWorkspaceDir, HOST, userConfigDir, VERSION } from "./config";
import { startServer } from "./http";
import { openBrowser } from "./open-browser";
import { runStdio } from "./stdio";
import { parseExportArgs, runExportCommand } from "./export-cli";

const HELP = `OpenCrease ${VERSION}: a local-first design tool with a real HTML/CSS canvas.

Usage
  opencrease [workspaceDir] [--port N] [--no-open]
      Start the editor server. The workspace defaults to ~/Documents/OpenCrease and is
      created if missing. Opens the editor in your browser unless --no-open.

  opencrease export <file.fold> [--node <id|name>] [--format png] [--scale 2x] [-o out/]
  opencrease render <file.fold> [same options as export]
      Export a layer or all top-level layers in hidden Chromium.
      Formats: png, jpg, webp, avif, svg, pdf, mp4, webm.
      Video options: --duration 1..300 --fps 24|30|60.

  opencrease tokens export <file.fold> --format tailwind|css|json [-o file]
      Export design tokens without launching a browser.

  opencrease mcp --headless --file <path.fold>
      Run every MCP tool, including screenshots, in hidden Chromium.

  opencrease mcp [--port N]
      Run an MCP server over stdio for agents (Claude Code, Codex, Cursor, ...).
      Tool calls go to the OpenCrease server on the given port, which is started
      in the background if it is not running.

Options
  --port N     Port of the local server (default ${DEFAULT_PORT})
  --no-open    Do not open the browser on start
  -h, --help   Show this help
  -v, --version

MCP setup
  Claude Code:  claude mcp add opencrease -- opencrease mcp
  HTTP clients: http://${HOST}:${DEFAULT_PORT}/mcp
`;

export interface CliArgs {
  command: "serve" | "mcp" | "help" | "version";
  workspaceDir?: string;
  port: number;
  open: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { command: "serve", port: Number(process.env.OPENCREASE_PORT) || DEFAULT_PORT, open: true };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") out.command = "help";
    else if (a === "-v" || a === "--version") out.command = "version";
    else if (a === "--no-open") out.open = false;
    else if (a === "--open") out.open = true;
    else if (a === "--port" || a === "-p" || a.startsWith("--port=")) {
      const raw = a.startsWith("--port=") ? a.slice(7) : argv[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`Invalid port: ${raw ?? "(missing)"}`);
      out.port = n;
    } else if (a.startsWith("-")) throw new Error(`Unknown option: ${a}`);
    else positional.push(a);
  }
  if (out.command === "serve" && positional[0] === "mcp") {
    out.command = "mcp";
    positional.shift();
  }
  if (positional.length > 1) throw new Error(`Unexpected argument: ${positional[1]}`);
  if (positional[0]) out.workspaceDir = positional[0];
  return out;
}

function isOpenCreaseRunning(port: number): Promise<boolean> {
  return new Promise((done) => {
    const req = request({ host: HOST, port, path: "/api/status", method: "GET", timeout: 2000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          done(JSON.parse(Buffer.concat(chunks).toString("utf8")).app === "opencrease");
        } catch {
          done(false);
        }
      });
    });
    req.on("error", () => done(false));
    req.on("timeout", () => req.destroy());
    req.end();
  });
}

async function serve(args: CliArgs): Promise<void> {
  const workspaceDir = resolve(args.workspaceDir ?? defaultWorkspaceDir());
  let server;
  try {
    server = await startServer({ workspaceDir, port: args.port });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      const url = `http://${HOST}:${args.port}`;
      if (await isOpenCreaseRunning(args.port)) {
        console.log(`OpenCrease is already running at ${url}`);
        if (args.open) await openSignedIn(url, args.port);
        return;
      }
      console.error(`Port ${args.port} is in use by another program. Pick another one with --port.`);
      process.exit(1);
    }
    throw err;
  }
  const editor = process.env.OPENCREASE_EDITOR_URL || server.url;
  console.log(`OpenCrease ${VERSION}`);
  console.log(`  Editor     ${editor}`);
  console.log(`  Workspace  ${server.workspace.root}`);
  console.log(`  MCP        ${server.url}/mcp  (or "opencrease mcp" for stdio)`);
  console.log(`  Token      ${process.env.OPENCREASE_TOKEN?.trim() ? "OPENCREASE_TOKEN (environment override)" : tokenPath(userConfigDir())}  (HTTP clients send it as "Authorization: Bearer <token>")`);
  if (args.open) server.openEditor("/");

  let closing = false;
  const shutdown = () => {
    if (closing) process.exit(0);
    closing = true;
    void server.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** Open a running server's editor through a sign-in launch file, so the browser gets its session cookie. */
async function openSignedIn(url: string, port: number): Promise<void> {
  const token = readTokenSync(userConfigDir(), port);
  if (!token || process.env.OPENCREASE_EDITOR_URL) return openBrowser(process.env.OPENCREASE_EDITOR_URL || url);
  try {
    openBrowser(await writeLaunchFile(userConfigDir(), port, launchPage(url, token, "/")));
  } catch {
    openBrowser(url);
  }
}

export async function main(argv: string[]): Promise<void> {
  let headless;
  try { headless = parseExportArgs(argv); }
  catch (err) {
    console.error(`${(err as Error).message}\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }
  if (headless) {
    try { await runExportCommand(headless); }
    catch (err) { console.error((err as Error).message); process.exitCode = 1; }
    return;
  }
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${HELP}`);
    process.exit(2);
  }
  switch (args.command) {
    case "help":
      process.stdout.write(HELP);
      return;
    case "version":
      console.log(VERSION);
      return;
    case "mcp":
      await runStdio({ port: args.port });
      return;
    case "serve":
      await serve(args);
      return;
  }
}

const isEntry = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return /[\\/]cli\.(ts|js|mjs)$/.test(entry);
})();

if (isEntry) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
