import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentStreamEvent } from "@opencrease/protocol";
import { AgentRunner, type AgentDeps } from "./agent";
import type { ChatAdapter } from "./llm";
import type { StoredProvider } from "./secrets";

const provider: StoredProvider = { id: "p", kind: "openai-compatible", label: "Local", baseUrl: "http://127.0.0.1:9", apiKey: "", chatModel: "local", imageModel: "" };
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function runner(craft: () => Promise<{ merged: string }>) {
  const configDir = await mkdtemp(join(tmpdir(), "opencrease-agent-"));
  dirs.push(configDir);
  return new AgentRunner({ configDir, guides: { craft }, workspace: { require: async () => ({ name: "Test" }) } } as unknown as AgentDeps);
}
const adapter: ChatAdapter = { stream: async () => ({ text: "", toolCalls: [], stopReason: "end_turn" }) };

describe("agent run lifecycle", () => {
  it("releases the file after a setup failure so the user can retry", async () => {
    let attempts = 0;
    const agent = await runner(async () => { if (!attempts++) throw new Error("Guide could not be read"); return { merged: "Guide" }; });
    const events: AgentStreamEvent[] = [];
    await agent.run("file", { text: "Hello" }, { provider, model: "local", adapter }, (event) => events.push(event));
    expect(events).toEqual([{ type: "error", message: "Guide could not be read" }]);
    expect(agent.isRunning("file")).toBe(false);
    await agent.run("file", { text: "Hello again" }, { provider, model: "local", adapter }, (event) => events.push(event));
    expect(events.at(-1)?.type).toBe("done");
    expect(agent.isRunning("file")).toBe(false);
  });

  it("rejects a second prepared run without replacing the first run's stop controller", async () => {
    const agent = await runner(async () => ({ merged: "Guide" }));
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const slow: ChatAdapter = { stream: async () => { await pending; return { text: "", toolCalls: [], stopReason: "end_turn" }; } };
    const first = agent.run("file", { text: "First" }, { provider, model: "local", adapter: slow }, () => {});
    const events: AgentStreamEvent[] = [];
    await agent.run("file", { text: "Second" }, { provider, model: "local", adapter }, (event) => events.push(event));
    expect(events[0]).toMatchObject({ type: "error", message: expect.stringContaining("already working") });
    expect(agent.stop("file")).toBe(true);
    release();
    await first;
    expect((await agent.view("file")).turns.at(-1)?.stopped).toBe(true);
    expect(agent.isRunning("file")).toBe(false);
  });
});
