import { describe, expect, it } from "vitest";
import type { AgentTurn } from "@opencrease/protocol";
import { applyAgentEvent, readAgentStream } from "./agent-stream";

describe("agent stream", () => {
  it("reads fragmented UTF-8, CRLF, heartbeat and a final unterminated event", async () => {
    const bytes = new TextEncoder().encode(': ping\r\ndata: {"type":"text","delta":"Größe"}\r\n\r\ndata: {"type":"error","message":"offline"}');
    const body = new ReadableStream<Uint8Array>({ start(c) { for (const b of bytes) c.enqueue(new Uint8Array([b])); c.close(); } });
    const events: unknown[] = [];
    await readAgentStream(body, (e) => events.push(e));
    expect(events).toEqual([{ type: "text", delta: "Größe" }, { type: "error", message: "offline" }]);
  });

  it("retains step order and updates an earlier step without changing previous snapshots", () => {
    const initial: AgentTurn[] = [{ id: "a", role: "assistant", time: 1, parts: [] }];
    let turns = applyAgentEvent(initial, { type: "text", delta: "Brief" });
    turns = applyAgentEvent(turns, { type: "step", step: { id: "s", tool: "write_html", label: "Hero", status: "running" } });
    turns = applyAgentEvent(turns, { type: "text", delta: "Reviewed" });
    turns = applyAgentEvent(turns, { type: "step", step: { id: "s", tool: "write_html", label: "Hero", status: "ok" } });
    expect(initial[0]!.parts).toEqual([]);
    expect(turns[0]!.parts).toEqual([{ type: "text", text: "Brief" }, { type: "steps", steps: [{ id: "s", tool: "write_html", label: "Hero", status: "ok" }] }, { type: "text", text: "Reviewed" }]);
    expect(applyAgentEvent(turns, { type: "done", stopReason: "stopped", turn: { ...turns[0]!, stopped: true } })[0]!.stopped).toBe(true);
  });
});
