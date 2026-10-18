import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getNode, themeToCss, themeToTailwind, tokensToDtcg, type ExportSetting, type FoldDocument } from "@opencrease/model";
import { startHeadless, readFold } from "./headless";
import { createMcpServer } from "./mcp";

export interface ExportArgs {
  command: "export" | "render" | "tokens" | "mcp";
  file: string;
  node?: string;
  format?: string;
  scale: string;
  output?: string;
  duration?: number;
  fps?: number;
}

export function parseExportArgs(argv: string[]): ExportArgs | null {
  const command = argv[0];
  if (!["export", "render", "tokens"].includes(command ?? "") && !(command === "mcp" && argv.includes("--headless"))) return null;
  if (argv.includes("--help") || argv.includes("-h")) return null;
  const out: ExportArgs = { command: command as ExportArgs["command"], file: "", scale: "2x" };
  let i = command === "tokens" && argv[1] === "export" ? 2 : 1;
  for (; i < argv.length; i++) {
    const raw = argv[i]!;
    if (raw === "--headless") continue;
    if (!raw.startsWith("-")) {
      if (out.file) throw new Error(`Unexpected argument: ${raw}`);
      out.file = raw;
      continue;
    }
    const [key, inline] = raw.split(/=(.*)/s);
    if (!["--file", "--node", "--format", "--scale", "-o", "--output", "--duration", "--fps"].includes(key!)) throw new Error(`Unknown option: ${key}`);
    const value = inline ?? argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    switch (key) {
      case "--file": out.file = value; break;
      case "--node": out.node = value; break;
      case "--format": out.format = value; break;
      case "--scale": out.scale = value; break;
      case "-o": case "--output": out.output = value; break;
      case "--duration": out.duration = Number(value); break;
      case "--fps": out.fps = Number(value); break;
    }
  }
  if (!out.file) throw new Error(`${command} requires a .fold directory (--file path.fold or a positional path).`);
  if (command === "tokens") {
    if (out.format && !["css", "tailwind", "json"].includes(out.format)) throw new Error("Token format must be css, tailwind or json.");
  } else {
    if (out.format && !["png", "jpg", "webp", "avif", "svg", "pdf", "mp4", "webm"].includes(out.format)) throw new Error(`Unknown export format: ${out.format}`);
    if (!/^\d+(?:\.\d+)?[xwhp]$/.test(out.scale) || parseFloat(out.scale) <= 0) throw new Error(`Invalid scale: ${out.scale}`);
    if (out.duration !== undefined && !(out.duration >= 1 && out.duration <= 300)) throw new Error("Duration must be between 1 and 300 seconds.");
    if (out.fps !== undefined && ![24, 30, 60].includes(out.fps)) throw new Error("FPS must be 24, 30 or 60.");
  }
  return out;
}

/** Exact names only, with ambiguity reported rather than silently exporting the wrong layer. */
export function resolveExportNodes(doc: FoldDocument, ref?: string): string[] {
  if (!ref) return doc.pageList.filter((p) => p.type === "page").flatMap((p) => doc.nodes[doc.pages[p.id]!.rootId]!.children).filter((id) => doc.nodes[id]?.visible);
  const id = getNode(doc, ref);
  if (id && id.type !== "Root") return [id.id];
  const matches = Object.values(doc.nodes).filter((n) => n.name === ref && n.type !== "Root");
  if (!matches.length) throw new Error(`No layer with id or name "${ref}".`);
  if (matches.length > 1) throw new Error(`More than one layer is named "${ref}". Use its node id.`);
  return [matches[0]!.id];
}

export async function runExportCommand(args: ExportArgs): Promise<void> {
  if (args.command === "tokens") {
    const doc = await readFold(args.file);
    // token modes become [data-mode] blocks (Tailwind: custom variants); json is W3C DTCG with modes in $extensions
    const text = args.format === "tailwind" ? themeToTailwind(doc) : args.format === "json" ? tokensToDtcg(doc) : themeToCss(doc);
    if (args.output) await writeFile(resolve(args.output), `${text}\n`);
    else process.stdout.write(`${text}\n`);
    return;
  }
  const session = await startHeadless({ file: args.file, exportDir: resolve(args.output ?? "out") });
  if (args.command === "mcp") {
    const server = createMcpServer(session.callTool);
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      await server.close();
      await session.close();
    };
    process.stdin.once("end", () => void close());
    process.once("SIGINT", () => void close());
    process.once("SIGTERM", () => void close());
    try { await server.connect(new StdioServerTransport()); }
    catch (err) { await close(); throw err; }
    return;
  }
  try {
    const doc = await session.server.workspace.readDocument(session.fileId!);
    const ids = resolveExportNodes(doc, args.node);
    if (!ids.length) throw new Error("No visible layers to export.");
    const format = (args.format ?? "png") as ExportSetting["format"];
    const setting: ExportSetting = { format, scale: args.scale };
    if (args.duration !== undefined) setting.durationSeconds = args.duration;
    if (args.fps !== undefined) setting.fps = args.fps;
    const result = await session.callTool("export", { fileId: doc.id, nodes: Object.fromEntries(ids.map((id) => [id, [setting]])), type: ["mp4", "webm"].includes(format) ? "video" : "image" });
    for (const block of result.content) if (block.type === "text") process.stdout.write(`${block.text}\n`);
    if (result.isError) throw new Error("Export failed.");
    for (const block of result.content) {
      if (block.type === "text" && (JSON.parse(block.text) as { errors?: unknown[] }).errors?.length) throw new Error("Some layers could not be exported.");
    }
  } finally { await session.close(); }
}
