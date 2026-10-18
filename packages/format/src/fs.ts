// Node-only directory I/O. Import the main entry point for browser-safe serialisation.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeDocument, parseFold, serializeFold } from "./format";
import { tokensToCss } from "./tokens";
import type { FoldDocument } from "./types";

export async function readFoldDirectory(path: string): Promise<FoldDocument> {
  return parseFold(await readFile(join(resolve(path), "document.json"), "utf8"));
}

/** Writes the supported unpacked .fold format. Existing assets and history are preserved. */
export async function writeFoldDirectory(path: string, document: FoldDocument): Promise<void> {
  const dir = resolve(path);
  if (!dir.endsWith(".fold")) throw new Error("A .fold directory path is required");
  const doc = normalizeDocument(document);
  const { manifest, documentJson } = serializeFold(doc);
  await mkdir(dir, { recursive: true });
  const atomic = async (name: string, data: string) => {
    const target = join(dir, name);
    const tmp = `${target}.${randomUUID()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, target);
  };
  await atomic("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  await atomic("tokens.css", tokensToCss(doc.tokens));
  await atomic("document.json", documentJson);
}
