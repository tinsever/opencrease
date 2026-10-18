import type { StyleMap } from "@opencrease/model";
import { safeCssValue } from "./security";
import { canonicalPropName } from "./case";

/**
 * StyleMap → React style object for the canvas renderer. Numbers stay numbers (React appends px to
 * non-unitless properties), strings pass through. Keys are canonicalised to React's spelling
 * ("-webkit-text-stroke" / "webkitTextStroke" → "WebkitTextStroke"); custom properties pass through.
 * A few properties get the companions browsers still need (line clamp, gradient text, backdrop filter).
 */
export function toReactStyle(styles: StyleMap): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [rawKey, value] of Object.entries(styles)) {
    if (!safeCssValue(value)) continue;
    if (value === null || value === undefined || value === "") continue;
    const key = canonicalPropName(rawKey);
    if (key === "rotate" && typeof value === "number") {
      out.rotate = `${value}deg`;
      continue;
    }
    if (key === "lineClamp") {
      out.WebkitLineClamp = value;
      continue;
    }
    out[key] = value;
  }

  if (out.WebkitLineClamp !== undefined && out.WebkitLineClamp !== "none") {
    if (out.display === undefined || out.display === "block" || out.display === "flex") out.display = "-webkit-box";
    if (out.WebkitBoxOrient === undefined) out.WebkitBoxOrient = "vertical";
    if (out.overflow === undefined) out.overflow = "hidden";
  }
  if (out.backgroundClip === "text" && out.WebkitBackgroundClip === undefined) out.WebkitBackgroundClip = "text";
  if (out.backdropFilter !== undefined && out.WebkitBackdropFilter === undefined) {
    out.WebkitBackdropFilter = out.backdropFilter;
  }
  if (out.maskImage !== undefined && out.WebkitMaskImage === undefined) out.WebkitMaskImage = out.maskImage;
  return out;
}
