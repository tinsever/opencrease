import { describe, expect, it } from "vitest";
import { argumentError, inferTokenType, normalizeToolInput, toolArgumentExample } from "./arguments";
import { getTool, TOOLS, toolInputSchema } from "./tools";

function parse(name: string, input: unknown, active?: string) {
  const tool = getTool(name)!;
  return toolInputSchema(tool).parse(normalizeToolInput(tool, input, active));
}

describe("runtime argument compatibility", () => {
  it("keeps every published shape canonical and supplies a valid error example", () => {
    for (const tool of TOOLS) {
      const sample = toolArgumentExample(tool);
      expect(toolInputSchema(tool).safeParse(sample).success, `${tool.name}: ${JSON.stringify(sample)}`).toBe(true);
      expect(argumentError(tool.name, "bad input")).toBe(`Invalid arguments for ${tool.name}:\nbad input\nExpected shape (example): ${JSON.stringify(sample)}`);
      expect(parse(tool.name, sample), tool.name).toEqual(toolInputSchema(tool).parse(sample));
    }
    expect(toolInputSchema(getTool("update_styles")!).safeParse({ fileId: "f", nodeId: "n", styles: {} }).success).toBe(false);
    expect(toolInputSchema(getTool("get_guide")!).safeParse({}).success).toBe(false);
  });

  it("defaults the guide and uses only the active file when omitted", () => {
    expect(parse("get_guide", {})).toEqual({ topic: "craft" });
    expect(parse("get_guide", { topic: "index" })).toEqual({ topic: "index" });
    for (const tool of TOOLS.filter((t) => t.inputShape.fileId && !t.inputShape.fileId.isOptional())) {
      const sample = toolArgumentExample(tool);
      delete sample.fileId;
      expect(parse(tool.name, sample, "active")).toMatchObject({ fileId: "active" });
    }
    expect(parse("get_node_info", { fileId: "explicit", nodeId: "n" }, "active")).toMatchObject({ fileId: "explicit" });
    expect(() => parse("get_node_info", { nodeId: "n" })).toThrow(/fileId/);
  });

  it("accepts node identifiers and cardinality consistently across the catalogue", () => {
    for (const tool of TOOLS) {
      for (const key of ["nodeId", "nodeIds"] as const) {
        if (!tool.inputShape[key]) continue;
        for (const alias of ["id", "nodeId", "nodeIds", "ids"]) {
          const sample = toolArgumentExample(tool);
          const expected = key === "nodeIds" ? ["n", ...(tool.name === "oc_boolean_op" ? ["m"] : [])] : "n";
          delete sample[key];
          sample[alias] = alias.endsWith("s") ? Array.isArray(expected) ? expected : [expected] : expected;
          expect(parse(tool.name, sample), `${tool.name}.${alias}`).toMatchObject({ [key]: expected });
        }
      }
    }
    expect(parse("get_children", { fileId: "f", nodeId: ["n"] })).toMatchObject({ nodeId: "n" });
    expect(() => parse("get_children", { fileId: "f", nodeIds: ["a", "b"] })).toThrow(/exactly one id/);
    expect(() => parse("delete_nodes", { fileId: "f", nodeIds: ["a"], id: "b" })).toThrow(/Conflicting/);
  });

  it.each(["nodeId", "nodeIds", "id", "ids"])("wraps top-level style edits with %s", (key) => {
    const value = key.endsWith("s") ? ["n"] : "n";
    expect(parse("update_styles", { fileId: "f", [key]: value, styles: { width: 104 } })).toEqual({ fileId: "f", updates: [{ nodeIds: ["n"], styles: { width: 104 } }] });
    expect(parse("update_styles", { fileId: "f", updates: { [key]: value, styles: { width: 104 } } })).toMatchObject({ updates: [{ nodeIds: ["n"], styles: { width: 104 } }] });
  });

  it.each(["text", "textContent"])("accepts %s for single and batch text edits", (key) => {
    for (const edit of [{ nodeId: "n", [key]: "" }, { id: "n", [key]: "new" }]) {
      for (const input of [edit, { updates: [edit] }, { updates: edit }]) expect(parse("set_text_content", { fileId: "f", ...input })).toMatchObject({ updates: [{ nodeId: "n", textContent: edit[key] }] });
    }
    expect(() => parse("set_text_content", { fileId: "f", nodeId: "n", text: "a", textContent: "b" })).toThrow(/Conflicting/);
  });

  it("wraps single renames, page edits, moves, instance edits and other object arrays", () => {
    expect(parse("rename_nodes", { fileId: "f", id: "n", name: "New" })).toMatchObject({ updates: [{ nodeId: "n", name: "New" }] });
    expect(parse("update_pages", { fileId: "f", pageId: "p", name: "New" })).toMatchObject({ updates: [{ pageId: "p", name: "New" }] });
    expect(parse("move_nodes", { fileId: "f", id: "n", parentId: "p" })).toMatchObject({ moves: [{ nodeId: "n", parentId: "p" }] });
    expect(parse("move_nodes", { fileId: "f", moves: [{ id: "n", before: "m" }] })).toMatchObject({ moves: [{ nodeId: "n", before: "m" }] });
    expect(parse("oc_set_instance_props", { fileId: "f", instanceId: "n", props: { label: "Hi" } })).toMatchObject({ updates: [{ instanceId: "n", props: { label: "Hi" } }] });
    expect(parse("oc_create_component_set", { fileId: "f", componentId: "n" })).toMatchObject({ componentIds: ["n"] });
    expect(parse("get_font_family_info", { fileId: "f", familyNames: "Inter" })).toMatchObject({ familyNames: ["Inter"] });
    expect(() => parse("update_styles", { fileId: "f", nodeId: "n", styles: {}, updates: [] })).toThrow(/either updates/);
  });

  it("accepts unambiguous component, instance, artboard, page, font and export targets", () => {
    for (const tool of ["oc_set_component_props", "oc_create_instance"]) for (const key of ["id", "ids", "nodeId", "nodeIds"]) {
      expect(parse(tool, { fileId: "f", [key]: key.endsWith("s") ? ["c"] : "c", ...(tool === "oc_create_instance" ? { parentId: "p" } : {}) })).toMatchObject({ componentId: "c" });
    }
    for (const key of ["id", "ids", "nodeId", "nodeIds", "componentId"]) expect(parse("oc_create_component_set", { fileId: "f", [key]: key.endsWith("s") ? ["c"] : "c" })).toMatchObject({ componentIds: ["c"] });
    expect(parse("oc_set_instance_props", { fileId: "f", id: "i", props: {} })).toMatchObject({ updates: [{ instanceId: "i" }] });
    expect(parse("oc_set_instance_props", { fileId: "f", updates: [{ nodeId: "i", props: {} }] })).toMatchObject({ updates: [{ instanceId: "i" }] });
    expect(parse("oc_post_brief", { ...toolArgumentExample(getTool("oc_post_brief")!), nodeId: "a" })).toMatchObject({ artboardId: "a" });
    expect(parse("update_pages", { fileId: "f", id: "p", name: "New" })).toMatchObject({ updates: [{ pageId: "p" }] });
    for (const key of ["familyNames", "familyName", "fontFamily", "family"]) expect(parse("get_font_family_info", { fileId: "f", [key]: "Inter" })).toMatchObject({ familyNames: ["Inter"] });
    for (const key of ["id", "ids", "nodeId", "nodeIds"]) expect(parse("export", { fileId: "f", [key]: key.endsWith("s") ? ["a", "b"] : "a" })).toMatchObject({ nodes: key.endsWith("s") ? { a: [], b: [] } : { a: [] } });
    expect(() => parse("export", { fileId: "f", nodeIds: [] })).toThrow(/nodes/);
    expect(() => parse("export", { fileId: "f", nodes: {}, nodeId: "a" })).toThrow(/either nodes/);
    expect(() => parse("duplicate_nodes", { fileId: "f", nodes: ["a"], nodeId: "b" })).toThrow(/either nodes/);
  });

  it("accepts write targets but refuses ambiguous replacement parents", () => {
    for (const key of ["targetNodeId", "nodeId", "id", "nodeIds", "parentId"]) expect(parse("write_html", { fileId: "f", [key]: key === "nodeIds" ? ["n"] : "n", mode: "insert-children", html: "<div/>" })).toMatchObject({ targetNodeId: "n" });
    expect(() => parse("write_html", { parentId: "n", mode: "replace", html: "<div/>" }, "f")).toThrow(/targetNodeId explicitly/);
    expect(() => parse("write_html", { id: "a", targetNodeId: "b" }, "f")).toThrow(/Conflicting/);
  });

  it("accepts duplicate ids, lists, objects and nested aliases", () => {
    for (const input of [{ nodeId: "n" }, { id: "n" }, { nodeIds: "n" }, { ids: ["n"] }, { nodes: "n" }, { nodes: ["n"] }, { nodes: { nodeId: "n" } }, { nodes: [{ nodeIds: ["n"] }] }]) expect(parse("duplicate_nodes", { fileId: "f", ...input })).toMatchObject({ nodes: [{ id: "n" }] });
    expect(parse("duplicate_nodes", { fileId: "f", nodeIds: ["a", "b"], parentId: "p" })).toMatchObject({ nodes: [{ id: "a", parentId: "p" }, { id: "b", parentId: "p" }] });
  });

  it("accepts resource aliases without changing their target", () => {
    for (const key of ["id", "resourceId", "fileId"]) expect(parse("rename_resource", { [key]: "f", name: "New" })).toMatchObject({ id: "f" });
    expect(parse("open_file", { id: "f" })).toEqual({ fileId: "f" });
    expect(() => parse("open_file", { id: "f", fileId: "g" })).toThrow(/Conflicting/);
  });

  it.each([
    ["ink", "#112233", "color"], ["ink", "oklch(0.8 0.1 30)", "color"], ["size", "24px", "spacing"],
    ["space-xs", 4, "spacing"], ["font-size-body", "1rem", "fontSize"], ["font-body", "Inter", "fontFamily"],
    ["family", '"Inter", sans-serif', "fontFamily"], ["radius-md", "8px", "radius"], ["font-weight-bold", 700, "fontWeight"],
    ["line-height-body", 1.4, "lineHeight"], ["tracking-tight", "-0.02em", "letterSpacing"], ["opacity-muted", 0.5, "opacity"],
    ["breakpoint-sm", "640px", "breakpoint"], ["container-lg", "80rem", "container"],
  ])("infers %s from %s", (name, value, type) => {
    expect(inferTokenType(name, value)).toBe(type);
    expect(parse("create_tokens", { fileId: "f", tokens: { name, value } })).toMatchObject({ tokens: [{ name: `--${name}`, value, type }] });
  });

  it("asks for explicit types for ambiguous or unsupported values", () => {
    for (const value of [42, "var(--ink)", "0 2px 4px #000", "something"]) expect(() => parse("create_tokens", { fileId: "f", tokens: [{ name: "probe", value }] })).toThrow(/Choose type explicitly.*shadow/);
    expect(inferTokenType("font-shadow", "0 2px 4px #000")).toBeUndefined();
    expect(inferTokenType("font-size", "bold")).toBeUndefined();
    expect(inferTokenType("opacity-muted", "8px")).toBeUndefined();
    expect(() => parse("create_tokens", { fileId: "f", tokens: [{ name: "probe", value: "#000", type: "x" }] })).toThrow(/Invalid enum value/);
    expect(parse("set_tokens", { fileId: "f", updates: { name: "ink", newName: "text", value: "#111" }, deletes: "old" })).toMatchObject({ updates: [{ name: "--ink", newName: "--text" }], deletes: ["--old"] });
    expect(parse("set_tokens", { fileId: "f", tokens: { name: "ink", delete: true } })).toMatchObject({ tokens: [{ name: "--ink", delete: true }] });
  });

  it("requires an explicit artboard name and dimensions like Paper", () => {
    expect(() => parse("create_artboard", {}, "f")).toThrow(/name/);
    expect(argumentError("create_artboard", "name and dimensions required")).toContain('"styles":{"width":"1440px","height":"900px"}');
    for (const input of [[], "bad", 123]) expect(() => parse("update_styles", input)).toThrow();
  });
});
