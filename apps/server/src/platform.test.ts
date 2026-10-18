import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDocument } from "@opencrease/model";
import { REQUIRED_STEPS, textResult } from "@opencrease/protocol";
import { FakeEditor, firstText, startTestServer, waitUntil, type TestServer } from "./test-utils";

describe("agent permissions", () => {
  let s: TestServer;
  let ed: FakeEditor | undefined;
  afterEach(async () => {
    await ed?.close();
    ed = undefined;
    await s.stop();
  });

  it("asks the editor once per client and remembers the answer", async () => {
    s = await startTestServer({ approveAgents: true });
    ed = await new FakeEditor(s.url).connect();
    await waitUntil(() => s.bridge.connected);
    ed.permission = true;
    const r = await s.callTool("list_resources", {}, { name: "claude-code", version: "2.0" });
    expect(r.isError).toBeFalsy();
    expect(ed.messages.filter((m) => m.type === "permission-request")).toHaveLength(1);
    await s.callTool("list_resources", {}, { name: "claude-code" });
    expect(ed.messages.filter((m) => m.type === "permission-request")).toHaveLength(1);

    const stored = JSON.parse(await readFile(join(s.dir, "home", "agents.json"), "utf8"));
    expect(stored.clients["claude-code"]).toMatchObject({ decision: "allow", version: "2.0" });

    ed.permission = false;
    const denied = await s.callTool("list_resources", {}, { name: "sketchy-agent" });
    expect(denied.isError).toBe(true);
    expect(firstText(denied)).toMatch(/not allowed "sketchy-agent"/);

    // revoking makes the client ask again
    const list = await (await fetch(`${s.url}/api/agents`)).json() as { agents: Array<{ name: string }> };
    expect(list.agents.map((a: { name: string }) => a.name).sort()).toEqual(["claude-code", "sketchy-agent"]);
    expect((await fetch(`${s.url}/api/agents/claude-code`, { method: "DELETE" })).status).toBe(200);
    ed.permission = true;
    await s.callTool("list_resources", {}, { name: "claude-code" });
    expect(ed.messages.filter((m) => m.type === "permission-request")).toHaveLength(3);
  });

  it("shares one question between concurrent calls and reports a pending answer", async () => {
    s = await startTestServer({ approveAgents: true });
    ed = await new FakeEditor(s.url).connect();
    await waitUntil(() => s.bridge.connected);
    // unanswered: pending after the timeout
    const origAsk = s.bridge.requestPermission.bind(s.bridge);
    s.bridge.requestPermission = (c) => origAsk(c, 200);
    const [a, b] = await Promise.all([s.callTool("get_guide", { topic: "craft" }, { name: "slow" }), s.callTool("get_guide", { topic: "craft" }, { name: "slow" })]);
    expect(firstText(a)).toMatch(/nobody has answered/);
    expect(firstText(b)).toMatch(/nobody has answered/);
    expect(ed.messages.filter((m) => m.type === "permission-request")).toHaveLength(1);
  });
});

describe("required steps policy", () => {
  let s: TestServer;
  let ed: FakeEditor;
  afterEach(async () => {
    await ed.close();
    await s.stop();
  });

  it("sends the steps from the guide layers with every editor call", async () => {
    s = await startTestServer();
    const f = await s.workspace.create({ name: "Brand" });
    ed = await new FakeEditor(s.url, (tool) => textResult(tool), [{ id: f.id, name: "Brand", activePageId: "p-1-0" }]).connect();
    await waitUntil(() => s.bridge.connected);
    await s.callTool("get_selection", { fileId: f.id });
    expect(ed.calls.at(-1)!.policy).toEqual({ steps: [...REQUIRED_STEPS] });
    // the file layer switches the brief off
    await s.guides.write("file", "# Brand\n\n## Required steps\n- Screenshot and self-review each section\n", f.id);
    await s.callTool("get_selection", { fileId: f.id });
    expect(ed.calls.at(-1)!.policy).toEqual({ steps: ["review"] });
  });
});

describe("version history", () => {
  let s: TestServer;
  afterEach(() => s.stop());

  it("snapshots saves (throttled), names versions and serves them", async () => {
    let now = 1_000_000;
    s = await startTestServer({ history: { throttleMs: 60_000, now: () => now } });
    const f = await s.workspace.create({ name: "Hist" });
    const doc = await s.workspace.readDocument(f.id);
    const put = (d: unknown) => fetch(`${s.url}/api/files/${f.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(d) });
    const list = async () => ((await (await fetch(`${s.url}/api/files/${f.id}/versions`)).json()) as { versions: Array<{ version: number; name?: string; source: string }> }).versions as Array<{ version: number; name?: string; source: string }>;

    await put(doc);
    await waitUntil(() => true);
    await new Promise((r) => setTimeout(r, 50));
    expect((await list()).map((v) => v.version)).toEqual([1]);

    // within the throttle window: no new snapshot
    await put({ ...doc, name: "Hist 2" });
    await new Promise((r) => setTimeout(r, 50));
    expect(await list()).toHaveLength(1);

    now += 61_000;
    await put({ ...doc, name: "Hist 3" });
    await new Promise((r) => setTimeout(r, 50));
    expect((await list()).map((v) => v.version)).toEqual([1, 2]);

    // named version from the live document
    const live = { ...createDocument("Hist 3", { id: f.id }), tokens: [] };
    const named = await (await fetch(`${s.url}/api/files/${f.id}/versions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Before review", document: live }) })).json();
    expect(named).toMatchObject({ version: 3, name: "Before review", source: "user", created: true });
    const read = await (await fetch(`${s.url}/api/files/${f.id}/versions/3`)).json() as { name: string };
    expect(read.name).toBe("Hist 3");

    expect((await fetch(`${s.url}/api/files/${f.id}/versions/3`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Renamed" }) })).status).toBe(200);
    expect((await list()).at(-1)!.name).toBe("Renamed");
    expect((await fetch(`${s.url}/api/files/${f.id}/versions/3`, { method: "DELETE" })).status).toBe(200);
    expect((await fetch(`${s.url}/api/files/${f.id}/versions/3`)).status).toBe(404);
    // numbers are never reused
    const again = await (await fetch(`${s.url}/api/files/${f.id}/versions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) })).json();
    expect((again as { version: number }).version).toBe(4);

    // a cloned file starts without history
    const clone = await s.workspace.create({ cloneFileId: f.id });
    expect(((await (await fetch(`${s.url}/api/files/${clone.id}/versions`)).json()) as { versions: unknown[] }).versions).toEqual([]);
  });
});

describe("plugins", () => {
  let s: TestServer;
  afterEach(() => s.stop());

  it("lists the example plugin and serves its source", async () => {
    s = await startTestServer();
    const data = await (await fetch(`${s.url}/api/plugins`)).json() as { plugins: Array<{ id: string; commands: unknown[] }> };
    const example = data.plugins.find((p: { id: string }) => p.id === "rename-layers-sequentially");
    expect(example).toMatchObject({ builtin: true, name: "Rename layers sequentially" });
    expect(example!.commands.length).toBeGreaterThan(0);
    const src = await fetch(`${s.url}/api/plugins/rename-layers-sequentially/source`);
    expect(src.headers.get("content-type")).toMatch(/javascript/);
    expect(await src.text()).toMatch(/export default/);
    expect((await fetch(`${s.url}/api/plugins/..%2Fsecret/source`)).status).toBe(404);
  });
});
