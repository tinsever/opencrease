import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { textResult, type AgentStreamEvent, type AiSettingsView, type ToolResult } from "@opencrease/protocol";
import { FakeEditor, startTestServer, type TestServer } from "../test-utils";
import { fakePng, startFakeProvider, type FakeProvider } from "./testing/fake-provider";

const send = (method: string, body: unknown) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function readSse(res: Response): Promise<AgentStreamEvent[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)) as AgentStreamEvent);
}

describe("AI routes", () => {
  let s: TestServer;
  let fake: FakeProvider;
  const api = (path: string, init?: RequestInit) => fetch(`${s.url}${path}`, init);
  const json = async <T = any>(path: string, init?: RequestInit): Promise<T> => {
    const res = await api(path, init);
    const body = await res.json();
    expect(res.ok, `${init?.method ?? "GET"} ${path} -> ${res.status} ${JSON.stringify(body)}`).toBe(true);
    return body as T;
  };

  beforeEach(async () => {
    s = await startTestServer();
    fake = await startFakeProvider();
  });
  afterEach(async () => {
    await s.stop();
    await fake.close();
  });

  it("stores keys server-side with 0600 and only shows the last four characters", async () => {
    const created = await json("/api/ai/providers", send("POST", { kind: "openai", apiKey: "sk-live-secret-ABCD" }));
    expect(created).toMatchObject({ kind: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", imageModel: "gpt-image-1", hasKey: true, keyHint: "…ABCD" });
    expect(JSON.stringify(created)).not.toContain("secret");

    const settings = await json<AiSettingsView>("/api/ai");
    expect(JSON.stringify(settings)).not.toContain("sk-live");
    expect(settings.defaults).toEqual({ image: created.id, chat: created.id });

    const path = join(s.dir, "home", "secrets.json");
    expect(settings.secretsPath).toBe(path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).toContain("sk-live-secret-ABCD");

    // omitted key keeps it, null clears it
    expect(await json(`/api/ai/providers/${created.id}`, send("PATCH", { label: "Work" }))).toMatchObject({ label: "Work", keyHint: "…ABCD" });
    expect(await json(`/api/ai/providers/${created.id}`, send("PATCH", { apiKey: null }))).toMatchObject({ hasKey: false, keyHint: "" });

    const bad = await api("/api/ai/providers", send("POST", { kind: "openai-compatible" }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/needs a base URL/);
    expect((await api("/api/ai/providers", send("POST", { kind: "nope" }))).status).toBe(400);
  });

  it("keeps defaults consistent when providers come and go", async () => {
    const a = await json("/api/ai/providers", send("POST", { kind: "anthropic", apiKey: "k1" }));
    const g = await json("/api/ai/providers", send("POST", { kind: "gemini", apiKey: "k2" }));
    const o = await json("/api/ai/providers", send("POST", { kind: "openai", apiKey: "k3" }));
    expect((await json<AiSettingsView>("/api/ai")).defaults).toEqual({ chat: a.id, image: g.id });
    expect(await json("/api/ai/defaults", send("PUT", { image: o.id }))).toEqual({ chat: a.id, image: o.id });
    expect((await api("/api/ai/defaults", send("PUT", { image: a.id }))).status).toBe(400);
    await json(`/api/ai/providers/${a.id}`, { method: "DELETE" });
    expect((await json<AiSettingsView>("/api/ai")).defaults).toEqual({ chat: o.id, image: o.id });
  });

  it("tests connections", async () => {
    const p = await json("/api/ai/providers", send("POST", { kind: "openai-compatible", baseUrl: `${fake.url}/v1` }));
    expect(await json(`/api/ai/providers/${p.id}/test`, { method: "POST" })).toMatchObject({ ok: true, models: ["claude-opus-5-5", "fake-chat", "fake-image"] });
    const down = await json("/api/ai/providers", send("POST", { kind: "comfyui", baseUrl: "http://127.0.0.1:9" }));
    expect(await json(`/api/ai/providers/${down.id}/test`, { method: "POST" })).toMatchObject({ ok: false, message: expect.stringMatching(/Could not reach ComfyUI/) });
  });

  it("generates images into the file's assets, and edits them", async () => {
    const file = await json("/api/files", send("POST", { name: "Gen" }));
    const none = await api("/api/ai/image", send("POST", { fileId: file.id, prompt: "vase" }));
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: string }).error).toBe("No image provider is configured. Add one in Settings, AI providers.");

    await json("/api/ai/providers", send("POST", { kind: "openai-compatible", baseUrl: `${fake.url}/v1`, imageModel: "fake-image" }));
    const out = await json("/api/ai/image", send("POST", { fileId: file.id, prompt: "Clay vase", width: 400, height: 300, seed: 3 }));
    expect(out).toMatchObject({ providerKind: "openai-compatible", model: "fake-image", asset: { mime: "image/png", width: 512, height: 512 } });
    expect(out.seed).toBeUndefined();
    expect(fake.requests.at(-1)!.body).toMatchObject({ model: "fake-image", prompt: "Clay vase", size: "1024x768", response_format: "b64_json" });
    const img = await api(`/api/files/${file.id}/assets/${out.asset.hash}`);
    expect(img.headers.get("content-type")).toBe("image/png");

    const edit = await json("/api/ai/image", send("POST", { fileId: file.id, prompt: "Make it blue", contextText: "Handmade ceramics", reference: `asset://${out.asset.hash}`, width: 400, height: 300 }));
    expect(edit.asset.hash).not.toBe(out.asset.hash);
    expect(fake.requests.at(-1)!).toMatchObject({ path: "/v1/images/edits", body: { multipart: true, prompt: expect.stringMatching(/^Make it blue\r?\n\r?\nCanvas text.*\r?\nHandmade ceramics$/), hasImage: true } });

    const failed = await api("/api/ai/image", send("POST", { fileId: file.id, prompt: "please fail" }));
    expect(failed.status).toBe(502);
    expect(((await failed.json()) as { error: string }).error).toMatch(/rejected by the fake safety system/);
  });

  it("generates SVG with a chat provider", async () => {
    const none = await api("/api/ai/svg", send("POST", { prompt: "a check mark" }));
    expect(none.status).toBe(400);
    await json("/api/ai/providers", send("POST", { kind: "anthropic", baseUrl: fake.url, apiKey: "sk-ant-x" }));
    const out = await json("/api/ai/svg", send("POST", { prompt: "a check mark", context: { name: "Card", html: "<div>hi</div>", width: 300, height: 200, image: { data: fakePng(2, 2, "c").toString("base64"), mimeType: "image/png" } } }));
    expect(out.svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    const req = fake.requests.find((r) => r.path === "/v1/messages")!;
    expect(req.body.tools).toBeUndefined();
    const content = (req.body.messages as Array<{ content: Array<{ type: string; text?: string }> }>)[0]!.content;
    expect(content[0]!.type).toBe("image");
    expect(content[1]!.text).toContain('It goes into the frame "Card" (300x200)');
  });

  describe("in-app agent", () => {
    let editor: FakeEditor;
    let fileId: string;
    const handler = (tool: string, args: Record<string, unknown>): ToolResult => {
      const header = { file: { id: args.fileId, name: "Agent" }, contentHash: { tokens: "0" } };
      switch (tool) {
        case "get_basic_info":
          return textResult(header, { fileName: "Agent", artboards: [] });
        case "create_artboard":
          return textResult(header, { id: "A1-x", name: args.name, width: 480, height: 320 });
        case "write_html":
          return textResult(header, { createdNodes: [{ id: "B2-x", name: "Heading" }] });
        case "get_screenshot":
          return { content: [{ type: "text", text: JSON.stringify(header) }, { type: "image", data: fakePng(4, 4, "s").toString("base64"), mimeType: "image/png" }] };
        default:
          return textResult(header, { ok: true });
      }
    };

    beforeEach(async () => {
      fileId = (await json("/api/files", send("POST", { name: "Agent" }))).id;
      editor = await new FakeEditor(s.url, (tool, args) => handler(tool, args), [{ id: fileId, name: "Agent", activePageId: "p-1-0" }]).connect();
    });
    afterEach(() => editor.close());

    it("refuses honestly without a provider", async () => {
      const res = await api(`/api/ai/agent/${fileId}`, send("POST", { text: "Hi" }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("No agent provider is configured. Add an Anthropic or OpenAI-compatible provider in Settings, AI providers.");
    });

    for (const kind of ["anthropic", "openai-compatible"] as const) {
      it(`runs the tool loop with ${kind}, streams events and keeps the conversation per file`, async () => {
        const p = await json("/api/ai/providers", send("POST", kind === "anthropic" ? { kind, baseUrl: fake.url, apiKey: "sk-ant-x" } : { kind, baseUrl: `${fake.url}/v1`, chatModel: "fake-chat" }));
        const res = await api(`/api/ai/agent/${fileId}`, send("POST", { text: "Make a card", providerId: p.id, selection: [{ id: "1-a", name: "Hero", type: "Frame" }], pageId: "p-1-0" }));
        expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
        const events = await readSse(res);
        const done = events.at(-1)!;
        expect(done.type).toBe("done");
        const turn = (done as Extract<AgentStreamEvent, { type: "done" }>).turn;
        expect(turn.client).toBe(kind === "anthropic" ? "claude-in-app" : "opencrease-agent");
        expect(turn.model).toBe(kind === "anthropic" ? "claude-opus-5-5" : "fake-chat");
        const steps = turn.parts!.flatMap((x) => (x.type === "steps" ? x.steps : []));
        expect(steps.map((x) => [x.tool, x.status, x.label])).toEqual([
          ["get_basic_info", "ok", ""],
          ["create_artboard", "ok", "Agent card"],
          ["write_html", "ok", "Heading"],
          ["get_screenshot", "ok", "Agent card"],
          ["finish_working_on_nodes", "ok", ""],
        ]);
        expect(steps[3]!.image).toBe(true);
        const text = turn.parts!.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join("|");
        expect(text).toContain("Brief: mood is mineral");
        expect(text).toContain("Done. I added");
        expect(events.filter((e) => e.type === "text").length).toBeGreaterThan(3);

        // tools ran through the server's executor and the bridge, attributed to the in-app agent, with the fileId filled in
        expect(editor.calls.map((c) => c.tool)).toEqual(["get_basic_info", "create_artboard", "write_html", "get_screenshot", "finish_working_on_nodes"]);
        expect(editor.calls.every((c) => c.args.fileId === fileId && c.client.name === turn.client)).toBe(true);

        // the design guide is the system context; the selection rides along with the message
        const modelCalls = fake.requests.filter((r) => r.path.endsWith("/messages") || r.path.endsWith("/chat/completions"));
        expect(modelCalls).toHaveLength(6);
        const first = modelCalls[0]!.body;
        const system = kind === "anthropic" ? JSON.stringify(first.system) : String((first.messages as Array<{ content: string }>)[0]!.content);
        expect(system).toContain("<design-guide>");
        expect(system).toContain(`The file is \\"Agent\\" (fileId \\"${fileId}\\")`.replace(/\\"/g, kind === "anthropic" ? '\\"' : '"'));
        expect(system).toContain("Brief first");
        expect(JSON.stringify(first.messages)).toContain('The user has selected: \\"Hero\\" (Frame, id 1-a)');
        expect((first.tools as unknown[]).length).toBeGreaterThan(25);
        // the screenshot went back to the model as an image
        const last = JSON.stringify(modelCalls[5]!.body.messages);
        expect(last).toContain(kind === "anthropic" ? '"type":"image"' : '"type":"image_url"');

        const view = await json(`/api/ai/agent/${fileId}`);
        expect(view.running).toBe(false);
        expect(view.turns.map((t: { role: string }) => t.role)).toEqual(["user", "assistant"]);
        expect(view.turns[0].selection).toEqual([{ id: "1-a", name: "Hero", type: "Frame" }]);

        // second message continues the same conversation
        const again = await readSse(await api(`/api/ai/agent/${fileId}`, send("POST", { text: "say Thanks!", providerId: p.id })));
        expect(again.at(-1)).toMatchObject({ type: "done", turn: { parts: [{ type: "text", text: "Thanks!" }] } });
        expect((await json(`/api/ai/agent/${fileId}`)).turns).toHaveLength(4);
        await json(`/api/ai/agent/${fileId}`, { method: "DELETE" });
        expect((await json(`/api/ai/agent/${fileId}`)).turns).toHaveLength(0);
      });
    }

    it("stops when the client disconnects", async () => {
      await fake.close();
      fake = await startFakeProvider({ chunkDelayMs: 40 });
      const p = await json("/api/ai/providers", send("POST", { kind: "anthropic", baseUrl: fake.url, apiKey: "sk-ant-x" }));
      const ctl = new AbortController();
      const res = await api(`/api/ai/agent/${fileId}`, { ...send("POST", { text: "Make a card", providerId: p.id }), signal: ctl.signal });
      const reader = res.body!.getReader();
      await reader.read();
      ctl.abort();
      const deadline = Date.now() + 3000;
      let view;
      do {
        await new Promise((r) => setTimeout(r, 50));
        view = await json(`/api/ai/agent/${fileId}`);
      } while (view.running && Date.now() < deadline);
      expect(view.running).toBe(false);
      expect(view.turns[1].stopped).toBe(true);
    });

    it("surfaces provider errors on the turn", async () => {
      const p = await json("/api/ai/providers", send("POST", { kind: "anthropic", baseUrl: fake.url, apiKey: "bad-key" }));
      const events = await readSse(await api(`/api/ai/agent/${fileId}`, send("POST", { text: "Hi", providerId: p.id })));
      expect(events.at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/Anthropic answered 401: invalid x-api-key/) });
    });
  });
});
