import type { NodeTree, NodeType, OFNode, PageIcon, TokenType } from "./types";

export const NODE_TYPES: readonly NodeType[] = ["Root", "Frame", "Text", "Rectangle", "Image", "SVG", "SVGElement", "Shader"];

export const PAGE_ICONS: readonly PageIcon[] = [
  "arrow", "padlock", "check", "cross", "info", "question", "design", "vector", "images", "table",
  "presentation", "blueprint", "swatches", "bar-chart", "line-chart", "pie-chart", "paper",
];

export const TOKEN_TYPES: readonly TokenType[] = [
  "color", "spacing", "radius", "fontFamily", "fontWeight", "fontSize",
  "lineHeight", "letterSpacing", "opacity", "container", "breakpoint",
];

const LEAF_TYPES: ReadonlySet<NodeType> = new Set(["Text", "Rectangle", "Image", "Shader"]);

export function canHaveChildren(type: NodeType): boolean {
  return !LEAF_TYPES.has(type);
}

/** Structural rule: may a node of `child` type live directly under a node of `parent` type? */
export function canContain(parent: NodeType, child: NodeType): boolean {
  if (child === "Root" || LEAF_TYPES.has(parent)) return false;
  if (parent === "SVG" || parent === "SVGElement") return child === "SVGElement";
  return child !== "SVGElement";
}

/** Type of a tree without an explicit `type`: text → Text, src → Image, shader → Shader, children → Frame, else Rectangle. */
export function inferNodeType(tree: NodeTree): Exclude<NodeType, "Root"> {
  if (tree.type) return tree.type;
  if (tree.text !== undefined || tree.spans !== undefined) return "Text";
  if (tree.src !== undefined) return "Image";
  if (tree.shader !== undefined) return "Shader";
  return tree.children && tree.children.length > 0 ? "Frame" : "Rectangle";
}

const NAME_LENGTH = 40;

/** Layer name used when none is given. */
export function defaultNodeName(node: Pick<OFNode, "type" | "text" | "tag" | "shader">): string {
  switch (node.type) {
    case "Text": {
      const name = (node.text ?? "").replace(/\r?\n/g, " ").trim().slice(0, NAME_LENGTH).trim();
      return name || "Text";
    }
    case "SVGElement":
      return node.tag ? node.tag.charAt(0).toUpperCase() + node.tag.slice(1) : "Element";
    case "Shader":
      return node.shader?.name || "Shader";
    default:
      return node.type;
  }
}
