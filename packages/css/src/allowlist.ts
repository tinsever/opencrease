// Authored-style allowlist (SPEC §4.2). camelCase keys, React conventions for vendor prefixes.

const SIDES = ["Top", "Right", "Bottom", "Left"] as const;
const CORNERS = ["TopLeft", "TopRight", "BottomRight", "BottomLeft"] as const;

function borderProps(): string[] {
  const out = ["border", "borderWidth", "borderStyle", "borderColor", "borderRadius"];
  for (const side of SIDES) {
    out.push(`border${side}`, `border${side}Width`, `border${side}Style`, `border${side}Color`);
  }
  for (const corner of CORNERS) out.push(`border${corner}Radius`);
  return out;
}

const LIST: string[] = [
  // Box
  "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "paddingInline", "paddingBlock",
  "boxSizing", "overflow", "overflowX", "overflowY", "aspectRatio",
  // Position
  "position", "top", "right", "bottom", "left", "inset", "zIndex",
  "rotate", "scale", "translate", "transform", "transformOrigin",
  // Flex
  "display", "flexDirection", "flexWrap", "gap", "rowGap", "columnGap",
  "alignItems", "alignContent", "justifyContent", "alignSelf",
  "flex", "flexGrow", "flexShrink", "flexBasis", "order",
  // Grid (M4)
  "gridTemplateColumns", "gridTemplateRows", "gridAutoFlow", "gridAutoColumns", "gridAutoRows",
  "gridColumn", "gridRow", "gridColumnStart", "gridColumnEnd", "gridRowStart", "gridRowEnd",
  "justifyItems", "justifySelf",
  // Paint
  "background", "backgroundColor", "backgroundImage", "backgroundSize", "backgroundPosition",
  "backgroundRepeat", "backgroundBlendMode", "backgroundClip", "backgroundOrigin",
  "WebkitBackgroundClip",
  ...borderProps(),
  "outline", "outlineWidth", "outlineStyle", "outlineColor", "outlineOffset",
  "boxShadow", "opacity", "mixBlendMode", "isolation", "filter", "backdropFilter",
  "WebkitBackdropFilter", "clipPath", "maskImage", "WebkitMaskImage", "mask",
  "maskSize", "maskPosition", "maskRepeat",
  "objectFit", "objectPosition",
  // Text
  "color", "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch",
  "fontVariationSettings", "fontFeatureSettings", "fontOpticalSizing", "fontKerning",
  "fontVariantNumeric", "fontVariantLigatures", "fontVariantCaps", "fontSynthesis",
  "lineHeight", "letterSpacing", "wordSpacing", "textAlign", "textTransform", "textIndent",
  "textDecoration", "textDecorationLine", "textDecorationColor", "textDecorationStyle",
  "textDecorationThickness", "textUnderlineOffset", "textUnderlinePosition",
  "textOverflow", "textShadow", "whiteSpace", "wordBreak", "overflowWrap", "hyphens",
  "lineClamp", "WebkitLineClamp", "WebkitBoxOrient",
  "WebkitTextStroke", "WebkitTextStrokeWidth", "WebkitTextStrokeColor", "WebkitTextFillColor",
  "textWrap", "textWrapMode", "textWrapStyle",
  // SVG presentation
  "fill", "fillOpacity", "fillRule", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin",
  "strokeDasharray", "strokeDashoffset", "strokeMiterlimit", "strokeOpacity",
  "stopColor", "stopOpacity", "clipRule", "vectorEffect",
];

/** camelCase CSS properties that may be stored on a node (SPEC §4.2). */
export const ALLOWED_STYLES: ReadonlySet<string> = new Set(LIST);

/**
 * Properties whose numeric values are unitless (React's list, restricted to what can appear in
 * a StyleMap). Every other numeric value is a px length.
 */
export const UNITLESS_PROPERTIES: ReadonlySet<string> = new Set([
  "aspectRatio", "flex", "flexGrow", "flexShrink", "fontWeight", "lineClamp", "WebkitLineClamp",
  "lineHeight", "opacity", "order", "scale", "zIndex", "fillOpacity", "stopOpacity",
  "strokeDasharray", "strokeDashoffset", "strokeMiterlimit", "strokeOpacity", "strokeWidth",
]);
