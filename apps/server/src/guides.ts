// Layered design guide: built-in (shipped), user (~/.opencrease/guide.md), file (<file>.fold/guide.md).
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { effectiveRequiredSteps, type RequiredStep } from "@opencrease/protocol";
import { BUILTIN_GUIDES_DIR, userConfigDir } from "./config";
import { atomicWrite, WorkspaceError, type Workspace } from "./workspace";

export type GuideLayerId = "builtin" | "user" | "file";

export interface GuideLayer {
  id: GuideLayerId;
  label: string;
  path: string;
  content: string;
  editable: boolean;
}

/** Topics that return the layered craft guide. */
const CRAFT_ALIASES = new Set(["craft", "mcp-instructions", "paper-mcp-instructions", "opencrease-mcp-instructions"]);

export interface GuidesOptions {
  workspace: Workspace;
  builtinDir?: string;
  userDir?: string;
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

export class Guides {
  readonly builtinDir: string;
  readonly userDir: string;
  private workspace: Workspace;

  constructor(opts: GuidesOptions) {
    this.workspace = opts.workspace;
    this.builtinDir = opts.builtinDir ?? BUILTIN_GUIDES_DIR;
    this.userDir = opts.userDir ?? userConfigDir();
  }

  get userGuidePath(): string {
    return join(this.userDir, "guide.md");
  }

  get builtinCraftPath(): string {
    return join(this.builtinDir, "craft.md");
  }

  /** The layers that make up the craft guide. The file layer is included when fileId is given. */
  async layers(fileId?: string | null): Promise<GuideLayer[]> {
    const layers: GuideLayer[] = [
      { id: "builtin", label: "Built-in guide", path: this.builtinCraftPath, content: await readText(this.builtinCraftPath), editable: false },
      { id: "user", label: "Your guide", path: this.userGuidePath, content: await readText(this.userGuidePath), editable: true },
    ];
    if (fileId) {
      const entry = await this.workspace.find(fileId);
      if (entry) {
        const path = join(entry.path, "guide.md");
        layers.push({ id: "file", label: `Guide for "${entry.name}"`, path, content: await readText(path), editable: true });
      }
    }
    return layers;
  }

  /** Merge layers in order; later layers take precedence over earlier ones. */
  static merge(layers: GuideLayer[]): string {
    const parts: string[] = [];
    for (const layer of layers) {
      const text = layer.content.trim();
      if (!text) continue;
      if (layer.id === "builtin") parts.push(text);
      else if (layer.id === "user")
        parts.push(`# The user's own guide\n\nThese rules come from the user and take precedence over the guide above.\n\n${text}`);
      else
        parts.push(`# Guide for this file\n\nThese rules are specific to the current file and take precedence over everything above.\n\n${text}`);
    }
    return parts.join("\n\n---\n\n");
  }

  /** Required steps in force for a file: the last guide layer with a "## Required steps" list wins. */
  async requiredSteps(fileId?: string | null): Promise<RequiredStep[]> {
    return effectiveRequiredSteps((await this.layers(fileId)).map((l) => l.content));
  }

  async craft(fileId?: string | null): Promise<{ layers: GuideLayer[]; merged: string }> {
    const layers = await this.layers(fileId);
    return { layers, merged: Guides.merge(layers) };
  }

  /** Built-in topics other than craft (guides/<topic>.md). */
  async extraTopics(): Promise<string[]> {
    try {
      return (await readdir(this.builtinDir))
        .filter((f) => f.endsWith(".md") && f !== "craft.md")
        .map((f) => f.slice(0, -3))
        .sort();
    } catch {
      return [];
    }
  }

  async topics(): Promise<string[]> {
    return ["craft", ...(await this.extraTopics())];
  }

  /** Resolve a get_guide topic. Returns null for unknown topics. */
  async topic(topic: string, activeFileId?: string | null): Promise<string | null> {
    const t = topic.trim().toLowerCase();
    if (CRAFT_ALIASES.has(t)) return (await this.craft(activeFileId)).merged;
    if (!/^[a-z0-9-]+$/.test(t)) return null;
    if (!(await this.extraTopics()).includes(t)) return null;
    return readText(join(this.builtinDir, `${t}.md`));
  }

  async write(layer: string, content: string, fileId?: string | null): Promise<GuideLayer> {
    if (layer === "builtin") throw new WorkspaceError("The built-in guide is read-only", 403);
    if (layer === "user") {
      await mkdir(this.userDir, { recursive: true });
      if (content.trim()) await atomicWrite(this.userGuidePath, content);
      else await rm(this.userGuidePath, { force: true });
      return { id: "user", label: "Your guide", path: this.userGuidePath, content, editable: true };
    }
    if (layer === "file") {
      if (!fileId) throw new WorkspaceError("fileId is required for the file guide");
      await this.workspace.writeGuide(fileId, content);
      const entry = await this.workspace.require(fileId);
      return { id: "file", label: `Guide for "${entry.name}"`, path: join(entry.path, "guide.md"), content, editable: true };
    }
    throw new WorkspaceError(`Unknown guide layer "${layer}"`, 404);
  }
}
