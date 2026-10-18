// Reading and writing SVG paint (fill, stroke, width, caps, joins, dashes) on vector layers.
// Values live in presentation attributes; a style of the same name wins, and token values (var())
// are written as styles because presentation attributes cannot reference CSS variables everywhere.
import type { FoldDocument, NodeId, OFNode, Tx } from "@opencrease/model";
import { paintValue, shapeElements } from "./svg-geom";

export interface PaintKey {
  style: string;
  attr: string;
}

export const PAINT = {
  fill: { style: "fill", attr: "fill" },
  stroke: { style: "stroke", attr: "stroke" },
  strokeWidth: { style: "strokeWidth", attr: "stroke-width" },
  strokeLinecap: { style: "strokeLinecap", attr: "stroke-linecap" },
  strokeLinejoin: { style: "strokeLinejoin", attr: "stroke-linejoin" },
  strokeDasharray: { style: "strokeDasharray", attr: "stroke-dasharray" },
} satisfies Record<string, PaintKey>;

/** The shape elements a paint edit applies to: shape elements themselves, or every shape inside SVGs and groups. */
export function paintTargets(doc: FoldDocument, ids: NodeId[]): OFNode[] {
  const out = new Map<NodeId, OFNode>();
  for (const id of ids) {
    const n = doc.nodes[id];
    if (!n || (n.type !== "SVG" && n.type !== "SVGElement")) continue;
    for (const el of shapeElements(doc, id)) out.set(el.id, el);
  }
  return [...out.values()];
}

export function readPaint(doc: FoldDocument, node: OFNode, key: PaintKey): string | undefined {
  return paintValue(doc, node, key.style, key.attr);
}

/** Write one paint value on an element (null removes it). */
export function writePaint(tx: Tx, id: NodeId, key: PaintKey, value: string | null): void {
  const node = tx.doc.nodes[id];
  if (!node) return;
  const asStyle = value !== null && /var\(/.test(value);
  const hasStyle = node.styles[key.style] !== undefined;
  if (asStyle || hasStyle) {
    tx.setStyles(id, { [key.style]: value });
    if (node.attrs?.[key.attr] !== undefined) {
      const attrs = { ...node.attrs };
      delete attrs[key.attr];
      tx.updateNode(id, { attrs });
    }
    return;
  }
  const attrs = { ...(node.attrs ?? {}) };
  if (value === null) delete attrs[key.attr];
  else attrs[key.attr] = value;
  tx.updateNode(id, { attrs });
}
