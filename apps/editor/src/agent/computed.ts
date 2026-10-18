// Curates browser computed styles into a compact, Paper-like map for get_computed_styles. Pure.
import { formatColor, parseColor } from "@opencrease/css";
import type { OFNode, StyleMap } from "@opencrease/model";

const LAYOUT = [
  "display", "position", "top", "right", "bottom", "left", "zIndex",
  "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
  "flexDirection", "flexWrap", "alignItems", "justifyContent", "alignContent", "alignSelf",
  "flexGrow", "flexShrink", "flexBasis", "rowGap", "columnGap",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "overflow", "boxSizing", "aspectRatio",
];
const APPEARANCE = [
  "opacity", "backgroundColor", "backgroundImage", "backgroundSize", "backgroundPosition", "backgroundRepeat",
  "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle",
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
  "outlineWidth", "outlineStyle", "outlineColor", "outlineOffset",
  "boxShadow", "filter", "backdropFilter", "mixBlendMode", "transform", "rotate",
  "clipPath", "maskImage",
];
const TEXT = [
  "color", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing",
  "textAlign", "textTransform", "textDecorationLine", "textDecorationColor", "whiteSpace", "textOverflow",
  "fontVariantNumeric", "fontFeatureSettings", "textShadow", "WebkitTextStrokeWidth", "WebkitTextStrokeColor",
];
const SVG = ["fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin", "strokeDasharray", "fillOpacity", "strokeOpacity"];

/** Values that mean "nothing set" for a property (or for every property when keyed "*"). */
const DEFAULTS: Record<string, string[]> = {
  "*": ["none", "normal", "auto", "0px", "rgba(0, 0, 0, 0)", "initial"],
  position: ["static"],
  overflow: ["visible"],
  opacity: ["1"],
  flexGrow: ["0"],
  flexShrink: ["1"],
  flexDirection: ["row"],
  flexWrap: ["nowrap"],
  alignContent: ["normal"],
  boxSizing: ["border-box", "content-box"],
  backgroundRepeat: ["repeat"],
  backgroundPosition: ["0% 0%"],
  backgroundSize: ["auto"],
  borderTopStyle: ["none"], borderRightStyle: ["none"], borderBottomStyle: ["none"], borderLeftStyle: ["none"],
  textAlign: ["start", "left"],
  fontStyle: ["normal"],
  textTransform: ["none"],
  textDecorationLine: ["none"],
  mixBlendMode: ["normal"],
  objectPosition: ["50% 50%"],
  objectFit: ["fill"],
  zIndex: ["auto"],
  outlineStyle: ["none"],
  whiteSpace: ["normal"],
  textOverflow: ["clip"],
  fillOpacity: ["1"],
  strokeOpacity: ["1"],
  strokeWidth: ["1px"],
  strokeLinecap: ["butt"],
  strokeLinejoin: ["miter"],
  fill: ["rgb(0, 0, 0)"],
  aspectRatio: ["auto"],
};

const ALWAYS = new Set(["display", "width", "height"]);
const COLOR_PROP = /color$|^fill$|^stroke$/i;

export function camelToKebabProp(prop: string): string {
  if (prop.startsWith("Webkit")) return `-webkit-${prop.slice(6).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function isDefault(prop: string, value: string): boolean {
  return (DEFAULTS["*"].includes(value) && !ALWAYS.has(prop)) || (DEFAULTS[prop]?.includes(value) ?? false);
}

function hexColors(value: string): string {
  return value.replace(/rgba?\([^)]*\)/g, (c) => (parseColor(c) ? formatColor(c, "hex").toUpperCase() : c));
}

function collapse(out: Record<string, string>, keys: [string, string, string, string], into: string): void {
  const vals = keys.map((k) => out[k]);
  if (vals.every((v) => v === undefined)) return;
  const filled = vals.map((v) => v ?? "0px");
  for (const k of keys) delete out[k];
  if (filled.every((v) => v === filled[0])) out[into] = filled[0];
  else if (filled[0] === filled[2] && filled[1] === filled[3]) out[into] = `${filled[0]} ${filled[1]}`;
  else out[into] = filled.join(" ");
}

/**
 * Computed styles for one node: layout and appearance properties that differ from their defaults,
 * typography for Text nodes, SVG paint for SVG nodes. Colours are hex. Authored values that use
 * tokens are reported as the var() reference so agents keep using tokens.
 */
export function curateComputedStyles(node: OFNode, read: (kebabProp: string) => string): Record<string, string> {
  const props = [...LAYOUT, ...APPEARANCE];
  if (node.type === "Text") props.push(...TEXT);
  if (node.type === "SVG" || node.type === "SVGElement") props.push(...SVG);
  if (node.type === "Image") props.push("objectFit", "objectPosition");
  const out: Record<string, string> = {};
  const positioned = read("position") !== "static";
  for (const prop of props) {
    let value = (read(camelToKebabProp(prop)) ?? "").trim();
    if (!value || isDefault(prop, value)) continue;
    if (!positioned && ["top", "right", "bottom", "left", "zIndex"].includes(prop)) continue;
    if (prop.startsWith("border") && prop.endsWith("Color")) continue; // handled below with widths
    // replaced elements clip by default
    if (prop === "overflow" && node.styles.overflow === undefined && (node.type === "Image" || node.type === "SVG" || node.type === "Shader")) continue;
    if (COLOR_PROP.test(prop) || /shadow|gradient|image/i.test(prop)) value = hexColors(value);
    out[prop] = value;
  }
  // borders only matter when they have a width and a style
  for (const side of ["Top", "Right", "Bottom", "Left"]) {
    const width = out[`border${side}Width`];
    const style = out[`border${side}Style`];
    if (!width || !style) {
      delete out[`border${side}Width`];
      delete out[`border${side}Style`];
      continue;
    }
    out[`border${side}Color`] = hexColors(read(`border-${side.toLowerCase()}-color`));
  }
  if (!out.outlineStyle) {
    delete out.outlineWidth;
    delete out.outlineColor;
    delete out.outlineOffset;
  }
  if (!out.textDecorationLine) delete out.textDecorationColor;
  collapse(out, ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"], "padding");
  collapse(out, ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"], "borderRadius");
  if (out.rowGap && out.rowGap === out.columnGap) {
    out.gap = out.rowGap;
    delete out.rowGap;
    delete out.columnGap;
  }
  return withTokenRefs(out, node.styles);
}

/** Replace computed values by the authored var() reference where the node's own style uses a token. */
export function withTokenRefs(out: Record<string, string>, authored: StyleMap): Record<string, string> {
  for (const [key, value] of Object.entries(authored)) {
    if (typeof value !== "string" || !value.includes("var(")) continue;
    if (key in out || key === "gap" || key === "padding" || key === "borderRadius" || key === "border") out[key] = value;
    else if (key === "background") out.backgroundColor = value;
  }
  return out;
}
