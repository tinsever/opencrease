// Record actual calls against the hidden Chromium bridge, then replay the same sessions in vitest.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDocument, serializeFold } from "../../packages/model/src/index";
import { startHeadless } from "../../apps/server/src/headless";
import { bindResult, snapshot, substitute, type RecordedCall } from "./helpers";

const sessions: Array<{ name: string; prompt: string; calls: RecordedCall[] }> = [
  { name: "card-editing", prompt: "Build a small product card, revise its title, and duplicate its call to action.", calls: [
    { tool: "create_artboard", args: { name: "Product card", styles: { width: 360, height: 240, padding: 24, gap: 16 } }, bind: { board: "id" } },
    { tool: "write_html", args: { targetNodeId: "$board", mode: "insert-children", html: '<div layer-name="Title" style="font-size:28px;font-weight:700">Paper sketch</div><div layer-name="CTA" style="padding:12px;background:#ff5b14;color:#fff">Get started</div>' }, bind: { title: "createdNodes.0.id", cta: "createdNodes.1.id" } },
    { tool: "set_text_content", args: { updates: [{ nodeId: "$title", textContent: "OpenCrease sketch" }] } },
    { tool: "duplicate_nodes", args: { nodes: [{ id: "$cta" }] }, bind: { copy: "duplicatedNodes.0.id" } },
    { tool: "rename_nodes", args: { updates: [{ nodeId: "$copy", name: "Secondary CTA" }] } },
    { tool: "set_text_content", args: { updates: [{ nodeId: "$copy", textContent: "Learn more" }] } },
    { tool: "update_styles", args: { updates: [{ nodeIds: ["$copy"], styles: { background: "#eee", color: "#222", padding: "8px" } }] } },
  ] },
  { name: "tokens-and-pages", prompt: "Create a token-driven desktop screen and a mobile page, then rename the shared colour token.", calls: [
    { tool: "create_tokens", args: { tokens: [{ type: "color", name: "--color-brand", value: "#ff5b14" }, { type: "color", name: "--color-link", value: "var(--color-brand)" }] } },
    { tool: "create_artboard", args: { name: "Desktop", styles: { width: 800, height: 600, backgroundColor: "var(--color-brand)" } }, bind: { board: "id" } },
    { tool: "create_page", args: { name: "Mobile" }, bind: { mobile: "pageId" } },
    { tool: "create_artboard", args: { name: "Phone", pageId: "$mobile", styles: { width: 390, height: 844, backgroundColor: "var(--color-link)" } } },
    { tool: "set_tokens", args: { updates: [{ name: "--color-brand", newName: "--color-accent", value: "#ea5217" }] } },
    { tool: "update_pages", args: { updates: [{ pageId: "$mobile", name: "Phone designs" }] } },
  ] },
  { name: "restructure-layers", prompt: "Make two groups, move an item between them, replace a layer, and delete a duplicate.", calls: [
    { tool: "create_artboard", args: { name: "Groups", styles: { width: 600, height: 400 } }, bind: { board: "id" } },
    { tool: "write_html", args: { targetNodeId: "$board", mode: "insert-children", html: '<div layer-name="Left" style="display:flex;gap:8px"><div>A</div><div>B</div></div><div layer-name="Right" style="display:flex"></div>' }, bind: { left: "createdNodes.0.id", right: "createdNodes.1.id" } },
    { tool: "get_children", args: { nodeId: "$left" }, bind: { a: "children.0.id", b: "children.1.id" } },
    { tool: "move_nodes", args: { moves: [{ nodeId: "$b", parentId: "$right", index: 0 }] } },
    { tool: "write_html", args: { targetNodeId: "$a", mode: "replace", html: '<div layer-name="Replacement" style="color:#2255aa">Revised</div>' } },
    { tool: "duplicate_nodes", args: { nodes: [{ id: "$left" }] }, bind: { copy: "duplicatedNodes.0.id" } },
    { tool: "delete_nodes", args: { nodeIds: ["$copy"] } },
  ] },
];

for (const definition of sessions) {
  const temp = await mkdtemp(join(tmpdir(), "opencrease-record-"));
  const previousHome = process.env.OPENCREASE_HOME;
  process.env.OPENCREASE_HOME = join(temp, "home");
  try {
    const file = join(temp, "Session.fold");
    await mkdir(file);
    const out = serializeFold(createDocument("Conformance", { id: "recorded-session", clientId: "recorded", now: 0 }));
    await writeFile(join(file, "manifest.json"), JSON.stringify(out.manifest));
    await writeFile(join(file, "document.json"), out.documentJson);
    // This corpus predates required briefs and specifically tests the structural tools.
    await writeFile(join(file, "guide.md"), "## Required steps\n- Screenshot and self-review each section\n");
    const session = await startHeadless({ file });
    try {
      const bindings: Record<string, unknown> = {};
      for (const step of definition.calls) {
        const result = await session.callTool(step.tool, { fileId: session.fileId, ...substitute(step.args, bindings) as object });
        assert.ok(!result.isError, JSON.stringify(result));
        const body = JSON.parse((result.content[1] as { text: string }).text);
        bindResult(step.bind, body, bindings);
      }
      const expected = snapshot(await session.server.workspace.readDocument(session.fileId!));
      await writeFile(new URL(`${definition.name}.json`, import.meta.url), JSON.stringify({ ...definition, expected }, null, 2) + "\n");
      console.log(`Recorded ${definition.name}: ${definition.calls.length} live tool calls`);
    } finally { await session.close(); }
  } finally {
    if (previousHome === undefined) delete process.env.OPENCREASE_HOME; else process.env.OPENCREASE_HOME = previousHome;
    await rm(temp, { recursive: true, force: true });
  }
}
