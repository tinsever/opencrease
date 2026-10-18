// Plugins (SPEC M4): JavaScript modules in ~/.opencrease/plugins that the editor runs in a sandboxed
// iframe. The server only lists them and serves their source; it never executes plugin code.
//
// A plugin is either
//   - a single file `<id>.js` (or .mjs) with header comments `// @name ...` and `// @description ...`, or
//   - a directory `<id>/` with `plugin.json` ({ "name", "description", "main": "index.js", "commands": [...] }).
// Built-in example plugins ship in apps/server/plugins and are listed first.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkspaceError } from "./workspace";

export const BUILTIN_PLUGINS_DIR = fileURLToPath(new URL("../plugins", import.meta.url));
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export interface PluginCommand {
  id: string;
  title: string;
}

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  version?: string;
  builtin: boolean;
  commands: PluginCommand[];
}

interface Located extends PluginInfo {
  main: string;
}

function headerTag(source: string, tag: string): string | undefined {
  const re = new RegExp(`^\\s*//\\s*@${tag}\\s+(.+)$`, "m");
  return re.exec(source.slice(0, 4000))?.[1]?.trim();
}

function parseCommands(raw: unknown): PluginCommand[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is { id: unknown; title: unknown } => !!c && typeof c === "object")
    .map((c) => ({ id: String(c.id ?? ""), title: String(c.title ?? "") }))
    .filter((c) => ID_RE.test(c.id) && c.title);
}

export class Plugins {
  constructor(
    readonly dir: string,
    private builtinDir: string = BUILTIN_PLUGINS_DIR,
  ) {}

  private async scan(dir: string, builtin: boolean): Promise<Located[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: Located[] = [];
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith(".")) continue;
      try {
        if (e.isFile() && /\.(m?js)$/.test(e.name)) {
          const id = e.name.replace(/\.(m?js)$/, "");
          if (!ID_RE.test(id)) continue;
          const main = join(dir, e.name);
          const source = await readFile(main, "utf8");
          const commandsTag = headerTag(source, "commands");
          out.push({
            id,
            name: headerTag(source, "name") ?? id,
            description: headerTag(source, "description") ?? "",
            builtin,
            commands: commandsTag ? parseCommands(JSON.parse(commandsTag)) : [],
            main,
          });
        } else if (e.isDirectory() && ID_RE.test(e.name)) {
          const manifest = JSON.parse(await readFile(join(dir, e.name, "plugin.json"), "utf8")) as Record<string, unknown>;
          const mainName = typeof manifest.main === "string" ? manifest.main : "index.js";
          if (mainName.includes("..") || mainName.startsWith("/")) continue;
          const info: Located = {
            id: e.name,
            name: typeof manifest.name === "string" && manifest.name ? manifest.name : e.name,
            description: typeof manifest.description === "string" ? manifest.description : "",
            builtin,
            commands: parseCommands(manifest.commands),
            main: join(dir, e.name, mainName),
          };
          if (typeof manifest.version === "string") info.version = manifest.version;
          out.push(info);
        }
      } catch {
        // skip unreadable or malformed plugins
      }
    }
    return out;
  }

  private async all(): Promise<Located[]> {
    const builtin = await this.scan(this.builtinDir, true);
    const user = await this.scan(this.dir, false);
    const ids = new Set(user.map((p) => p.id));
    // a user plugin with the same id replaces the example
    return [...builtin.filter((p) => !ids.has(p.id)), ...user];
  }

  async list(): Promise<PluginInfo[]> {
    return (await this.all()).map(({ main: _main, ...info }) => info);
  }

  async source(id: string): Promise<string> {
    const plugin = (await this.all()).find((p) => p.id === id);
    if (!plugin) throw new WorkspaceError(`No plugin "${id}"`, 404);
    const info = await stat(plugin.main);
    if (info.size > MAX_SOURCE_BYTES) throw new WorkspaceError("Plugin source is larger than 2 MB", 413);
    return readFile(plugin.main, "utf8");
  }
}
