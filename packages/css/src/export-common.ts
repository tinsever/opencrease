import type { FoldDocument, NodeId, OFNode, StyleMap, TextSpan } from "@opencrease/model";

export const ROOT_POSITION_KEYS = ["position", "left", "top", "right", "bottom", "inset"];

export function getNodeOrThrow(doc: FoldDocument, id: NodeId): OFNode {
  const node = doc.nodes[id];
  if (!node) throw new Error(`Node not found: ${id}`);
  return node;
}

/** Visible children of a node, in order. */
export function visibleChildren(doc: FoldDocument, node: OFNode): OFNode[] {
  const out: OFNode[] = [];
  for (const cid of node.children ?? []) {
    const child = doc.nodes[cid];
    if (child && child.visible !== false) out.push(child);
  }
  return out;
}

/**
 * Text renders with `white-space: pre-wrap` on the canvas. Exported code only needs it when the text has
 * whitespace that normal HTML would collapse.
 */
export function textStyles(node: OFNode): StyleMap {
  const styles = { ...node.styles };
  const text = node.text ?? "";
  if (styles.whiteSpace === undefined && /( {2}|\t|^ | $|\n | \n)/m.test(text)) styles.whiteSpace = "pre-wrap";
  return styles;
}

/** Rich text runs of a Text node, or null for plain text (spans that do not spell the text are ignored). */
export function textRuns(node: OFNode): TextSpan[] | null {
  const spans = node.spans;
  if (!spans || !spans.length || spans.map((s) => s.text).join("") !== (node.text ?? "")) return null;
  return spans;
}

export function withoutKeys(styles: StyleMap, keys: string[]): StyleMap {
  const out: StyleMap = {};
  for (const [k, v] of Object.entries(styles)) if (!keys.includes(k)) out[k] = v;
  return out;
}

export function indent(depth: number): string {
  return "  ".repeat(depth);
}
