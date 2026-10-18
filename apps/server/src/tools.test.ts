import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { errorResult, textResult } from "@opencrease/protocol";
import { FakeEditor, firstText, startTestServer, waitUntil, type TestServer } from "./test-utils";
import { parseFileRef } from "./tools";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("tool routing", () => {
  let s: TestServer;
  let editors: FakeEditor[];
  const editor = async (...args: ConstructorParameters<typeof FakeEditor> extends [unknown, ...infer R] ? R : never) => {
    const id = `editor-${editors.length}`;
    const e = await new FakeEditor(s.url, ...args).connect(id);
    editors.push(e);
    await waitUntil(() => s.bridge.activeEditor?.editorId === id);
    return e;
  };

  beforeEach(async () => {
    s = await startTestServer();
    editors = [];
  });
  afterEach(async () => {
    await Promise.all(editors.map((e) => e.close()));
    await s.stop();
  });

  it("validates arguments before routing", async () => {
    const r = await s.callTool("write_html", { fileId: "x", mode: "nope" });
    expect(r.isError).toBe(true);
    expect(firstText(r)).toMatch(/targetNodeId/);
    expect(firstText(r)).toMatch(/mode/);
    expect((await s.callTool("does_not_exist", {})).isError).toBe(true);
  });

  it("lists resources with open and active flags", async () => {
    const a = await s.workspace.create({ name: "Alpha" });
    await new Promise((r) => setTimeout(r, 20));
    const b = await s.workspace.create({ name: "Beta" });
    let data = JSON.parse(firstText(await s.callTool("list_resources", {})));
    expect(data.resources.map((r: { name: string }) => r.name)).toEqual(["Beta", "Alpha"]);
    expect(data.resources[0]).toMatchObject({ id: b.id, type: "file", folder: "", open: false, active: false });
    expect(typeof data.resources[0].updatedAt).toBe("string");

    await editor(undefined, [{ id: a.id, name: "Alpha", activePageId: "p-1-0" }]);
    data = JSON.parse(firstText(await s.callTool("list_resources", { limit: 1 })));
    expect(data.resources).toEqual([expect.objectContaining({ id: a.id, open: true, active: true })]);
    expect(data.truncated).toBe(true);
  });

  it("creates, renames and opens files", async () => {
    const created = JSON.parse(firstText(await s.callTool("create_file", { name: "New one" })));
    expect(created).toMatchObject({ name: "New one", url: `${s.url}/file/${created.fileId}` });

    const renamed = JSON.parse(firstText(await s.callTool("rename_resource", { resourceId: created.fileId, name: "Better name" })));
    expect(renamed).toEqual({ id: created.fileId, name: "Better name", type: "file" });
    expect((await s.callTool("rename_resource", { name: "x" })).isError).toBe(true);

    const ed = await editor((tool, args) => textResult({ tool, args }));
    const opened = await s.callTool("open_file", { fileId: `${s.url}/file/${created.fileId}/p-9-0` }, { name: "claude-code", version: "1.0" });
    expect(ed.messages.find((m) => m.type === "open-file")).toEqual({ type: "open-file", fileId: created.fileId, pageId: "p-9-0" });
    expect(JSON.parse(firstText(opened))).toEqual({ tool: "get_basic_info", args: { fileId: created.fileId, pageId: "p-9-0" } });
    expect(ed.calls[0]!.client).toEqual({ name: "claude-code", version: "1.0" });
    expect((await s.callTool("open_file", { fileId: "NOPE" })).isError).toBe(true);
  });

  it("forwards editor tools with normalised args and returns the editor's result", async () => {
    const f = await s.workspace.create({ name: "Doc" });
    const ed = await editor((tool, args) => (tool === "delete_nodes" ? errorResult("locked") : textResult({ tool, args })), [
      { id: f.id, name: "Doc", activePageId: "p-1-0" },
    ]);

    const r = await s.callTool("get_tree_summary", { fileId: f.id, nodeId: "root_p-1-0", depth: 99 });
    expect(JSON.parse(firstText(r))).toEqual({ tool: "get_tree_summary", args: { fileId: f.id, nodeId: "root_p-1-0", depth: 10 } });

    const st = await s.callTool("set_tokens", { fileId: f.id, tokens: [{ name: "--a", delete: true }] });
    expect(JSON.parse(firstText(st)).args).toEqual({ fileId: f.id, updates: [], deletes: ["--a"] });

    const del = await s.callTool("delete_nodes", { fileId: f.id, nodeIds: ["A-0"] });
    expect(del).toEqual(errorResult("locked"));

    const noFile = await s.callTool("get_basic_info", {});
    expect(JSON.parse(firstText(noFile)).args).toEqual({});
    expect(ed.calls).toHaveLength(4);

    const unknown = await s.callTool("get_children", { fileId: "UNKNOWN", nodeId: "x" });
    expect(firstText(unknown)).toMatch(/list_resources/);
  });

  it("asks the editor to open a file that is not open yet", async () => {
    const f = await s.workspace.create({ name: "Closed" });
    const ed = await editor();
    await s.callTool("get_node_info", { fileId: f.id, nodeId: "A-0" });
    expect(ed.messages[0]).toEqual({ type: "open-file", fileId: f.id });
    expect(ed.calls[0]!.tool).toBe("get_node_info");
  });

  it("routes to the editor that has the file open, else the active editor", async () => {
    const a = await s.workspace.create({ name: "A" });
    const b = await s.workspace.create({ name: "B" });
    const ea = await editor(undefined, [{ id: a.id, name: "A", activePageId: "p" }]);
    const eb = await editor(undefined, [{ id: b.id, name: "B", activePageId: "p" }]);
    expect(s.bridge.activeEditor?.editorId).toBe("editor-1");
    await s.callTool("get_selection", { fileId: a.id });
    await s.callTool("get_selection", {});
    expect(ea.calls.map((c) => c.tool)).toEqual(["get_selection"]);
    expect(eb.calls.map((c) => c.tool)).toEqual(["get_selection"]);

    ea.send({ type: "state", openFiles: ea.openFiles, activeFileId: a.id });
    await waitUntil(() => s.bridge.activeEditor?.editorId === "editor-0");
    await eb.close();
    await waitUntil(() => s.bridge.editorCount === 1);
    expect(s.bridge.connected).toBe(true);
  });

  it("opens the browser and fails clearly when no editor connects", async () => {
    const f = await s.workspace.create({ name: "Lonely" });
    const r = await s.callTool("get_basic_info", { fileId: f.id });
    expect(r.isError).toBe(true);
    expect(firstText(r)).toMatch(/No OpenCrease editor is connected/);
    expect(s.opened).toEqual([`${s.url}/file/${f.id}`]);
  });

  it("waits for an editor that connects after the call", async () => {
    const f = await s.workspace.create({ name: "Late" });
    const pending = s.callTool("get_basic_info", { fileId: f.id });
    await waitUntil(() => s.opened.length === 1);
    await editor(undefined, [{ id: f.id, name: "Late", activePageId: "p" }]);
    expect(JSON.parse(firstText(await pending)).tool).toBe("get_basic_info");
  });

  it("answers pending calls with an error when the editor disconnects", async () => {
    const f = await s.workspace.create({ name: "Bye" });
    const ed = await editor(() => new Promise(() => {}), [{ id: f.id, name: "Bye", activePageId: "p" }]);
    const pending = s.callTool("get_screenshot", { fileId: f.id, nodeId: "A-0" });
    await waitUntil(() => ed.calls.length === 1);
    await ed.close();
    const r = await pending;
    expect(r.isError).toBe(true);
    expect(firstText(r)).toMatch(/closed/);
  });

  it("imports local image paths as assets before forwarding write_html", async () => {
    const f = await s.workspace.create({ name: "Images" });
    const ed = await editor(undefined, [{ id: f.id, name: "Images", activePageId: "p" }]);
    const local = join(s.dir, "hero image.png");
    await writeFile(local, PNG);
    const html = `<img src="asset://${encodeURI(local)}"><img src="paper-asset://${local.replace(/ /g, "%20")}">`;
    await s.callTool("write_html", { fileId: f.id, targetNodeId: "A-0", mode: "insert-children", html });
    const forwarded = String(ed.calls[0]!.args.html);
    expect(forwarded).toMatch(/^<img src="asset:\/\/[0-9a-f]{64}"><img src="asset:\/\/[0-9a-f]{64}">$/);
    const hash = /asset:\/\/([0-9a-f]{64})/.exec(forwarded)![1]!;
    expect(await s.workspace.readAsset(f.id, hash)).not.toBeNull();

    const missing = await s.callTool("update_styles", {
      fileId: f.id,
      updates: [{ nodeIds: ["A-0"], styles: { backgroundImage: "url(asset:///does/not/exist.png)" } }],
    });
    expect(missing.isError).toBe(true);
    expect(firstText(missing)).toMatch(/does\/not\/exist\.png/);
  });

  it("returns layered guides and lists topics for unknown ones", async () => {
    const f = await s.workspace.create({ name: "Guided" });
    await s.workspace.writeGuide(f.id, "Only use teal.");
    let text = firstText(await s.callTool("get_guide", { topic: "craft" }));
    expect(text).toMatch(/craft guide/i);
    expect(text).not.toMatch(/teal/);
    await editor(undefined, [{ id: f.id, name: "Guided", activePageId: "p" }]);
    text = firstText(await s.callTool("get_guide", { topic: "mcp-instructions" }));
    expect(text).toMatch(/Only use teal/);
    const unknown = await s.callTool("get_guide", { topic: "nope" });
    expect(unknown.isError).toBe(true);
    expect(firstText(unknown)).toMatch(/Available topics: "craft"/);
    expect(firstText(unknown)).toContain('Expected shape (example): {"topic":"craft"}');
    expect(firstText(await s.callTool("rename_resource", { name: "x" }))).toContain('Expected shape (example): {"id":"FILE_ID","name":"New name"}');
  });
});

describe("parseFileRef", () => {
  it("accepts ids, paths and URLs", () => {
    expect(parseFileRef("01ABC")).toEqual({ fileId: "01ABC" });
    expect(parseFileRef("/file/01ABC")).toEqual({ fileId: "01ABC" });
    expect(parseFileRef("http://127.0.0.1:29880/file/01ABC/p-2-0?x=1")).toEqual({ fileId: "01ABC", pageId: "p-2-0" });
  });
});
