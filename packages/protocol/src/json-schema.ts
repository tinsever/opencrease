// Minimal zod (v3) to JSON Schema conversion for the constructs the tool catalogue uses. The MCP SDK
// converts schemas on the server; WebMCP and the plugin API need the same schemas in the browser.
import { z } from "zod";
import type { ToolDef } from "./tools";

export type JsonSchema = Record<string, unknown>;

function withDescription(schema: JsonSchema, t: z.ZodTypeAny): JsonSchema {
  return t.description ? { ...schema, description: t.description } : schema;
}

function unwrapOptional(t: z.ZodTypeAny): { inner: z.ZodTypeAny; optional: boolean } {
  let inner = t;
  let optional = false;
  for (;;) {
    if (inner instanceof z.ZodOptional) optional = true;
    else if (!(inner instanceof z.ZodDefault)) break;
    inner = (inner._def as { innerType: z.ZodTypeAny }).innerType;
  }
  return { inner, optional };
}

export function zodToJsonSchema(t: z.ZodTypeAny): JsonSchema {
  if (t instanceof z.ZodOptional || t instanceof z.ZodDefault) {
    const s = zodToJsonSchema((t._def as { innerType: z.ZodTypeAny }).innerType);
    return withDescription(s, t);
  }
  if (t instanceof z.ZodNullable) {
    const s = zodToJsonSchema(t.unwrap());
    return withDescription({ anyOf: [s, { type: "null" }] }, t);
  }
  if (t instanceof z.ZodString) {
    const s: JsonSchema = { type: "string" };
    for (const c of t._def.checks) {
      if (c.kind === "min") s.minLength = c.value;
      if (c.kind === "max") s.maxLength = c.value;
      if (c.kind === "regex") s.pattern = c.regex.source;
    }
    return withDescription(s, t);
  }
  if (t instanceof z.ZodNumber) {
    const s: JsonSchema = { type: t._def.checks.some((c) => c.kind === "int") ? "integer" : "number" };
    for (const c of t._def.checks) {
      if (c.kind === "min") s[c.inclusive ? "minimum" : "exclusiveMinimum"] = c.value;
      if (c.kind === "max") s[c.inclusive ? "maximum" : "exclusiveMaximum"] = c.value;
    }
    return withDescription(s, t);
  }
  if (t instanceof z.ZodBoolean) return withDescription({ type: "boolean" }, t);
  if (t instanceof z.ZodLiteral) return withDescription({ const: t.value }, t);
  if (t instanceof z.ZodEnum) return withDescription({ type: "string", enum: [...t.options] }, t);
  if (t instanceof z.ZodArray) {
    const s: JsonSchema = { type: "array", items: zodToJsonSchema(t.element) };
    if (t._def.minLength) s.minItems = t._def.minLength.value;
    if (t._def.maxLength) s.maxItems = t._def.maxLength.value;
    return withDescription(s, t);
  }
  if (t instanceof z.ZodUnion) return withDescription({ anyOf: (t.options as z.ZodTypeAny[]).map(zodToJsonSchema) }, t);
  if (t instanceof z.ZodRecord) return withDescription({ type: "object", additionalProperties: zodToJsonSchema(t._def.valueType) }, t);
  if (t instanceof z.ZodObject) {
    const s = shapeToJsonSchema(t.shape as z.ZodRawShape);
    const catchall = t._def.catchall as z.ZodTypeAny;
    if (catchall && !(catchall instanceof z.ZodNever)) s.additionalProperties = zodToJsonSchema(catchall);
    else if (t._def.unknownKeys === "strict") s.additionalProperties = false;
    return withDescription(s, t);
  }
  return withDescription({}, t);
}

export function shapeToJsonSchema(shape: z.ZodRawShape): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    const { optional } = unwrapOptional(value);
    properties[key] = zodToJsonSchema(value);
    if (!optional) required.push(key);
  }
  const s: JsonSchema = { type: "object", properties };
  if (required.length) s.required = required;
  return s;
}

/** JSON Schema of a tool's arguments (an object schema). */
export function toolJsonSchema(tool: ToolDef): JsonSchema {
  return shapeToJsonSchema(tool.inputShape);
}
