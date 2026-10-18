// Which allowlisted properties have a dedicated inspector control. Everything else that is set on a
// node shows in "Other styles" as a raw key/value pair.
import { ALLOWED_STYLES, normalizeStyles } from "@opencrease/css";
import type { StyleMap, StyleValue } from "@opencrease/model";

const SIDES = ["Top", "Right", "Bottom", "Left"];
const CORNERS = ["TopLeft", "TopRight", "BottomRight", "BottomLeft"];

export const DEDICATED: ReadonlySet<string> = new Set([
  // layout
  "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight", "position", "top", "right", "bottom", "left", "rotate",
  "display", "flexDirection", "flexWrap", "gap", "rowGap", "columnGap", "alignItems", "alignContent", "justifyContent", "alignSelf",
  "flex", "flexGrow", "flexShrink", "flexBasis", "padding", "paddingInline", "paddingBlock", ...SIDES.map((s) => `padding${s}`),
  "overflow", "overflowX", "overflowY",
  // appearance
  "opacity", "mixBlendMode", "borderRadius", ...CORNERS.map((c) => `border${c}Radius`),
  // fill
  "background", "backgroundColor", "backgroundImage", "backgroundSize", "backgroundPosition", "backgroundRepeat", "backgroundBlendMode",
  // border, outline
  "border", "borderWidth", "borderStyle", "borderColor",
  ...SIDES.flatMap((s) => [`border${s}`, `border${s}Width`, `border${s}Style`, `border${s}Color`]),
  "outline", "outlineWidth", "outlineStyle", "outlineColor", "outlineOffset",
  // effects
  "boxShadow", "textShadow", "filter", "backdropFilter", "WebkitBackdropFilter", "clipPath", "maskImage", "WebkitMaskImage",
  // text
  "color", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textAlign", "textTransform", "textDecoration",
  "textDecorationLine", "whiteSpace",
  // svg
  "fill",
]);

/** Set properties without a dedicated control, in the node's order. */
export function otherStyles(styles: StyleMap): Array<[string, StyleValue]> {
  return Object.entries(styles).filter(([k]) => !DEDICATED.has(k));
}

/** Allowlisted properties that could be added (not dedicated, not set yet), sorted. */
export function addableProps(styles: StyleMap): string[] {
  return [...ALLOWED_STYLES].filter((k) => !DEDICATED.has(k) && !(k in styles)).sort();
}

/**
 * Validates one raw entry. Returns the normalised key and value, or an error message.
 * Keys may be camelCase or kebab-case.
 */
export function parseRawStyle(key: string, value: string): { key: string; value: StyleValue } | { error: string } {
  const k = key.trim();
  const v = value.trim();
  if (!k) return { error: "Enter a property name." };
  if (!v) return { error: "Enter a value." };
  const { styles, ignored } = normalizeStyles({ [k]: v });
  const entries = Object.entries(styles);
  if (entries.length !== 1 || ignored.length) return { error: `${k} is not a supported property.` };
  return { key: entries[0][0], value: entries[0][1] };
}
