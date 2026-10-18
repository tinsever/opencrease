import { afterEach, describe, expect, it, vi } from "vitest";
import { TOOLS } from "@opencrease/protocol";
import { getModelContext, startWebMcp, webMcpTools } from "./webmcp";
afterEach(() => vi.unstubAllGlobals());
describe("WebMCP", () => {
  it("feature detects missing browsers and exposes the complete shared schemas and hints", () => {
    vi.stubGlobal("navigator", {});
    expect(getModelContext()).toBe(null);
    const exposed = webMcpTools();
    expect(exposed.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    for (const t of exposed) {
      expect(t.annotations?.readOnlyHint).toBe(TOOLS.find((x) => x.name === t.name)?.readOnly);
      expect(t.inputSchema.type).toBe("object");
    }
  });
  it("uses document.modelContext when available, retaining navigator compatibility", async () => {
    const registerTool = vi.fn(async (_tool: unknown) => {});
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", { modelContext: { registerTool } });
    expect(await startWebMcp()).toBe(true);
    expect(registerTool).toHaveBeenCalledTimes(TOOLS.length);
    const tool = registerTool.mock.calls[0][0] as unknown;
    expect(tool).toBeTruthy();
  });
});
