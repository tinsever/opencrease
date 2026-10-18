import { mkdtemp, readdir, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentConfigWriter, configPath, editCodexToml, editJson, lineDiff, type ConfigContext, type StdioCommand } from "./agent-config";

const CMD: StdioCommand = { command: "/Apps/OpenCrease/bin/opencrease", args: ["mcp"] };

let home: string;
let ctx: ConfigContext;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "of-agent-config-"));
  ctx = { home, platform: "darwin", env: {}, now: () => new Date(2026, 9, 18, 9, 5, 7) };
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(home, { recursive: true, force: true });
});

describe("configPath", () => {
  it("resolves per client and platform", async () => {
    expect(await configPath("claude-code", ctx)).toBe(join(home, ".claude.json"));
    expect(await configPath("codex", ctx)).toBe(join(home, ".codex", "config.toml"));
    expect(await configPath("cursor", ctx)).toBe(join(home, ".cursor", "mcp.json"));
    expect(await configPath("vscode", ctx)).toBe(join(home, "Library", "Application Support", "Code", "User", "mcp.json"));
    expect(await configPath("vscode", { ...ctx, platform: "linux" })).toBe(join(home, ".config", "Code", "User", "mcp.json"));
    expect(await configPath("zed", ctx)).toBe(join(home, ".config", "zed", "settings.json"));
    expect(await configPath("opencode", ctx)).toBe(join(home, ".config", "opencode", "opencode.json"));
    expect(await configPath("codex", { ...ctx, env: { CODEX_HOME: "/x" } })).toBe(join("/x", "config.toml"));
  });

  it("prefers an existing opencode.jsonc", async () => {
    await mkdir(join(home, ".config", "opencode"), { recursive: true });
    await writeFile(join(home, ".config", "opencode", "opencode.jsonc"), "{}");
    expect(await configPath("opencode", ctx)).toBe(join(home, ".config", "opencode", "opencode.jsonc"));
  });
});

describe("editJson", () => {
  const target = { path: ["mcpServers", "opencrease"], value: { command: "a", args: ["mcp"] } };

  it("keeps comments, other keys and indentation", () => {
    const before = '{\n    // my servers\n    "mcpServers": {\n        "other": { "command": "x" }\n    },\n    "theme": "dark"\n}\n';
    const after = editJson(before, target, "mcp.json");
    expect(after).toContain("// my servers");
    expect(after).toContain('"other": { "command": "x" }');
    expect(after).toContain('"theme": "dark"');
    expect(after).toMatch(/\n {8}"opencrease": \{/);
    expect(after.endsWith("\n")).toBe(true);
  });

  it("creates the parents in an empty file and seeds new files", () => {
    expect(JSON.parse(editJson(null, target, "mcp.json"))).toEqual({ mcpServers: { opencrease: { command: "a", args: ["mcp"] } } });
    const seeded = JSON.parse(editJson(null, { ...target, path: ["mcp", "opencrease"], seed: { $schema: "s" } }, "opencode.json"));
    expect(seeded).toEqual({ $schema: "s", mcp: { opencrease: { command: "a", args: ["mcp"] } } });
  });

  it("adds a missing parent to an existing file without reformatting it", () => {
    const before = '{\n  "numStartups": 4,\n  "tips": {"a": 1}\n}\n';
    expect(editJson(before, target, ".claude.json")).toBe(
      '{\n  "numStartups": 4,\n  "tips": {"a": 1},\n  "mcpServers": {\n    "opencrease": {\n      "command": "a",\n      "args": [\n        "mcp"\n      ]\n    }\n  }\n}\n',
    );
  });

  it("replaces an outdated entry and leaves an identical one alone", () => {
    const old = JSON.stringify({ mcpServers: { opencrease: { command: "old" } } }, null, 2);
    expect(JSON.parse(editJson(old, target, "mcp.json")).mcpServers.opencrease).toEqual(target.value);
    const same = JSON.stringify({ mcpServers: { opencrease: { args: ["mcp"], command: "a" } } }, null, 2);
    expect(editJson(same, target, "mcp.json")).toBe(same);
  });

  it("refuses broken files and non-object parents", () => {
    expect(() => editJson("{ nope", target, "mcp.json")).toThrow(/not valid JSON/);
    expect(() => editJson('{"mcpServers": []}', target, "mcp.json")).toThrow(/not an object/);
  });
});

describe("editCodexToml", () => {
  it("appends a table to an existing file", () => {
    const before = 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n';
    expect(editCodexToml(before, CMD)).toBe(`${before}\n[mcp_servers.opencrease]\ncommand = "/Apps/OpenCrease/bin/opencrease"\nargs = ["mcp"]\n`);
  });

  it("replaces the old table and its sub-tables in place", () => {
    const before = [
      'model = "gpt-5"',
      "",
      "[mcp_servers.opencrease]",
      'command = "npx"',
      'args = ["opencrease", "mcp"]',
      "",
      "[mcp_servers.opencrease.env]",
      'A = "1"',
      "",
      "[profiles.fast]",
      'model = "x"',
      "",
    ].join("\n");
    const after = editCodexToml(before, { ...CMD, env: { OPENCREASE_X: "1" } });
    expect(after).toBe(
      [
        'model = "gpt-5"',
        "",
        "[mcp_servers.opencrease]",
        'command = "/Apps/OpenCrease/bin/opencrease"',
        'args = ["mcp"]',
        "",
        "[mcp_servers.opencrease.env]",
        'OPENCREASE_X = "1"',
        "",
        "[profiles.fast]",
        'model = "x"',
        "",
      ].join("\n"),
    );
    expect(editCodexToml(after, { ...CMD, env: { OPENCREASE_X: "1" } })).toBe(after);
  });

  it("escapes strings and refuses inline definitions", () => {
    expect(editCodexToml(null, { command: 'C:\\Apps\\"x"', args: [] })).toContain('command = "C:\\\\Apps\\\\\\"x\\""');
    expect(() => editCodexToml('[mcp_servers]\nopencrease = { command = "x" }\n', CMD)).toThrow(/inline/);
  });
});

describe("Codex config preservation", () => {
  it("refuses invalid TOML and unsafe inline layouts", () => {
    expect(() => editCodexToml('model = "unfinished', CMD)).toThrow(/invalid/);
    expect(() => editCodexToml('mcp_servers = { opencrease = { command = "x" } }', CMD)).toThrow();
  });

  it("does not rewrite table-like text inside multiline instructions", () => {
    const before = 'instructions = """\n[mcp_servers.opencrease]\ncommand = "leave this text alone"\n"""\n';
    expect(() => editCodexToml(before, CMD)).toThrow(/safely/);
  });
});

describe("lineDiff", () => {
  it("shows the changed region with context and skips the rest", () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const b = a.replace("l10", "L10\nnew");
    const d = lineDiff(a, b);
    expect(d[0]).toEqual({ kind: "skip", text: "7 unchanged lines" });
    expect(d.filter((l) => l.kind === "remove").map((l) => l.text)).toEqual(["l10"]);
    expect(d.filter((l) => l.kind === "add").map((l) => l.text)).toEqual(["L10", "new"]);
    expect(d[d.length - 1]).toEqual({ kind: "skip", text: "6 unchanged lines" });
    expect(lineDiff(a, a)).toEqual([]);
  });
});

describe("AgentConfigWriter", () => {
  it("previews, backs up and writes atomically, keeping the file mode", async () => {
    const path = join(home, ".claude.json");
    const before = JSON.stringify({ numStartups: 4, mcpServers: { other: { command: "x" } } }, null, 2);
    await writeFile(path, before, { mode: 0o600 });
    const w = new AgentConfigWriter(ctx, () => CMD);
    const p = await w.preview("claude-code");
    expect(p.creates).toBe(false);
    expect(p.upToDate).toBe(false);
    expect(p.backupPath).toBe(`${path}.opencrease-backup-20261018-090507-${p.planId}`);
    expect(p.diff.some((l) => l.kind === "add" && l.text.includes('"opencrease"'))).toBe(true);
    // nothing written by a preview
    expect(await readFile(path, "utf8")).toBe(before);

    const r = await w.apply(p.planId);
    expect(r).toEqual({ status: "written", path, backupPath: p.backupPath });
    expect(await readFile(p.backupPath!, "utf8")).toBe(before);
    const written = JSON.parse(await readFile(path, "utf8"));
    expect(written.numStartups).toBe(4);
    expect(written.mcpServers.other).toEqual({ command: "x" });
    expect(written.mcpServers.opencrease).toEqual({ type: "stdio", command: CMD.command, args: ["mcp"], env: {} });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await readdir(home)).filter((f) => f.endsWith(".tmp"))).toEqual([]);

    const again = await w.preview("claude-code");
    expect(again.upToDate).toBe(true);
    expect(again.diff).toEqual([]);
  });

  it("creates missing files with their folders and no backup", async () => {
    const w = new AgentConfigWriter(ctx, () => CMD);
    const p = await w.preview("zed");
    expect(p.creates).toBe(true);
    expect(p.backupPath).toBeNull();
    expect(await w.apply(p.planId)).toMatchObject({ status: "written", backupPath: null });
    const zed = JSON.parse(await readFile(join(home, ".config", "zed", "settings.json"), "utf8"));
    expect(zed.context_servers.opencrease).toEqual({ command: CMD.command, args: ["mcp"], env: {} });
  });

  it("asks again when the file changed after the preview", async () => {
    const path = join(home, ".cursor", "mcp.json");
    await mkdir(join(home, ".cursor"));
    await writeFile(path, "{}\n");
    const w = new AgentConfigWriter(ctx, () => CMD);
    const p = await w.preview("cursor");
    await writeFile(path, '{ "mcpServers": { "x": { "command": "y" } } }\n');
    const r = await w.apply(p.planId);
    expect(r.status).toBe("changed");
    expect(await readFile(path, "utf8")).toBe('{ "mcpServers": { "x": { "command": "y" } } }\n');
    if (r.status !== "changed") return;
    expect(await w.apply(r.preview.planId)).toMatchObject({ status: "written" });
    expect(JSON.parse(await readFile(path, "utf8")).mcpServers).toEqual({ x: { command: "y" }, opencrease: { command: CMD.command, args: ["mcp"] } });
    expect(await w.apply(p.planId)).toMatchObject({ status: "error" });
  });

  it("expires previews without requiring another preview first", async () => {
    vi.useFakeTimers();
    const w = new AgentConfigWriter(ctx, () => CMD);
    const p = await w.preview("cursor");
    vi.advanceTimersByTime(16 * 60_000);
    expect(await w.apply(p.planId)).toMatchObject({ status: "error" });
    expect(await readdir(home)).toEqual([]);
  });

  it("serializes simultaneous writes and preserves each backup", async () => {
    const path = join(home, ".claude.json");
    await writeFile(path, "{}\n");
    const w = new AgentConfigWriter(ctx, () => CMD);
    const first = await w.preview("claude-code");
    const second = await w.preview("claude-code");
    expect(first.backupPath).not.toBe(second.backupPath);
    const results = await Promise.all([w.apply(first.planId), w.apply(second.planId)]);
    expect(results[0]).toMatchObject({ status: "written" });
    expect(results[1]).toMatchObject({ status: "changed" });
    expect(await readFile(first.backupPath!, "utf8")).toBe("{}\n");
  });

  it("writes the Codex table and the OpenCode entry", async () => {
    const w = new AgentConfigWriter(ctx, () => CMD);
    await w.apply((await w.preview("codex")).planId);
    expect(await readFile(join(home, ".codex", "config.toml"), "utf8")).toContain("[mcp_servers.opencrease]");
    await w.apply((await w.preview("opencode")).planId);
    const oc = JSON.parse(await readFile(join(home, ".config", "opencode", "opencode.json"), "utf8"));
    expect(oc).toEqual({ $schema: "https://opencode.ai/config.json", mcp: { opencrease: { type: "local", command: [CMD.command, "mcp"], enabled: true } } });
    await w.apply((await w.preview("vscode")).planId);
    const vs = JSON.parse(await readFile(join(home, "Library", "Application Support", "Code", "User", "mcp.json"), "utf8"));
    expect(vs.servers.opencrease).toEqual({ type: "stdio", command: CMD.command, args: ["mcp"] });
  });
});
