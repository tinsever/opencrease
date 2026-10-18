// Record a finished output from the fixed prompt set, without requiring an embedded model/provider.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHeadless } from "../../apps/server/src/headless";
const [id, file] = process.argv.slice(2);
const prompts = JSON.parse(await readFile(new URL("./prompts.json", import.meta.url), "utf8")) as Array<{ id: string; prompt: string }>;
const prompt = prompts.find((p) => p.id === id);
if (!prompt || !file) throw new Error("Usage: pnpm exec tsx tests/quality/record.ts landing|dashboard|mobile|poster path.fold");
const home = await mkdtemp(join(tmpdir(), "opencrease-quality-"));
const previous = process.env.OPENCREASE_HOME;
process.env.OPENCREASE_HOME = home;
try {
  const session = await startHeadless({ file: resolve(file) });
  try {
    const out = resolve("test-results/quality", new Date().toISOString().replace(/[:.]/g, "-"), id);
    await mkdir(out, { recursive: true });
    const doc = await session.server.workspace.readDocument(session.fileId!);
    const boards = Object.values(doc.pages).flatMap((p) => doc.nodes[p.rootId].children);
    for (const nodeId of boards) {
      const result = await session.callTool("get_screenshot", { fileId: doc.id, nodeId, scale: 1 });
      const image = result.content.find((c) => c.type === "image");
      if (!image || image.type !== "image") throw new Error(JSON.stringify(result));
      await writeFile(join(out, `${nodeId}.png`), Buffer.from(image.data, "base64"));
    }
    await writeFile(join(out, "record.json"), JSON.stringify({ ...prompt, recordedAt: new Date().toISOString(), document: doc }, null, 2));
    console.log(out);
  } finally { await session.close(); }
} finally {
  if (previous === undefined) delete process.env.OPENCREASE_HOME; else process.env.OPENCREASE_HOME = previous;
  await rm(home, { recursive: true, force: true });
}
