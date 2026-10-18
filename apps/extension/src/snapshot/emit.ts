// OutNode → OpenCrease HTML: only <div>, <img> and <svg> with inline styles, parsed by @opencrease/css htmlToTrees.
import { stylesToCss } from "@opencrease/css";
import type { StyleMap } from "@opencrease/model";
import type { OutNode } from "./types";

/** Clipboard and endpoint marker. Same attribute as the editor's own copy format, so a paste is lossless. */
export const SNAPSHOT_MARKER = 'data-opencrease="snapshot"';

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

function styleAttr(styles: StyleMap): string {
  const css = stylesToCss(styles);
  return css ? ` style="${escapeAttr(css)}"` : "";
}

function nameAttr(name: string | undefined): string {
  return name ? ` layer-name="${escapeAttr(name)}"` : "";
}

/** Text content: hard breaks become <br> unless whitespace is preserved. */
function textHtml(text: string, pre: boolean): string {
  if (pre) return escapeHtml(text);
  return text.split("\n").map(escapeHtml).join("<br>");
}

/** Adds a style declaration list to the root <svg> tag of serialised markup. */
function svgWithStyles(svg: string, styles: StyleMap, name: string | undefined): string {
  const m = /^<svg\b([^>]*)>/i.exec(svg.trim());
  if (!m) return "";
  let attrs = m[1].replace(/\s(style|width|height|layer-name)="[^"]*"/gi, "");
  attrs += nameAttr(name) + styleAttr(styles);
  return `<svg${attrs}>${svg.trim().slice(m[0].length)}`;
}

export function emitNode(node: OutNode, depth = 0): string {
  const pad = "  ".repeat(depth);
  switch (node.kind) {
    case "text": {
      const text = node.text ?? "";
      return `${pad}<div${nameAttr(node.name)}${styleAttr(node.styles)}>${textHtml(text, !!node.pre)}</div>`;
    }
    case "image":
      return `${pad}<img${nameAttr(node.name)} src="${escapeAttr(node.src ?? "")}"${styleAttr(node.styles)}>`;
    case "svg":
      return pad + svgWithStyles(node.svg ?? "", node.styles, node.name);
    case "frame": {
      const kids = (node.children ?? []).map((c) => emitNode(c, depth + 1)).filter(Boolean);
      if (!kids.length) return `${pad}<div${nameAttr(node.name)}${styleAttr(node.styles)}></div>`;
      return `${pad}<div${nameAttr(node.name)}${styleAttr(node.styles)}>\n${kids.join("\n")}\n${pad}</div>`;
    }
  }
}

/** The artboard wrapped in the marker element the editor's paste handler recognises. */
export function wrapForClipboard(artboardHtml: string): string {
  return `<div ${SNAPSHOT_MARKER} style="display: contents">\n${artboardHtml}\n</div>`;
}

export function countNodes(node: OutNode): number {
  return 1 + (node.children ?? []).reduce((sum, c) => sum + countNodes(c), 0);
}
