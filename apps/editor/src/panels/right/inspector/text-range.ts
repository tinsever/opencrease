// Range-aware typography writes: while a Text node is being edited with characters selected, the
// Typography section reads and writes the styles of that range (rich text spans); otherwise it styles
// whole nodes and clears the same properties from their spans so the new value shows everywhere.
import { styleRange, type OFNode, type StyleValue } from "@opencrease/model";
import { SPAN_STYLE_KEYS } from "@opencrease/css";
import { rangeStyle, richText } from "../../../canvas/rich-edit";
import { useStore } from "../../../canvas/store";
import { formatTextRange } from "../../../canvas/text-edit";
import { useWorkspace } from "../../../state/hooks";
import { getOpenFile } from "../../../state/workspace";
import { MIXED, type Mixed } from "../../../ui";
import { styleValue, type InspectorCtx } from "./common";

export interface ActiveRange {
  node: OFNode;
  start: number;
  end: number;
}

/** The selected character range of the single selected Text node, while it is being edited. */
export function useTextRange(ctx: InspectorCtx): ActiveRange | null {
  const editing = useWorkspace((s) => s.editingTextId);
  const range = useStore(richText, (s) => s.range);
  if (!range || !editing || range.nodeId !== editing || range.end <= range.start) return null;
  if (ctx.ids.length !== 1 || ctx.ids[0] !== editing) return null;
  const node = ctx.nodes[0];
  if (!node || node.type !== "Text" || range.end > (node.text ?? "").length) return null;
  return { node, start: range.start, end: range.end };
}

export interface TextWriter {
  range: ActiveRange | null;
  value: (key: string) => StyleValue | undefined | Mixed;
  write: (patch: Record<string, StyleValue | null>, label: string, mergeKey?: string) => void;
}

export function textWriter(ctx: InspectorCtx, range: ActiveRange | null): TextWriter {
  return {
    range,
    value: (key) => {
      if (!range || !SPAN_STYLE_KEYS.has(key)) return styleValue(ctx.nodes, key);
      const v = rangeStyle({ text: range.node.text ?? "", spans: range.node.spans }, range.node.styles, range.start, range.end, key);
      return v === "mixed" ? MIXED : v;
    },
    write: (patch, label, mergeKey) => {
      const spanKeys = Object.keys(patch).filter((k) => SPAN_STYLE_KEYS.has(k));
      if (range && spanKeys.length === Object.keys(patch).length && formatTextRange(label, patch, mergeKey)) return;
      const file = getOpenFile(ctx.fileId);
      if (!file) return;
      try {
        file.store.transact(
          label,
          (tx) => {
            for (const id of ctx.ids) {
              const node = tx.doc.nodes[id];
              if (!node || node.locked) continue;
              tx.setStyles(id, patch);
              if (node.spans && spanKeys.length) {
                const clear = Object.fromEntries(spanKeys.map((k) => [k, null]));
                tx.updateNode(id, { spans: styleRange(node.text ?? "", node.spans, 0, (node.text ?? "").length, clear) });
              }
            }
          },
          { mergeKey },
        );
      } catch (e) {
        console.warn(label, e);
      }
    },
  };
}
