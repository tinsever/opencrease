import { INSTANCE_POSITION_KEYS, mainComponentOf, type FoldDocument, type NodeId, type OFNode, type StyleMap } from "@opencrease/model";
import { safeImageUrl, safeSvgAttrs, SVG_TAGS } from "./security";
import { getNodeOrThrow, indent, textRuns, textStyles, visibleChildren } from "./export-common";
import { stylesToCss } from "./styles";

export interface NodeToHtmlOptions {
  /** Adds `data-of-id="<nodeId>"` to every element. */
  includeNodeIds?: boolean;
  /**
   * "markup" (default) writes instances as their layers. "tags" writes `<x-instance>` elements that
   * `htmlToTrees` turns back into instances (used for copy and paste), with the layers as fallback.
   */
  instances?: "markup" | "tags";
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attr(name: string, value: string): string {
  return `${name}="${escapeAttr(value)}"`;
}

function commonAttrs(node: OFNode, styles: StyleMap, opts: NodeToHtmlOptions, extra: string[]): string {
  const attrs: string[] = [];
  if (opts.includeNodeIds) attrs.push(attr("data-of-id", node.id));
  if (node.name) attrs.push(attr("layer-name", node.name));
  attrs.push(...extra);
  if (node.paint && Object.keys(node.paint).length) attrs.push(attr("data-paint", JSON.stringify(node.paint)));
  const css = stylesToCss(styles);
  if (css) attrs.push(attr("style", css));
  return attrs.length ? ` ${attrs.join(" ")}` : "";
}

/**
 * `<x-instance component="ID" props='{...}' overrides='{...}' layer-name="..." style="left: ...">` with
 * `<x-slot name="...">` children for slot content and the instance's layers as fallback markup.
 */
function instanceTag(
  doc: FoldDocument,
  node: OFNode,
  depth: number,
  opts: NodeToHtmlOptions,
  renderMarkup: (n: OFNode, depth: number) => string[],
): string[] {
  const pad = indent(depth);
  const data = node.instance!;
  const extra = [attr("component", data.componentId)];
  if (data.library) extra.push(attr("library", data.library));
  if (Object.keys(data.props).length) extra.push(attr("props", JSON.stringify(data.props)));
  if (Object.keys(data.overrides).length) extra.push(attr("overrides", JSON.stringify(data.overrides)));
  const position: StyleMap = {};
  for (const k of INSTANCE_POSITION_KEYS) if (node.styles[k] !== undefined) position[k] = node.styles[k];
  const lines = [`${pad}<x-instance${commonAttrs(node, position, opts, extra)}>`];
  const main = mainComponentOf(doc, node);
  for (const def of main?.component?.props ?? []) {
    if (def.type !== "slot" || def.target === undefined) continue;
    const slot = Object.values(doc.nodes).find((n) => n.source === def.target && isInside(doc, n, node.id));
    const kids = slot ? visibleChildren(doc, slot) : [];
    if (!kids.length) continue;
    lines.push(`${pad}  <x-slot ${attr("name", def.name)}>`, ...kids.flatMap((k) => render(doc, k, depth + 2, opts)), `${pad}  </x-slot>`);
  }
  lines.push(...visibleChildren(doc, node).flatMap((c) => renderMarkup(c, depth + 1)));
  lines.push(`${pad}</x-instance>`);
  return lines;
}

function isInside(doc: FoldDocument, node: OFNode, ancestorId: string): boolean {
  for (let p = node.parentId; p; p = doc.nodes[p]?.parentId ?? null) if (p === ancestorId) return true;
  return false;
}

function render(doc: FoldDocument, node: OFNode, depth: number, opts: NodeToHtmlOptions): string[] {
  const pad = indent(depth);
  switch (node.type) {
    case "Root":
      return visibleChildren(doc, node).flatMap((c) => render(doc, c, depth, opts));
    case "Text": {
      const html = (s: string) => s.split("\n").map(escapeText).join("<br>");
      const runs = textRuns(node);
      const body = runs
        ? runs.map((r) => (r.styles ? `<span style="${escapeAttr(stylesToCss(r.styles))}">${html(r.text)}</span>` : html(r.text))).join("")
        : html(node.text ?? "");
      return [`${pad}<div${commonAttrs(node, textStyles(node), opts, [])}>${body}</div>`];
    }
    case "Image":
      return [`${pad}<img${commonAttrs(node, node.styles, opts, [attr("src", node.src && safeImageUrl(node.src) ? node.src : "")])}>`];
    case "Shader": {
      const extra = [
        attr("data-shader", node.shader?.name ?? ""),
        attr("data-params", JSON.stringify(node.shader?.params ?? {})),
      ];
      return [`${pad}<canvas${commonAttrs(node, node.styles, opts, extra)}></canvas>`];
    }
    case "SVG":
    case "SVGElement": {
      const requested = node.tag || (node.type === "SVG" ? "svg" : "g");
      const tag = SVG_TAGS.has(requested) ? requested : "g";
      const extra = Object.entries(safeSvgAttrs(node.attrs ?? {}, tag))
        .filter(([k]) => k !== "style")
        .map(([k, v]) => attr(k, v));
      const open = `<${tag}${commonAttrs(node, node.styles, opts, extra)}`;
      const children = visibleChildren(doc, node);
      if (children.length) {
        return [`${pad}${open}>`, ...children.flatMap((c) => render(doc, c, depth + 1, opts)), `${pad}</${tag}>`];
      }
      if (node.text) return [`${pad}${open}>${escapeText(node.text)}</${tag}>`];
      return node.type === "SVG" ? [`${pad}${open}></svg>`] : [`${pad}${open} />`];
    }
    default: {
      if (opts.instances === "tags" && node.instance && node.source === undefined) {
        return instanceTag(doc, node, depth, opts, (n, d) => render(doc, n, d, { ...opts, instances: "markup" }));
      }
      const open = `<div${commonAttrs(node, node.styles, opts, node.mode ? [attr("data-mode", node.mode)] : [])}>`;
      const children = visibleChildren(doc, node);
      if (!children.length) return [`${pad}${open}</div>`];
      return [`${pad}${open}`, ...children.flatMap((c) => render(doc, c, depth + 1, opts)), `${pad}</div>`];
    }
  }
}

/**
 * Exports a node subtree as HTML with inline kebab-case styles and `layer-name` attributes, pretty-printed.
 * The output is accepted by `htmlToTrees` and reproduces structure, names, styles and text.
 * Hidden descendants are omitted.
 */
export function nodeToHtml(doc: FoldDocument, id: NodeId, opts: NodeToHtmlOptions = {}): string {
  const node = getNodeOrThrow(doc, id);
  return render(doc, node, 0, opts).join("\n");
}
