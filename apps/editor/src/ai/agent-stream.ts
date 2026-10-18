// The local agent endpoint sends one JSON event per SSE data line.
import type { AgentStreamEvent, AgentTurn } from "@opencrease/protocol";

export async function readAgentStream(body: ReadableStream<Uint8Array>, onEvent: (event: AgentStreamEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const line = (value: string) => {
    if (value.startsWith("data:")) onEvent(JSON.parse(value.slice(5).trim()) as AgentStreamEvent);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, end).replace(/\r$/, ""));
        buffer = buffer.slice(end + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) line(buffer.trim());
  } finally {
    reader.releaseLock();
  }
}

/** Immutable updates keep text and tool steps in their streamed order. */
export function applyAgentEvent(turns: AgentTurn[], event: AgentStreamEvent): AgentTurn[] {
  if (event.type === "turn" || ((event.type === "done" || event.type === "error") && event.turn)) {
    const turn = event.turn!;
    return turns.some((t) => t.id === turn.id) ? turns.map((t) => t.id === turn.id ? turn : t) : [...turns, turn];
  }
  const index = turns.findLastIndex((t) => t.role === "assistant");
  if (index < 0) return turns;
  const turn = turns[index]!;
  const parts = [...(turn.parts ?? [])];
  const last = parts.at(-1);
  if (event.type === "text") {
    if (last?.type === "text") parts[parts.length - 1] = { type: "text", text: last.text + event.delta };
    else parts.push({ type: "text", text: event.delta });
  } else if (event.type === "step") {
    const partIndex = parts.findIndex((p) => p.type === "steps" && p.steps.some((s) => s.id === event.step.id));
    if (partIndex >= 0) {
      const part = parts[partIndex]!;
      if (part.type === "steps") parts[partIndex] = { type: "steps", steps: part.steps.map((s) => s.id === event.step.id ? event.step : s) };
    } else if (last?.type === "steps") parts[parts.length - 1] = { type: "steps", steps: [...last.steps, event.step] };
    else parts.push({ type: "steps", steps: [event.step] });
  }
  return turns.map((t, i) => i === index ? { ...turn, parts, ...(event.type === "error" ? { error: event.message } : {}) } : t);
}
