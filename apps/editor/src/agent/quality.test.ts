import { describe, expect, it } from "vitest";
import { createDocument, DocStore } from "@opencrease/model";
import { briefGate, literalTokenMatches, smallStepsWarning, qualityWarnings } from "./quality";
import { ReviewTracker } from "./review";
import { runEditorTool } from "./tools";
import { testEnv } from "./tools/test-env";

function setup() {
  const store = new DocStore(createDocument("Quality"));
  const root = Object.values(store.doc.pages)[0].rootId;
  const board = store.transact("Board", (tx) => tx.insertTrees(root, [{ type: "Frame", name: "Landing", styles: { width: 800, height: 600 } }]))[0];
  const env = testEnv(store);
  return { store, board, env };
}

describe("required quality steps", () => {
  it("gates the actual write handler until a persistent brief exists, per artboard", async () => {
    const { store, board, env } = setup();
    const context = { review: new ReviewTracker(), touched: () => [], steps: ["brief" as const] };
    const args = { fileId: env.fileId, targetNodeId: board, mode: "insert-children", html: "<div>Hello</div>" };
    const blocked = await runEditorTool("write_html", args, env, context);
    expect(blocked.ok).toBe(false);
    expect(store.doc.nodes[board].children).toHaveLength(0);
    const brief = await runEditorTool("oc_post_brief", { artboardId: board, mood: "Calm", palette: "Ink and cream", type: "Serif display", direction: "Wide margins" }, env, context);
    expect(brief.ok).toBe(true);
    expect(store.doc.briefs?.[0].artboardId).toBe(board);
    expect((await runEditorTool("write_html", args, env, context)).ok).toBe(true);
    const other = store.transact("Other board", (tx) => tx.insertTrees(Object.values(tx.doc.pages)[0].rootId, [{ type: "Frame", name: "Other" }]))[0];
    expect(briefGate(store.doc, other, ["brief"])).toMatch(/no design brief/);
    expect(briefGate(store.doc, other, [])).toBe(null);
    store.transact("Token", (tx) => tx.createToken({ type: "color", name: "--color-ink", value: "#123456" }));
    expect(briefGate(store.doc, other, ["brief"])).toBe(null);
  });
  it("names equivalent color and size tokens, including aliases and shorthand sizes", () => {
    const { store } = setup();
    store.transact("Tokens", (tx) => {
      tx.createToken({ type: "color", name: "--color-ink", value: "#ff0000" });
      tx.createToken({ type: "spacing", name: "--spacing-card", value: "16px" });
      tx.createToken({ type: "fontSize", name: "--text-body", value: 20 });
    });
    const matches = literalTokenMatches(store.doc, [{ color: "rgb(255, 0, 0)", padding: "8px 16px", fontSize: 20, backgroundColor: "var(--color-ink)" }]);
    expect(matches.map((m) => m.token)).toEqual(expect.arrayContaining(["--color-ink", "--spacing-card", "--text-body"]));
    expect(matches.find((m) => m.token === "--color-ink")?.count).toBe(1);
    expect(qualityWarnings("update_styles", { updates: [{ styles: { color: "red" } }] }, store.doc, ["tokens"])[0]).toContain("var(--color-ink)");
    expect(qualityWarnings("update_styles", { updates: [{ styles: { color: "red" } }] }, store.doc, [])).toEqual([]);
  });
  it("warns above the documented single-write limit", () => {
    expect(smallStepsWarning(60)).toBe(null);
    expect(smallStepsWarning(61)).toMatch(/61 layers/);
    const { store } = setup();
    expect(qualityWarnings("write_html", { html: "<div></div>".repeat(61) }, store.doc, ["small-steps"])[0]).toMatch(/61 layers/);
  });
});
