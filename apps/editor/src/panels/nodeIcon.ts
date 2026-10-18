// Icon per node type and page icon mapping.
import type { OFNode, PageIcon } from "@opencrease/model";
import type { IconName } from "../ui";

export function nodeIcon(node: OFNode, isArtboard: boolean): IconName {
  if (node.componentSet) return "componentSet";
  if (node.component) return "mainComponent";
  if (node.instance) return "component";
  switch (node.type) {
    case "Text":
      return "text";
    case "Image":
      return "image";
    case "SVG":
      return "svg";
    case "SVGElement":
      switch (node.tag?.toLowerCase()) {
        case "path": return "path";
        case "rect": return "rect";
        case "circle": case "ellipse": return "ellipse";
        case "line": return "line";
        case "polygon": return "polygon";
        case "polyline": return "polyline";
        case "g": case "symbol": case "defs": return "group";
        case "text": case "tspan": return "text";
        case "image": return "image";
        case "clippath": case "mask": return "sides";
        case "lineargradient": case "radialgradient": case "pattern": return "swatches";
        default: return "code";
      }
    case "Rectangle":
      return "rect";
    case "Shader":
      return "shader";
    case "Frame": {
      if (isArtboard) return "artboard";
      const d = node.styles.display;
      if (d === "flex" || d === "inline-flex") return String(node.styles.flexDirection ?? "row").startsWith("column") ? "flexColumn" : "flexRow";
      return "frame";
    }
    default:
      return "frame";
  }
}

export function nodeKind(node: OFNode, isArtboard: boolean): string {
  if (node.componentSet) return "Component set";
  if (node.component) return node.component.variant ? "Variant" : "Component";
  if (node.instance) return "Instance";
  if (isArtboard) return "Artboard";
  if (node.type === "Frame") {
    const d = node.styles.display;
    if (d === "flex" || d === "inline-flex") return String(node.styles.flexDirection ?? "row").startsWith("column") ? "Column" : "Row";
    return "Frame";
  }
  if (node.type === "SVGElement") return node.tag ? node.tag.charAt(0).toUpperCase() + node.tag.slice(1) : "Vector";
  if (node.type === "Rectangle") return "Rectangle";
  return node.type;
}

export const PAGE_ICON_MAP: Record<PageIcon, IconName> = {
  arrow: "arrow",
  padlock: "lock",
  check: "checkPage",
  cross: "cross",
  info: "info",
  question: "question",
  design: "pageDesign",
  vector: "vector",
  images: "image",
  table: "table",
  presentation: "presentation",
  blueprint: "blueprint",
  swatches: "swatches",
  "bar-chart": "barChart",
  "line-chart": "lineChart",
  "pie-chart": "pieChart",
  paper: "paper",
};

export const PAGE_ICON_LABEL: Record<PageIcon, string> = {
  arrow: "Arrow", padlock: "Padlock", check: "Check", cross: "Cross", info: "Info", question: "Question", design: "Design",
  vector: "Vector", images: "Images", table: "Table", presentation: "Presentation", blueprint: "Blueprint", swatches: "Swatches",
  "bar-chart": "Bar chart", "line-chart": "Line chart", "pie-chart": "Pie chart", paper: "Paper",
};
