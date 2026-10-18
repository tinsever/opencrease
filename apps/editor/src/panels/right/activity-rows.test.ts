import { describe, expect, it } from "vitest";
import type { AgentLogEntry } from "../../agent/activity";
import { activityLabel, groupActivity, humanizeTool, readsSummary } from "./activity-rows";

let id = 0;
const e = (tool: string, write = false, ok = true, label = ""): AgentLogEntry => ({ id: ++id, fileId: "f", client: "claude-code", tool, label, time: id, durationMs: 1, ok, write });

describe("activity rows", () => {
  it("collapses consecutive reads and keeps writes and failures separate", () => {
    const rows = groupActivity([e("get_basic_info"), e("get_node_info"), e("get_node_info"), e("write_html", true, true, "Writing into Hero"), e("get_selection"), e("get_jsx", false, false), e("get_screenshot")]);
    expect(rows.map((r) => (r.kind === "reads" ? `reads:${r.entries.length}` : r.entry.tool))).toEqual(["reads:3", "write_html", "get_selection", "get_jsx", "get_screenshot"]);
  });
  it("labels entries once, in words", () => {
    expect(humanizeTool("get_node_info")).toBe("Get node info");
    expect(activityLabel({ tool: "write_html", label: "Writing into Hero" })).toBe("Writing into Hero");
    expect(activityLabel({ tool: "get_selection", label: "" })).toBe("Get selection");
  });
  it("summarises reads", () => {
    const s = readsSummary([e("get_node_info", false, true, "Get node info"), e("get_node_info", false, true, "Get node info"), e("get_selection", false, true, "Get selection")]);
    expect(s).toEqual({ title: "Read 3 times", detail: "node info, selection" });
  });
});
