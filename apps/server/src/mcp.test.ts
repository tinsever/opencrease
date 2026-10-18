import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { imageBlock, textResult, TOOLS, type ToolResult } from "@opencrease/protocol";
import { BIN_PATH } from "./config";
import { FakeEditor, startTestServer, waitUntil, type TestServer } from "./test-utils";

const ALL_NAMES = TOOLS.map((t) => t.name).sort();

function text(result: unknown): string {
  const content = (result as ToolResult).content;
  const block = content[0];
  return block && block.type === "text" ? block.text : "";
}

const editorHandler = (tool: string, args: Record<string, unknown>, ed: FakeEditor): ToolResult => {
  const client = ed.calls.at(-1)?.client;
  if (tool === "get_screenshot") return { content: [{ type: "text", text: JSON.stringify({ client }) }, imageBlock("iVBORw0KGgo=", "image/png")] };
  return textResult({ tool, args, client });
};

describe("MCP over Streamable HTTP", () => {
  let s: TestServer;
  let client: Client;
  let editor: FakeEditor | undefined;

  beforeEach(async () => {
    s = await startTestServer();
    client = new Client({ name: "vitest-agent", version: "1.2.3" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`)));
  });
  afterEach(async () => {
    await client.close();
    await editor?.close();
    editor = undefined;
    await s.stop();
  });

  it("lists every tool with annotations and schemas", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_NAMES);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.get_screenshot!.annotations?.readOnlyHint).toBe(true);
    expect(byName.write_html!.annotations?.readOnlyHint).toBe(false);
    expect(byName.delete_nodes!.annotations?.destructiveHint).toBe(true);
    expect(byName.write_html!.inputSchema.required?.sort()).toEqual(["fileId", "html", "mode", "targetNodeId"]);
    expect(byName.get_basic_info!.inputSchema.required ?? []).toEqual([]);
    expect(client.getInstructions()).toMatch(/get_guide\(\{ topic: "craft" \}\)/);
    expect(client.getServerVersion()?.name).toBe("opencrease");
  });

  it("runs server-side tools", async () => {
    const created = JSON.parse(text(await client.callTool({ name: "create_file", arguments: { name: "From MCP" } })));
    expect(created.fileId).toMatch(/^[0-9A-Z]{26}$/);
    const listed = JSON.parse(text(await client.callTool({ name: "list_resources", arguments: {} })));
    expect(listed.resources).toEqual([expect.objectContaining({ id: created.fileId, name: "From MCP", type: "file" })]);
    const guide = text(await client.callTool({ name: "get_guide", arguments: { topic: "craft" } }));
    expect(guide).toMatch(/craft guide/i);
  });

  it("forwards editor tools to the connected editor with the MCP client name", async () => {
    const f = await s.workspace.create({ name: "Live" });
    editor = await new FakeEditor(s.url, editorHandler, [{ id: f.id, name: "Live", activePageId: "p-1-0" }]).connect();
    await waitUntil(() => s.bridge.connected);

    const r = (await client.callTool({ name: "get_screenshot", arguments: { fileId: f.id, nodeId: "A-0", scale: 2 } })) as ToolResult;
    expect(JSON.parse(text(r)).client).toEqual({ name: "vitest-agent", version: "1.2.3" });
    expect(r.content[1]).toEqual({ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" });
    expect(editor.calls[0]).toMatchObject({ tool: "get_screenshot", args: { fileId: f.id, nodeId: "A-0", scale: 2 } });
  });

  it("normalises raw MCP calls while keeping advertised schemas canonical", async () => {
    const f = await s.workspace.create({ name: "Aliases" });
    editor = await new FakeEditor(s.url, editorHandler, [{ id: f.id, name: "Aliases", activePageId: "p-1-0" }]).connect();
    await waitUntil(() => s.bridge.connected);
    const result = await client.callTool({ name: "update_styles", arguments: { nodeId: "A-0", styles: { width: 104 } } });
    expect(JSON.parse(text(result))).toMatchObject({ tool: "update_styles", args: { fileId: f.id, updates: [{ nodeIds: ["A-0"], styles: { width: 104 } }] } });
    expect(text(await client.callTool({ name: "get_guide", arguments: {} }))).toMatch(/craft guide/i);
    const invalid = await client.callTool({ name: "set_text_content", arguments: { nodeIds: ["a", "b"], text: "Hello" } });
    expect(invalid.isError).toBe(true);
    expect(text(invalid)).toMatch(/exactly one id/);
    expect(text(invalid)).toContain('Expected shape (example): {"fileId":"FILE_ID","updates":[{"nodeId":"NODE_ID","textContent":"Hello"}]}');
  });

  it("reports invalid arguments as tool errors", async () => {
    const r = (await client.callTool({ name: "write_html", arguments: { fileId: "x" } })) as ToolResult;
    expect(r.isError).toBe(true);
  });

  it("keeps sessions separate and rejects unknown session ids", async () => {
    const other = new Client({ name: "second-agent", version: "0.1" });
    await other.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`)));
    expect((await other.listTools()).tools.length).toBe(ALL_NAMES.length);
    await other.close();

    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-session-id": "nope" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(404);
    const noSession = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(noSession.status).toBe(400);
  });
});

describe("MCP over stdio (opencrease mcp)", () => {
  let s: TestServer;
  let client: Client;
  let editor: FakeEditor | undefined;

  beforeEach(async () => {
    s = await startTestServer();
    client = new Client({ name: "stdio-agent", version: "9.9" });
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env.OPENCREASE_NO_BROWSER = "1";
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [BIN_PATH, "mcp", "--port", String(s.port)], env, stderr: "pipe" }),
    );
  }, 30_000);
  afterEach(async () => {
    await client.close();
    await editor?.close();
    editor = undefined;
    await s.stop();
  });

  it("proxies tool calls to the running server", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_NAMES);
    const created = JSON.parse(text(await client.callTool({ name: "create_file", arguments: { name: "Over stdio" } })));
    expect((await s.workspace.find(created.fileId))?.name).toBe("Over stdio");

    editor = await new FakeEditor(s.url, editorHandler, [{ id: created.fileId, name: "Over stdio", activePageId: "p-1-0" }]).connect();
    await waitUntil(() => s.bridge.connected);
    const r = JSON.parse(text(await client.callTool({ name: "get_children", arguments: { fileId: created.fileId, nodeId: "root" } })));
    expect(r).toMatchObject({ tool: "get_children", client: { name: "stdio-agent", version: "9.9" } });
  }, 30_000);
});
