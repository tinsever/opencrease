// Writes fill stacks (styles + node paint) as one undo step. Used by the Fill section and the canvas
// gradient handles.
import type { OFNode } from "@opencrease/model";
import { getOpenFile } from "../../../state/workspace";
import { parseFills, writeFills, type FillLayer } from "./fills";

export function readNodeFills(node: OFNode): FillLayer[] {
  return parseFills(node.styles, node.paint);
}

export function writeNodeFills(
  fileId: string,
  ids: string[],
  next: (layers: FillLayer[], node: OFNode) => FillLayer[] | null,
  label = "Fill",
  mergeKey?: string,
) {
  const file = getOpenFile(fileId);
  if (!file) return;
  try {
    file.store.transact(
      label,
      (tx) => {
        for (const id of ids) {
          const node = tx.doc.nodes[id];
          if (!node || node.locked) continue;
          const layers = next(parseFills(node.styles, node.paint), node);
          if (!layers) continue;
          const w = writeFills(layers, node.paint);
          tx.setStyles(id, w.styles);
          if (JSON.stringify(w.paint ?? null) !== JSON.stringify(node.paint ?? null)) tx.updateNode(id, { paint: w.paint });
        }
      },
      { mergeKey },
    );
  } catch (e) {
    console.warn(label, e);
  }
}
