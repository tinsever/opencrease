import { htmlToTrees, normalizeStyles } from "@opencrease/css";
import { NODE_TYPES, type FoldDocument, type NodeId, type NodeTree } from "@opencrease/model";

export const OPENCREASE_MARKER = "data-opencrease";
/** Attribute on the marker naming the file the layers were copied from (for assets across files). */
export const SOURCE_FILE_ATTR = "data-of-file";
export const TREES_ATTR = "data-of-trees";

/** Internal clipboard data preserves node metadata that plain HTML cannot express. */
export function copyTree(doc: FoldDocument, id: NodeId): NodeTree {
  const { type, name, styles, text, src, tag, attrs, shader, paint, constraints, visible, locked, children } = doc.nodes[id];
  return { type: type as NodeTree["type"], name, styles, text, src, tag, attrs, shader, paint, constraints, visible, locked, children: children.map((id) => copyTree(doc, id)) };
}

/** Unwrap our marker element so the copied layers come back as siblings. */
function stripMarker(html: string): string {
  const m = html.match(new RegExp(`<div[^>]*${OPENCREASE_MARKER}[^>]*>([\\s\\S]*)</div>`));
  return m ? m[1] : html;
}

/** Clean HTML coming from other apps: drop the document chrome browsers add. */
export function cleanForeignHtml(html: string): string {
  return html
    .replace(/<!--StartFragment-->|<!--EndFragment-->/g, "")
    .replace(/<meta[^>]*>/gi, "")
    .replace(/<\/?(html|body|head)[^>]*>/gi, "");
}

export function looksLikeMarkup(text: string): boolean {
  const t = text.trim();
  return t.startsWith("<") && t.endsWith(">") && /<([a-z][\w-]*)[\s>/]/i.test(t);
}

/** Parse clipboard HTML into trees (our own marker unwrapped, foreign chrome removed). */
export function clipboardTrees(html: string): NodeTree[] {
  const ours = html.includes(OPENCREASE_MARKER);
  const encoded = ours ? new RegExp(`${TREES_ATTR}="([^\"]+)"`).exec(html)?.[1] : undefined;
  if (encoded) {
    try {
      const raw = JSON.parse(decodeURIComponent(encoded));
      let count = 0;
      const clean = (tree: NodeTree, depth: number): NodeTree => {
        if (++count > 100_000 || depth > 128 || !tree || !NODE_TYPES.includes(tree.type as never) || tree.type as string === "Root") throw new Error("Invalid clipboard tree");
        const out: NodeTree = { type: tree.type, name: tree.name, styles: normalizeStyles(tree.styles ?? {}).styles, text: tree.text, src: tree.src, tag: tree.tag, attrs: tree.attrs, shader: tree.shader, paint: tree.paint, visible: tree.visible, locked: tree.locked, children: (tree.children ?? []).map((c) => clean(c, depth + 1)) };
        const c = tree.constraints;
        if (c && ["left", "right", "center", "scale", "stretch"].includes(c.horizontal) && ["top", "bottom", "center", "scale", "stretch"].includes(c.vertical)) out.constraints = c;
        return out;
      };
      if (Array.isArray(raw)) return raw.map((tree) => clean(tree, 0));
    } catch { /* Fall back to the interoperable HTML representation. */ }
  }
  const source = ours ? stripMarker(html) : cleanForeignHtml(html);
  const { trees, warnings } = htmlToTrees(source, {
    resolveAssetUrl: (url) => url.replace(/^paper-asset:\/\//, "asset://"),
  });
  if (warnings.length) console.info("Paste warnings", warnings);
  return trees;
}

