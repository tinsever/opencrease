// Runtime compatibility belongs here, never in the published Paper schemas.
import { z } from "zod";
import { parse as parseColor } from "culori";
import { getTool, TOKEN_TYPES, toolInputSchema, type ToolDef } from "./tools";
import { zodToJsonSchema, type JsonSchema } from "./json-schema";

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function alias(args: Record<string, unknown>, key: string, aliases: string[], many = false) {
  const candidates = [key, ...aliases].filter((k) => args[k] !== undefined);
  const values = candidates.map((k) => {
    const value = args[k];
    if (many) return typeof value === "string" ? [value] : value;
    if (Array.isArray(value)) {
      if (value.length !== 1) throw new Error(`${key} expects exactly one id, received ${value.length}.`);
      return value[0];
    }
    return value;
  });
  if (values.some((v) => !same(v, values[0]))) throw new Error(`Conflicting ${candidates.join(" and ")}; pass only ${key}.`);
  if (candidates.length) args[key] = values[0];
  for (const k of aliases) delete args[k];
}

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) return unwrap(schema._def.innerType);
  return schema;
}

function normalizeShape(value: unknown, schema: z.ZodTypeAny): unknown {
  schema = unwrap(schema);
  if (schema instanceof z.ZodUnion) {
    // Strict move unions share nodeId, so normalise each before selecting the valid branch.
    for (const option of schema.options as z.ZodTypeAny[]) {
      const candidate = normalizeShape(value, option);
      if (option.safeParse(candidate).success) return candidate;
    }
    return value;
  }
  if (schema instanceof z.ZodArray) {
    const item = unwrap(schema.element);
    const list = Array.isArray(value) ? value : object(value) && item instanceof z.ZodObject || typeof value === "string" && item instanceof z.ZodString ? [value] : value;
    return Array.isArray(list) ? list.map((v) => normalizeShape(v, schema.element)) : list;
  }
  if (!(schema instanceof z.ZodObject) || !object(value)) return value;
  const args = { ...value };
  const shape: z.ZodRawShape = schema.shape;
  if (shape.nodeIds) alias(args, "nodeIds", ["nodeId", "id", "ids"], true);
  else if (shape.nodeId) alias(args, "nodeId", ["id", "nodeIds", "ids"]);
  else if (shape.componentIds) alias(args, "componentIds", ["componentId", "nodeIds", "nodeId", "id", "ids"], true);
  else if (shape.componentId) alias(args, "componentId", ["nodeId", "nodeIds", "id", "ids"]);
  else if (shape.instanceId) alias(args, "instanceId", ["nodeId", "nodeIds", "id", "ids"]);
  else if (shape.artboardId) alias(args, "artboardId", ["nodeId", "nodeIds", "id", "ids"]);
  // A page edit has one target; pageId alongside file/node targets remains explicit.
  else if (shape.pageId && !shape.fileId && !shape.targetNodeId) alias(args, "pageId", ["id"]);
  for (const [key, child] of Object.entries(shape)) if (args[key] !== undefined) args[key] = normalizeShape(args[key], child);
  return args;
}

/** Infer only supported, recognisable token categories. Ambiguous numbers and aliases need a type. */
export function inferTokenType(name: unknown, value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const s = String(value).trim();
  if ((/^[a-z#]/i.test(s) && parseColor(s)) || s.toLowerCase() === "currentcolor") return "color";
  if (/^var\(/.test(s)) return undefined;
  const n = String(name).replace(/^--/, "");
  const hints: Array<[RegExp, string]> = [
    [/^(?:font-?weight|weight)(?:-|$)/i, "fontWeight"],
    [/^(?:font-?size|text)(?:-|$)/i, "fontSize"], [/^line-?height(?:-|$)/i, "lineHeight"],
    [/^(?:letter-?spacing|tracking)(?:-|$)/i, "letterSpacing"], [/^opacity(?:-|$)/i, "opacity"],
    [/^(?:radius|rounded)(?:-|$)/i, "radius"], [/^(?:spacing|space|gap|padding)(?:-|$)/i, "spacing"],
    [/^breakpoint(?:-|$)/i, "breakpoint"], [/^container(?:-|$)/i, "container"],
    [/^(?:font-?family|font)(?:-|$)/i, "fontFamily"],
  ];
  const dimension = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|ch|ex|vw|vh|vmin|vmax|%)$/.test(s);
  const number = s !== "" && Number.isFinite(Number(s));
  const family = /^(?:["'].+["']|[\w\"' -]+(?:,\s*[\w"' -]+)+|serif|sans-serif|monospace|system-ui)$/i.test(s);
  for (const [pattern, type] of hints) if (pattern.test(n)) {
    const valid = type === "fontFamily" ? family || /^[\p{L}_][\p{L}\d _-]*$/u.test(s)
      : type === "fontWeight" ? number || /^(normal|bold|bolder|lighter)$/.test(s)
      : type === "opacity" ? number || /^\d+(?:\.\d+)?%$/.test(s) : number || dimension;
    return valid ? type : undefined;
  }
  if (dimension) return "spacing";
  if (family) return "fontFamily";
  return undefined;
}

/** Fold harmless aliases before validation; never invent content or select among several ids. */
export function normalizeToolInput(tool: ToolDef, input: unknown, activeFileId?: string | null): unknown {
  if (!object(input)) return input;
  let args = { ...input };
  if (tool.name === "get_guide" && args.topic === undefined) args.topic = "craft";
  if (tool.name === "rename_resource") alias(args, "id", ["resourceId", "fileId"]);
  if (tool.name === "open_file") alias(args, "fileId", ["id"]);
  if (tool.inputShape.fileId && !tool.inputShape.fileId.isOptional() && args.fileId === undefined && activeFileId) args.fileId = activeFileId;
  if (tool.name === "write_html") {
    if (args.parentId !== undefined && args.mode !== "insert-children") throw new Error('parentId is only accepted with mode: "insert-children". For replace, pass targetNodeId explicitly.');
    alias(args, "targetNodeId", ["nodeId", "nodeIds", "id", "parentId"]);
  }
  const batch = ({ update_styles: "updates", set_text_content: "updates", rename_nodes: "updates", move_nodes: "moves", update_pages: "updates", oc_set_instance_props: "updates" } as Record<string, string>)[tool.name];
  if (batch) {
    const keys = tool.name === "update_styles" ? ["nodeIds", "nodeId", "id", "ids", "styles"]
      : tool.name === "set_text_content" ? ["nodeId", "nodeIds", "id", "text", "textContent"]
      : tool.name === "rename_nodes" ? ["nodeId", "nodeIds", "id", "name"]
      : tool.name === "move_nodes" ? ["nodeId", "nodeIds", "id", "parentId", "before", "after", "index"]
      : tool.name === "update_pages" ? ["pageId", "id", "name", "icon"] : ["instanceId", "nodeId", "nodeIds", "id", "ids", "props"];
    if (keys.some((k) => args[k] !== undefined)) {
      if (args[batch] !== undefined) throw new Error(`Pass either ${batch} or a single top-level edit, not both.`);
      args[batch] = [Object.fromEntries(keys.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]))];
      for (const k of keys) delete args[k];
    }
  }
  if (tool.name === "set_text_content") {
    const edits = Array.isArray(args.updates) ? args.updates : object(args.updates) ? [args.updates] : [];
    args.updates = edits.map((v) => {
      if (!object(v)) return v;
      const edit = { ...v };
      alias(edit, "textContent", ["text"]);
      return edit;
    });
  }
  if (tool.name === "duplicate_nodes") {
    if (args.nodes !== undefined && ["id", "nodeId", "nodeIds", "ids", "parentId"].some((k) => args[k] !== undefined)) throw new Error("Pass either nodes or top-level ids, not both.");
    if (args.nodes === undefined && ["id", "nodeId", "nodeIds", "ids"].some((k) => args[k] !== undefined)) {
      alias(args, "nodeIds", ["id", "nodeId", "ids"], true);
      args.nodes = Array.isArray(args.nodeIds) ? args.nodeIds.map((id) => ({ id, ...(args.parentId !== undefined ? { parentId: args.parentId } : {}) })) : args.nodeIds;
      delete args.nodeIds; delete args.parentId;
    }
    const list = Array.isArray(args.nodes) ? args.nodes : args.nodes !== undefined ? [args.nodes] : [];
    if (args.nodes !== undefined) args.nodes = list.map((v) => {
      const edit = object(v) ? { ...v } : { id: v };
      alias(edit, "id", ["nodeId", "nodeIds"]);
      return edit;
    });
  }
  if (tool.name === "export") {
    const idKeys = ["nodeId", "nodeIds", "id", "ids"];
    if (idKeys.some((k) => args[k] !== undefined)) {
      if (args.nodes !== undefined) throw new Error("Pass either nodes or nodeIds, not both.");
      alias(args, "nodeIds", ["nodeId", "id", "ids"], true);
      if (Array.isArray(args.nodeIds) && args.nodeIds.length && args.nodeIds.every((id) => typeof id === "string" && id)) {
        args.nodes = Object.fromEntries(args.nodeIds.map((id) => [id, []]));
        delete args.nodeIds;
      }
    }
  }
  if (tool.name === "get_font_family_info") alias(args, "familyNames", ["familyName", "fontFamily", "family"], true);
  if (tool.name === "create_tokens" || tool.name === "set_tokens") {
    for (const key of ["tokens", "updates"]) {
      const list = Array.isArray(args[key]) ? args[key] : object(args[key]) ? [args[key]] : undefined;
      if (list) args[key] = list.map((v) => {
        if (!object(v)) return v;
        const token = { ...v };
        for (const k of ["name", "newName"]) if (typeof token[k] === "string" && /^[\w-]+$/.test(token[k]) && !token[k].startsWith("--")) token[k] = `--${token[k]}`;
        if (tool.name === "create_tokens" && token.type === undefined) {
          token.type = inferTokenType(token.name, token.value);
          if (!token.type) throw new Error(`Cannot infer the type of token ${JSON.stringify(token.name)} from ${JSON.stringify(token.value)}. Choose type explicitly: ${TOKEN_TYPES.join(", ")}. General number and shadow categories are not supported; use a supported category or put shadows in node styles.`);
        }
        return token;
      });
    }
    if (typeof args.deletes === "string") args.deletes = [args.deletes];
    if (Array.isArray(args.deletes)) args.deletes = args.deletes.map((v) => typeof v === "string" && /^[\w-]+$/.test(v) && !v.startsWith("--") ? `--${v}` : v);
  }
  args = normalizeShape(args, toolInputSchema(tool)) as Record<string, unknown>;
  return args;
}

function example(schema: JsonSchema, key = ""): unknown {
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum)) return key === "type" && schema.enum.includes("color") ? "color" : schema.enum[0];
  if (Array.isArray(schema.anyOf)) return example(schema.anyOf[0] as JsonSchema, key);
  if (schema.type === "object") {
    const props = schema.properties as Record<string, JsonSchema> | undefined;
    if (!props) return key === "styles" ? { color: "#111111" } : {};
    return Object.fromEntries(((schema.required ?? []) as string[]).map((k) => [k, example(props[k], k)]));
  }
  if (schema.type === "array") return Array.from({ length: Math.max(1, Number(schema.minItems ?? 1)) }, () => example(schema.items as JsonSchema, key));
  if (schema.type === "number" || schema.type === "integer") return Number(schema.minimum ?? 1);
  if (schema.type === "boolean") return true;
  if (key === "topic") return "craft";
  if (key === "familyNames") return "Inter";
  if (key === "name" || key === "newName") return schema.pattern ? "--color-ink" : "Artboard";
  if (key === "width") return "1440px";
  if (key === "height") return "900px";
  if (key === "html") return '<div style="padding:24px">Hello</div>';
  if (key === "value") return "#111111";
  if (key === "scale") return "1x";
  return key === "fileId" ? "FILE_ID" : /Id$|Ids$/.test(key) ? "NODE_ID" : "Hello";
}

/** A small, valid canonical example for every tool, generated from its published shape. */
export function toolArgumentExample(tool: ToolDef): Record<string, unknown> {
  if (tool.name === "rename_resource") return { id: "FILE_ID", name: "New name" };
  if (tool.name === "set_tokens") return { fileId: "FILE_ID", updates: [{ name: "--color-ink", value: "#111111" }] };
  return example(zodToJsonSchema(toolInputSchema(tool))) as Record<string, unknown>;
}

export function argumentError(name: string, detail: string): string {
  const tool = getTool(name);
  return `Invalid arguments for ${name}:\n${detail}${tool ? `\nExpected shape (example): ${JSON.stringify(toolArgumentExample(tool))}` : ""}`;
}
