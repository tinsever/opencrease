import type { FoldDocument } from "../../packages/model/src/index";

export interface RecordedCall { tool: string; args: Record<string, unknown>; bind?: Record<string, string> }
export interface RecordedSession { name: string; prompt: string; calls: RecordedCall[]; expected: unknown }

export function substitute(value: unknown, bindings: Record<string, unknown>): unknown {
  if (typeof value === "string" && value.startsWith("$")) {
    if (!(value.slice(1) in bindings)) throw new Error(`Unknown session binding ${value}`);
    return bindings[value.slice(1)];
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, bindings));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, bindings)]));
  return value;
}
export function bindResult(bind: Record<string, string> | undefined, body: unknown, bindings: Record<string, unknown>): void {
  for (const [name, path] of Object.entries(bind ?? {})) {
    let value: unknown = body;
    for (const part of path.split(".")) value = (value as Record<string, unknown>)[part];
    if (value === undefined) throw new Error(`Missing response path ${path}`);
    bindings[name] = value;
  }
}
export function snapshot(doc: FoldDocument): unknown {
  const node = (id: string): unknown => {
    const n = doc.nodes[id]!;
    return { type: n.type, name: n.name, styles: n.styles, ...(n.text === undefined ? {} : { text: n.text }), children: n.children.map(node) };
  };
  return {
    pages: doc.pageList.map((p) => p.type === "divider" ? { divider: true } : { name: doc.pages[p.id]!.name, children: doc.nodes[doc.pages[p.id]!.rootId]!.children.map(node) }),
    tokens: doc.tokens.map(({ name, type, value }) => ({ name, type, value })),
  };
}
