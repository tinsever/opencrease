// Every colour used in a selection (styles, SVG attributes, shader params, shader fills), grouped so
// one edit replaces a colour everywhere it appears.
import { findColorsInValue, mapColorsInValue, parseColor } from "@opencrease/css";
import type { FoldDocument, NodeId, OFNode, ShaderSpec } from "@opencrease/model";
import { converter, type Color } from "culori";

export type ColorUse =
  | { nodeId: NodeId; kind: "style"; prop: string }
  | { nodeId: NodeId; kind: "attr"; prop: string }
  | { nodeId: NodeId; kind: "hidden"; prop: string }
  | { nodeId: NodeId; kind: "shader"; prop: string; fill: boolean };

export interface ColorGroup {
  key: string;
  /** a representative value as written in the document */
  color: string;
  uses: ColorUse[];
}

/** Style properties that can carry colours. */
const COLOR_PROP = /color|^background(Image)?$|^border(Top|Right|Bottom|Left)?$|^outline$|shadow|^fill$|^stroke$|^textDecoration$|^WebkitTextStroke$|^filter$|^backdropFilter$|^maskImage$|^mask$/i;
const SVG_ATTRS = ["fill", "stroke", "stop-color", "color", "flood-color", "lighting-color"];
const IGNORED = new Set(["none", "transparent", "currentcolor", "inherit", "initial", "unset", "currentColor"]);

const toRgb = converter("rgb");

/** Tokens by name; literal channels at 8-bit precision without clipping wide-gamut colours. */
export function colorKey(color: string): string {
  const t = color.trim();
  const v = /^var\(\s*(--[\w-]+)/.exec(t);
  if (v) return `var:${v[1]}`;
  const p = parseColor(t);
  if (p) {
    const rgb = toRgb(p as unknown as Color);
    return `rgb:${[rgb.r, rgb.g, rgb.b, rgb.alpha ?? 1].map((c) => Math.round(c * 255)).join(",")}`;
  }
  return t.toLowerCase().replace(/\s+/g, "");
}

function walk(doc: FoldDocument, id: NodeId, out: OFNode[], seen: Set<NodeId>) {
  if (seen.has(id)) return;
  seen.add(id);
  const n = doc.nodes[id];
  if (!n) return;
  out.push(n);
  for (const c of n.children) walk(doc, c, out, seen);
}

function shaderColors(spec: ShaderSpec | undefined, nodeId: NodeId, fill: boolean, add: (c: string, use: ColorUse) => void) {
  if (!spec) return;
  for (const [k, v] of Object.entries(spec.params)) {
    const list = Array.isArray(v) ? v : [v];
    for (const item of list) {
      if (typeof item === "string" && parseColor(item)) add(item, { nodeId, kind: "shader", prop: k, fill });
    }
  }
}

/** Colour groups in the selection and its descendants, most used first. */
export function collectColors(doc: FoldDocument, ids: NodeId[]): ColorGroup[] {
  const nodes: OFNode[] = [];
  const seen = new Set<NodeId>();
  for (const id of ids) walk(doc, id, nodes, seen);
  const groups = new Map<string, ColorGroup>();
  const add = (color: string, use: ColorUse) => {
    if (IGNORED.has(color.trim())) return;
    const key = colorKey(color);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, color, uses: [] }));
    if (!g.uses.some((u) => u.nodeId === use.nodeId && u.kind === use.kind && u.prop === use.prop)) g.uses.push(use);
  };
  for (const n of nodes) {
    for (const [prop, value] of Object.entries(n.styles)) {
      if (typeof value !== "string" || !COLOR_PROP.test(prop)) continue;
      for (const c of findColorsInValue(value)) add(c, { nodeId: n.id, kind: "style", prop });
    }
    for (const a of SVG_ATTRS) {
      const v = n.attrs?.[a];
      if (v) for (const c of findColorsInValue(v)) add(c, { nodeId: n.id, kind: "attr", prop: a });
    }
    for (const [i, hidden] of (n.paint?.hiddenFills ?? []).entries()) {
      for (const c of findColorsInValue(hidden.css)) add(c, { nodeId: n.id, kind: "hidden", prop: String(i) });
    }
    if (n.type === "Shader") shaderColors(n.shader, n.id, false, add);
    shaderColors(n.paint?.shader, n.id, true, add);
  }
  return [...groups.values()].sort((a, b) => b.uses.length - a.uses.length);
}

/** Replaces colours matching `key` in one value. */
export function replaceInValue(value: string, key: string, next: string): string {
  return mapColorsInValue(value, (c) => (colorKey(c) === key ? next : undefined));
}

/** Replaces matching colours in shader params (strings and colour lists). */
export function replaceInParams(params: Record<string, unknown>, prop: string, key: string, next: string): Record<string, unknown> {
  const v = params[prop];
  const swap = (x: unknown) => (typeof x === "string" && colorKey(x) === key ? next : x);
  return { ...params, [prop]: Array.isArray(v) ? v.map(swap) : swap(v) };
}
