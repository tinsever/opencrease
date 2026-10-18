import { expect, it } from "vitest";
import { createDocument, DocStore } from "@opencrease/model";
import { getTool, normalizeArgs, toolInputSchema } from "@opencrease/protocol";
import { bindResult, snapshot, substitute, type RecordedSession } from "../../../../../tests/sessions/helpers";
import { runEditorTool } from "./index";
import { ReviewTracker } from "../review";
import { testEnv } from "./test-env";

const recordings = import.meta.glob<RecordedSession>("../../../../../tests/sessions/*.json", { eager: true, import: "default" });
for (const session of Object.values(recordings)) {
  it(`replays real MCP session: ${session.name}`, async () => {
    const store = new DocStore(createDocument("Conformance", { id: "recorded-session", clientId: "recorded", now: 0 }));
    const bindings: Record<string, unknown> = {};
    const env = testEnv(store);
    const review = new ReviewTracker();
    for (const step of session.calls) {
      const raw = { fileId: store.doc.id, ...substitute(step.args, bindings) as object };
      const args = toolInputSchema(getTool(step.tool)!).parse(normalizeArgs(step.tool, raw));
      const out = await runEditorTool(step.tool, args, env, { review, touched: () => [] });
      expect(out.ok, JSON.stringify(out.result)).toBe(true);
      const body = JSON.parse((out.result.content[1] as { text: string }).text);
      bindResult(step.bind, body, bindings);
    }
    expect(snapshot(store.doc)).toEqual(session.expected);
  });
}
