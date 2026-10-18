// "Connect your agent": writes the OpenCrease MCP entry into each agent's own config file.
// Every edit is previewed as a diff first, the old file is backed up, and the new file is written
// atomically. JSON files are edited with jsonc-parser so comments and formatting survive.
import { constants } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { parse as parseToml, type TomlTable } from "smol-toml";
import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { applyEdits, findNodeAtLocation, format, getNodeValue, modify, parseTree, type ParseError } from "jsonc-parser";
import type { AgentClientId, AgentConfigApplyResult, AgentConfigDiffLine, AgentConfigPreview } from "@opencrease/protocol";

export const AGENT_CLIENTS: AgentClientId[] = ["claude-code", "codex", "cursor", "vscode", "zed", "opencode"];
export const SERVER_NAME = "opencrease";

/** How an agent starts the stdio MCP server. */
export interface StdioCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ConfigContext {
  home: string;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  /** clock for backup names (tests) */
  now?: () => Date;
}

export function isAgentClient(v: unknown): v is AgentClientId {
  return typeof v === "string" && (AGENT_CLIENTS as string[]).includes(v);
}

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

function xdgConfig(ctx: ConfigContext): string {
  return ctx.env.XDG_CONFIG_HOME || join(ctx.home, ".config");
}

function appData(ctx: ConfigContext): string {
  return ctx.env.APPDATA || join(ctx.home, "AppData", "Roaming");
}

/** Absolute path of the config file each client reads its user-level MCP servers from. */
export async function configPath(client: AgentClientId, ctx: ConfigContext): Promise<string> {
  switch (client) {
    case "claude-code":
      return ctx.env.CLAUDE_CONFIG_DIR ? join(ctx.env.CLAUDE_CONFIG_DIR, ".claude.json") : join(ctx.home, ".claude.json");
    case "codex":
      return join(ctx.env.CODEX_HOME || join(ctx.home, ".codex"), "config.toml");
    case "cursor":
      return join(ctx.home, ".cursor", "mcp.json");
    case "vscode": {
      const base = ctx.platform === "darwin" ? join(ctx.home, "Library", "Application Support") : ctx.platform === "win32" ? appData(ctx) : xdgConfig(ctx);
      return join(base, "Code", "User", "mcp.json");
    }
    case "zed":
      return ctx.platform === "win32" ? join(appData(ctx), "Zed", "settings.json") : join(xdgConfig(ctx), "zed", "settings.json");
    case "opencode": {
      const dir = join(xdgConfig(ctx), "opencode");
      const json = join(dir, "opencode.json");
      const jsonc = join(dir, "opencode.jsonc");
      if (!(await exists(json)) && (await exists(jsonc))) return jsonc;
      return json;
    }
  }
}

const NOTES: Record<AgentClientId, string> = {
  "claude-code": "New Claude Code sessions load it. In a running session, run /mcp to reconnect.",
  codex: "Start a new Codex session to load it.",
  cursor: "Cursor loads it on its next start, or turn it on in Cursor Settings under MCP.",
  vscode: "VS Code lists it under MCP servers. Start it there if it does not start on its own.",
  zed: "Zed reloads its settings when the file changes.",
  opencode: "Start a new OpenCode session to load it.",
};

// ------------------------------------------------------------------------------------- JSON

interface JsonTarget {
  path: (string | number)[];
  value: unknown;
  /** content for a file that does not exist yet, before the entry is added */
  seed?: Record<string, unknown>;
}

function jsonTarget(client: Exclude<AgentClientId, "codex">, cmd: StdioCommand): JsonTarget {
  const env = cmd.env && Object.keys(cmd.env).length ? cmd.env : undefined;
  switch (client) {
    case "claude-code":
      return { path: ["mcpServers", SERVER_NAME], value: { type: "stdio", command: cmd.command, args: cmd.args, env: env ?? {} } };
    case "cursor":
      return { path: ["mcpServers", SERVER_NAME], value: { command: cmd.command, args: cmd.args, ...(env ? { env } : {}) } };
    case "vscode":
      return { path: ["servers", SERVER_NAME], value: { type: "stdio", command: cmd.command, args: cmd.args, ...(env ? { env } : {}) } };
    case "zed":
      return { path: ["context_servers", SERVER_NAME], value: { command: cmd.command, args: cmd.args, env: env ?? {} } };
    case "opencode":
      return {
        path: ["mcp", SERVER_NAME],
        value: { type: "local", command: [cmd.command, ...cmd.args], enabled: true, ...(env ? { environment: env } : {}) },
        seed: { $schema: "https://opencode.ai/config.json" },
      };
  }
}

export class ConfigError extends Error {}

function detectIndent(text: string): { insertSpaces: boolean; tabSize: number } {
  const m = /^([ \t]+)\S/m.exec(text);
  if (!m) return { insertSpaces: true, tabSize: 2 };
  if (m[1]!.startsWith("\t")) return { insertSpaces: false, tabSize: 1 };
  return { insertSpaces: true, tabSize: Math.min(8, m[1]!.length) };
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** Returns the new file content, or the same string when the entry is already there. */
export function editJson(before: string | null, target: JsonTarget, fileLabel: string): string {
  const eol = before?.includes("\r\n") ? "\r\n" : "\n";
  const indent = detectIndent(before ?? "");
  const fresh = () => {
    const obj: Record<string, unknown> = { ...(target.seed ?? {}) };
    let at = obj;
    target.path.slice(0, -1).forEach((k) => (at = (at[k] = {}) as Record<string, unknown>));
    at[target.path[target.path.length - 1]!] = target.value;
    return JSON.stringify(obj, null, indent.insertSpaces ? indent.tabSize : "\t").replace(/\n/g, eol) + eol;
  };
  if (!before?.trim()) return fresh();
  const errors: ParseError[] = [];
  const tree = parseTree(before, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !tree || tree.type !== "object") {
    throw new ConfigError(`${fileLabel} is not valid JSON, so OpenCrease did not touch it. Fix the file or add the entry by hand.`);
  }
  // Every parent on the way must be an object (or missing), never an array or a string.
  for (let i = 1; i < target.path.length; i++) {
    const parent = findNodeAtLocation(tree, target.path.slice(0, i));
    if (parent && parent.type !== "object") {
      throw new ConfigError(`"${target.path.slice(0, i).join(".")}" in ${fileLabel} is not an object, so OpenCrease did not touch it.`);
    }
  }
  const current = findNodeAtLocation(tree, target.path);
  if (current && deepEqual(getNodeValue(current), target.value)) return before;
  if (!tree.children?.length && !/\/[/*]/.test(before)) return fresh();
  // Insert without touching the rest, then format only the inserted text.
  const edits = modify(before, target.path, target.value, {});
  let out = applyEdits(before, edits);
  const edit = edits.length === 1 ? edits[0]! : undefined;
  if (edit) out = applyEdits(out, format(out, { offset: edit.offset, length: edit.content.length }, { ...indent, eol }));
  return out;
}

// ------------------------------------------------------------------------------------- TOML (Codex)

const TOML_HEADER = /^\s*\[\s*([^\]]+?)\s*\]\s*(#.*)?$/;

function tomlKeyParts(raw: string): string[] {
  return raw.split(".").map((p) => p.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1"));
}

function codexBlock(cmd: StdioCommand, eol: string): string {
  const lines = [`[mcp_servers.${SERVER_NAME}]`, `command = ${JSON.stringify(cmd.command)}`, `args = [${cmd.args.map((a) => JSON.stringify(a)).join(", ")}]`];
  if (cmd.env && Object.keys(cmd.env).length) {
    lines.push("", `[mcp_servers.${SERVER_NAME}.env]`);
    for (const [k, v] of Object.entries(cmd.env)) lines.push(`${/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k)} = ${JSON.stringify(v)}`);
  }
  return lines.join(eol) + eol;
}

/** Replace (or append) the [mcp_servers.opencrease] table and its sub-tables. Other text stays as it is. */
function rewriteCodexToml(before: string | null, cmd: StdioCommand): string {
  const text = before ?? "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.length ? text.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const block = codexBlock(cmd, eol);

  // Inline forms we do not rewrite: `mcp_servers.opencrease = {...}` or `opencrease = {...}` under [mcp_servers].
  let table: string[] = [];
  for (const line of lines) {
    const h = TOML_HEADER.exec(line);
    if (h && !line.trim().startsWith("[[")) table = tomlKeyParts(h[1]!);
    const key = /^\s*([A-Za-z0-9_."'-]+)\s*=/.exec(line);
    if (!h && key) {
      const full = [...table, ...tomlKeyParts(key[1]!)];
      if (full[0] === "mcp_servers" && full[1] === SERVER_NAME && table.length < 2) {
        throw new ConfigError(`~/.codex/config.toml defines mcp_servers.${SERVER_NAME} inline, so OpenCrease did not touch it. Edit that entry by hand.`);
      }
    }
  }

  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < lines.length; i++) {
    const h = TOML_HEADER.exec(lines[i]!);
    if (!h || lines[i]!.trim().startsWith("[[")) continue;
    const parts = tomlKeyParts(h[1]!);
    if (parts[0] !== "mcp_servers" || parts[1] !== SERVER_NAME) continue;
    let end = i + 1;
    while (end < lines.length && !TOML_HEADER.exec(lines[end]!)) end++;
    // keep blank lines that separate this table from the next one
    let trim = end;
    while (trim > i + 1 && lines[trim - 1]!.trim() === "") trim--;
    ranges.push([i, trim]);
    i = end - 1;
  }

  if (!ranges.length) {
    const head = lines.join(eol);
    return (head ? head + eol + eol : "") + block;
  }
  const blockLines = block.slice(0, -eol.length).split(eol);
  const out: string[] = [];
  let at = 0;
  ranges.forEach(([s, e], n) => {
    out.push(...lines.slice(at, s));
    if (n === 0) out.push(...blockLines);
    // a later sub-table goes away together with the blank lines that separated it
    else while (out.length && out[out.length - 1]!.trim() === "") out.pop();
    at = e;
  });
  out.push(...lines.slice(at));
  return out.join(eol) + eol;
}

/** Validate both documents and prove that only our server entry changes, including around
 * multiline strings, quoted keys and inline tables that a line-based editor cannot safely edit. */
export function editCodexToml(before: string | null, cmd: StdioCommand): string {
  try {
    const expected = parseToml(before ?? "", { integersAsBigInt: true });
    const servers = expected.mcp_servers;
    if (servers !== undefined && (!servers || typeof servers !== "object" || Array.isArray(servers))) {
      throw new ConfigError("mcp_servers must be a table. Edit this config by hand.");
    }
    const entry = parseToml(codexBlock(cmd, "\n"), { integersAsBigInt: true }).mcp_servers as TomlTable;
    const expectedServers = (servers ?? Object.create(null)) as TomlTable;
    expectedServers.opencrease = entry.opencrease!;
    expected.mcp_servers = expectedServers;
    const after = rewriteCodexToml(before, cmd);
    if (!isDeepStrictEqual(parseToml(after, { integersAsBigInt: true }), expected)) {
      throw new ConfigError("This TOML layout cannot be edited safely. Edit the OpenCrease entry by hand.");
    }
    return after;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("The Codex config is invalid or uses a layout OpenCrease cannot edit safely. Edit it by hand.");
  }
}

// ------------------------------------------------------------------------------------- diff

/** Changed region between two texts with `context` lines around it. Linear time: one edit region. */
export function lineDiff(before: string, after: string, context = 3): AgentConfigDiffLine[] {
  const a = before.length ? before.replace(/\r?\n$/, "").split(/\r?\n/) : [];
  const b = after.length ? after.replace(/\r?\n$/, "").split(/\r?\n/) : [];
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  if (pre === a.length && pre === b.length) return [];
  const out: AgentConfigDiffLine[] = [];
  const from = Math.max(0, pre - context);
  if (from > 0) out.push({ kind: "skip", text: `${from} unchanged ${from === 1 ? "line" : "lines"}` });
  for (let i = from; i < pre; i++) out.push({ kind: "context", text: a[i]! });
  for (let i = pre; i < a.length - suf; i++) out.push({ kind: "remove", text: a[i]! });
  for (let i = pre; i < b.length - suf; i++) out.push({ kind: "add", text: b[i]! });
  const tailEnd = Math.min(a.length, a.length - suf + context);
  for (let i = a.length - suf; i < tailEnd; i++) out.push({ kind: "context", text: a[i]! });
  const rest = a.length - tailEnd;
  if (rest > 0) out.push({ kind: "skip", text: `${rest} unchanged ${rest === 1 ? "line" : "lines"}` });
  return out;
}

// ------------------------------------------------------------------------------------- plans

export function editFor(client: AgentClientId, before: string | null, cmd: StdioCommand, path: string): string {
  if (client === "codex") return editCodexToml(before, cmd);
  return editJson(before, jsonTarget(client, cmd), basename(path));
}

interface Plan {
  client: AgentClientId;
  path: string;
  before: string | null;
  after: string;
  created: number;
  backupPath: string | null;
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

const PLAN_TTL_MS = 15 * 60_000;

/** Keeps previews until they are applied, so apply() writes exactly what the user saw. */
export class AgentConfigWriter {
  private plans = new Map<string, Plan>();
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private ctx: ConfigContext,
    private command: () => StdioCommand,
  ) {}

  async preview(client: AgentClientId): Promise<AgentConfigPreview> {
    const path = await configPath(client, this.ctx);
    const before = await readOrNull(path);
    const after = editFor(client, before, this.command(), path);
    const upToDate = before !== null && after === before;
    const planId = randomUUID();
    const now = Date.now();
    for (const [id, p] of this.plans) if (now - p.created > PLAN_TTL_MS) this.plans.delete(id);
    const backupPath = before === null || upToDate ? null : this.backupPath(path, planId);
    if (!upToDate) this.plans.set(planId, { client, path, before, after, created: now, backupPath });
    return {
      client,
      path,
      creates: before === null,
      upToDate,
      backupPath,
      diff: upToDate ? [] : lineDiff(before ?? "", after),
      planId,
      note: NOTES[client],
    };
  }

  private backupPath(path: string, planId: string): string {
    return join(dirname(path), `${basename(path)}.opencrease-backup-${stamp((this.ctx.now ?? (() => new Date()))())}-${planId}`);
  }

  apply(planId: string): Promise<AgentConfigApplyResult> {
    const result = this.writes.then(() => this.applyPlan(planId));
    this.writes = result.catch(() => {});
    return result;
  }

  private async applyPlan(planId: string): Promise<AgentConfigApplyResult> {
    const plan = this.plans.get(planId);
    if (!plan || Date.now() - plan.created > PLAN_TTL_MS) {
      this.plans.delete(planId);
      return { status: "error", message: "This preview expired. Open it again." };
    }
    try {
      const current = await readOrNull(plan.path);
      if (current !== plan.before) {
        this.plans.delete(planId);
        return { status: "changed", preview: await this.preview(plan.client) };
      }
      let backupPath: string | null = null;
      let mode = 0o600;
      if (current !== null) {
        mode = (await stat(plan.path)).mode & 0o777;
        backupPath = plan.backupPath!;
        await copyFile(plan.path, backupPath, constants.COPYFILE_EXCL);
      } else {
        await mkdir(dirname(plan.path), { recursive: true, mode: 0o700 });
      }
      const tmp = join(dirname(plan.path), `.${basename(plan.path)}.opencrease-${process.pid}-${Date.now()}.tmp`);
      try {
        await writeFile(tmp, plan.after, { encoding: "utf8", mode });
        await rename(tmp, plan.path);
      } catch (err) {
        await unlink(tmp).catch(() => {});
        throw err;
      }
      this.plans.delete(planId);
      return { status: "written", path: plan.path, backupPath };
    } catch (err) {
      return { status: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }
}
