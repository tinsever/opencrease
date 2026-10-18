import { describe, expect, it } from "vitest";
import { createDocument } from "@opencrease/model";
import {
  errorResult,
  fileHeader,
  getTool,
  normalizeArgs,
  textResult,
  TOOLS,
  toolInputSchema,
  withFileHeader,
  LONG_TOOL_TIMEOUT_MS,
  EXPORT_TOOL_TIMEOUT_MS,
} from "./index";

const EXPECTED = [
  "get_basic_info", "get_selection", "get_tree_summary", "get_children", "get_node_info", "get_jsx",
  "get_computed_styles", "get_screenshot", "get_fill_image", "get_font_family_info", "get_tokens", "find_nodes",
  "list_resources", "create_file", "open_file", "rename_resource", "create_page", "update_pages", "arrange_pages",
  "create_artboard", "write_html", "update_styles", "set_text_content", "rename_nodes", "move_nodes",
  "duplicate_nodes", "delete_nodes", "create_tokens", "set_tokens", "export", "export_combined_pdf",
  "finish_working_on_nodes", "get_guide", "oc_boolean_op", "oc_flatten",
];

const SERVER_SIDE = ["list_resources", "create_file", "open_file", "rename_resource", "get_guide"];
const READ_ONLY = [
  "get_basic_info", "get_selection", "get_tree_summary", "get_children", "get_node_info", "get_jsx",
  "get_computed_styles", "get_screenshot", "get_fill_image", "get_font_family_info", "get_tokens", "find_nodes",
  "list_resources", "get_guide", "export", "export_combined_pdf", "oc_list_components", "oc_get_diff",
];

describe("TOOLS", () => {
  it("contains the Paper-compatible tool set, OpenCrease vector extensions and the component tools", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names.filter((n) => !n.startsWith("oc_") || EXPECTED.includes(n)).sort()).toEqual([...EXPECTED].sort());
    for (const n of ["oc_post_brief", "oc_get_diff", "oc_set_mode", "oc_set_text_styles", "oc_list_components", "oc_create_component", "oc_create_instance", "oc_detach_instance"]) expect(names).toContain(n);
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });

  it("marks execution side and read-only flags", () => {
    for (const t of TOOLS) {
      expect(t.side, t.name).toBe(SERVER_SIDE.includes(t.name) ? "server" : "editor");
      expect(t.readOnly, t.name).toBe(READ_ONLY.includes(t.name));
      expect(t.description.length, t.name).toBeGreaterThan(40);
      expect(t.title, t.name).toBeTruthy();
    }
    expect(getTool("export")?.timeoutMs).toBe(EXPORT_TOOL_TIMEOUT_MS);
    expect(getTool("export_combined_pdf")?.timeoutMs).toBe(LONG_TOOL_TIMEOUT_MS);
    expect(getTool("nope")).toBeUndefined();
  });

  it("requires fileId on file-scoped editor tools except the two that default to the active file", () => {
    for (const t of TOOLS.filter((t) => t.side === "editor")) {
      const optional = t.name === "get_basic_info" || t.name === "get_selection";
      expect(toolInputSchema(t).safeParse({}).success, t.name).toBe(optional);
      expect("fileId" in t.inputShape, t.name).toBe(true);
    }
  });

  it("validates representative argument shapes", () => {
    const ok = (name: string, args: unknown) => expect(toolInputSchema(getTool(name)!).safeParse(args).success, name).toBe(true);
    const bad = (name: string, args: unknown) => expect(toolInputSchema(getTool(name)!).safeParse(args).success, name).toBe(false);
    ok("write_html", { fileId: "F", targetNodeId: "A-0", mode: "insert-children", html: "<div/>" });
    bad("write_html", { fileId: "F", targetNodeId: "A-0", mode: "append", html: "<div/>" });
    ok("create_artboard", { fileId: "F", name: "Home", styles: { width: "1440px", height: "900px", backgroundColor: "#fff", gap: 12 } });
    bad("create_artboard", { fileId: "F", name: "Home", styles: { width: "1440px" } });
    ok("move_nodes", { fileId: "F", moves: [{ nodeId: "a", before: "b" }, { nodeId: "a", after: "b" }, { nodeId: "a", parentId: "root", index: 0 }] });
    bad("move_nodes", { fileId: "F", moves: [{ nodeId: "a", before: "b", parentId: "c" }] });
    bad("move_nodes", { fileId: "F", moves: [] });
    ok("update_styles", { fileId: "F", updates: [{ nodeIds: ["a"], styles: { padding: "8px", opacity: 0.5 } }] });
    ok("create_tokens", { fileId: "F", tokens: [{ type: "color", name: "--color-primary", value: "#f00" }] });
    bad("create_tokens", { fileId: "F", tokens: [{ type: "colour", name: "--color-primary", value: "#f00" }] });
    bad("create_tokens", { fileId: "F", tokens: [{ type: "color", name: "color-primary", value: "#f00" }] });
    ok("export", { fileId: "F", nodes: "nodes-with-exports-only" });
    ok("export", { fileId: "F", nodes: { "A-0": [{ format: "png", scale: "2x" }], "B-0": [] }, type: "image" });
    bad("export", { fileId: "F", nodes: { "A-0": [{ format: "png", scale: "2" }] } });
    ok("arrange_pages", { fileId: "F", order: ["p-1-0", { type: "divider" }, "p-2-0"] });
    ok("update_pages", { fileId: "F", updates: [{ pageId: "p-1-0", icon: null }, { pageId: "p-1-0", icon: "arrow" }] });
    bad("create_page", { fileId: "F", icon: "rocket" });
    ok("find_nodes", { fileId: "F", filters: [{ styleName: "color" }], textValue: "Get *" });
    ok("set_tokens", { fileId: "F", tokens: [{ name: "--a", delete: true }] });
    ok("oc_boolean_op", { fileId: "F", nodeIds: ["a", "b"], operation: "union" });
    bad("oc_boolean_op", { fileId: "F", nodeIds: ["a"], operation: "union" });
    bad("oc_boolean_op", { fileId: "F", nodeIds: ["a", "b"], operation: "merge" });
    ok("oc_flatten", { fileId: "F", nodeIds: ["a"], operation: "outline-stroke" });
    ok("oc_flatten", { fileId: "F", nodeIds: ["a"] });
    ok("list_resources", {});
    ok("rename_resource", { resourceId: "F", name: "x" });
    ok("oc_create_component", { fileId: "F", nodeIds: ["A-0"], props: [{ name: "label", type: "text", target: "B-0" }], codeRef: { package: "@acme/ui", export: "Button" } });
    bad("oc_create_component", { fileId: "F", nodeIds: ["A-0"], props: [{ name: "v", type: "enum", target: "" }] });
    ok("oc_create_instance", { fileId: "F", componentId: "Button", parentId: "A-0", props: { variant: "ghost", iconRight: false } });
    ok("oc_set_instance_props", { fileId: "F", updates: [{ instanceId: "I-0", props: { label: null } }] });
    ok("oc_set_component_props", { fileId: "F", componentId: "A-0", codeRef: null });
  });
});

describe("normalizeArgs", () => {
  it("fills defaults and clamps", () => {
    expect(normalizeArgs("get_tree_summary", { fileId: "F", nodeId: "n" }).depth).toBe(3);
    expect(normalizeArgs("get_tree_summary", { fileId: "F", nodeId: "n", depth: 50 }).depth).toBe(10);
    expect(normalizeArgs("get_tree_summary", { fileId: "F", nodeId: "n", depth: 0 }).depth).toBe(1);
    expect(normalizeArgs("get_screenshot", { fileId: "F", nodeId: "n" }).scale).toBe(1);
    expect(normalizeArgs("get_screenshot", { fileId: "F", nodeId: "n", scale: 3 }).scale).toBe(2);
    expect(normalizeArgs("get_jsx", { fileId: "F", nodeId: "n" })).toMatchObject({ format: "tailwind", includeNodeIds: true, includeRootPositioning: false });
    expect(normalizeArgs("get_jsx", { fileId: "F", nodeId: "n", includeNodeIds: false }).includeNodeIds).toBe(false);
  });

  it("folds the set_tokens tokens[] form into updates and deletes", () => {
    const out = normalizeArgs("set_tokens", {
      fileId: "F",
      updates: [{ name: "--a", value: "1px" }],
      tokens: [{ name: "--b", newName: "--c" }, { name: "--d", delete: true }],
    });
    expect(out).toEqual({ fileId: "F", updates: [{ name: "--a", value: "1px" }, { name: "--b", newName: "--c" }], deletes: ["--d"] });
  });
});

describe("results", () => {
  it("builds text and error results", () => {
    expect(textResult("a", { b: 1 })).toEqual({ content: [{ type: "text", text: "a" }, { type: "text", text: '{\n  "b": 1\n}' }] });
    expect(errorResult("nope")).toEqual({ content: [{ type: "text", text: "nope" }], isError: true });
  });

  it("builds the file header", () => {
    const doc = createDocument("Landing", { id: "01TESTFILE" });
    const header = fileHeader(doc);
    expect(header.file).toEqual({ id: "01TESTFILE", name: "Landing" });
    expect(header.contentHash.tokens).toMatch(/^[0-9a-f]{8}$/);
    const r = withFileHeader(doc, textResult("body"));
    expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual(header);
    expect(r.content[1]).toEqual({ type: "text", text: "body" });
  });
});
