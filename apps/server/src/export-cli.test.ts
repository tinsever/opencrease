import { describe, expect, it } from "vitest";
import { createDocument, DocStore } from "@opencrease/model";
import { parseExportArgs, resolveExportNodes } from "./export-cli";

describe("headless command arguments", () => {
  it("keeps ordinary server and stdio arguments with the original CLI", () => {
    expect(parseExportArgs(["mcp", "--port", "29906"])).toBeNull();
    expect(parseExportArgs(["/workspace", "--no-open"])).toBeNull();
  });
  it("parses the documented export, render, tokens and headless MCP forms", () => {
    expect(parseExportArgs(["export", "Design.fold", "--node", "Hero", "--format", "png", "--scale", "2x", "-o", "out/"])).toEqual({ command: "export", file: "Design.fold", node: "Hero", format: "png", scale: "2x", output: "out/" });
    expect(parseExportArgs(["render", "--file=Design.fold"])).toMatchObject({ command: "render", file: "Design.fold" });
    expect(parseExportArgs(["tokens", "export", "--file", "Design.fold", "--format=tailwind"])).toMatchObject({ command: "tokens", format: "tailwind" });
    expect(parseExportArgs(["mcp", "--headless", "--file", "Design.fold"])).toMatchObject({ command: "mcp", file: "Design.fold" });
  });
  it("rejects invalid options before launching Chromium", () => {
    for (const argv of [["export"], ["export", "a.fold", "--format", "gif"], ["export", "a.fold", "--scale", "0x"], ["render", "a.fold", "--fps", "25"], ["export", "a.fold", "--duration", "301"], ["tokens", "a.fold", "--format", "png"], ["export", "a.fold", "--node"]]) expect(() => parseExportArgs(argv)).toThrow();
  });
  it("resolves ids and exact names and refuses ambiguous names", () => {
    const store = new DocStore(createDocument("Export"));
    const root = Object.values(store.doc.pages)[0]!.rootId;
    const ids = store.transact("Fixture", (tx) => tx.insertTrees(root, [{ name: "Hero" }, { name: "Hero" }, { name: "Icon" }, { name: "Hidden" }]));
    store.transact("Hide", (tx) => tx.updateNode(ids[3]!, { visible: false }));
    expect(resolveExportNodes(store.doc)).toEqual(ids.slice(0, 3));
    expect(resolveExportNodes(store.doc, "Icon")).toEqual([ids[2]]);
    expect(resolveExportNodes(store.doc, ids[0])).toEqual([ids[0]]);
    expect(() => resolveExportNodes(store.doc, "Hero")).toThrow("More than one");
    expect(() => resolveExportNodes(store.doc, "Missing")).toThrow("No layer");
  });
});
