// Colour picker notations: which one a value uses, and writing an OKLCH colour in each of them.
import { converter, type Color } from "culori";
import { formatColor, parseColor } from "@opencrease/css";
import { inSrgb, oklchCss, type Oklch } from "./oklch";

export type PickerMode = "oklch" | "oklab" | "hex" | "rgb" | "hsl" | "p3";

export const PICKER_MODES: Array<{ value: PickerMode; label: string }> = [
  { value: "oklch", label: "OKLCH" },
  { value: "oklab", label: "Oklab" },
  { value: "hex", label: "HEX" },
  { value: "rgb", label: "RGB" },
  { value: "hsl", label: "HSL" },
  { value: "p3", label: "P3" },
];

/** Notations that can only hold sRGB colours. */
export const SRGB_ONLY: ReadonlySet<PickerMode> = new Set(["hex", "rgb", "hsl"]);

const toOklch = converter("oklch");
const toOklab = converter("oklab");
const toP3 = converter("p3");

const n = (v: number | undefined, d: number) => {
  const s = (Number.isFinite(v) ? (v as number) : 0).toFixed(d).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};

/** The picker mode a CSS colour is written in (OKLCH for anything without a matching notation). */
export function modeOf(value: string): PickerMode {
  const v = value.trim().toLowerCase();
  if (v.startsWith("#")) return "hex";
  if (v.startsWith("rgb")) return "rgb";
  if (v.startsWith("hsl")) return "hsl";
  if (v.startsWith("oklab")) return "oklab";
  if (v.startsWith("color(display-p3")) return "p3";
  if (/^[a-z]+$/.test(v) && parseColor(v)) return "hex";
  return "oklch";
}

/** Parses a CSS colour literal into OKLCH. `alpha` overrides the colour's own alpha when given. */
export function literalToOklch(literal: string, alpha?: number): Oklch | null {
  const p = parseColor(literal);
  if (!p) return null;
  const o = toOklch(p as unknown as Color);
  return { l: o.l ?? 0, c: o.c ?? 0, h: o.h ?? 0, a: alpha ?? (typeof o.alpha === "number" ? o.alpha : 1) };
}

/**
 * Writes `o` in a notation. sRGB-only notations cannot hold wide-gamut colours: those come back in
 * Display P3 so the value is never silently clipped.
 */
export function formatPicker(o: Oklch, mode: PickerMode): string {
  const alpha = o.a < 0.999 ? ` / ${n(o.a, 3)}` : "";
  const color = { mode: "oklch" as const, l: o.l, c: o.c, h: o.h };
  if (SRGB_ONLY.has(mode) && !inSrgb(o.l, o.c, o.h)) mode = "p3";
  switch (mode) {
    case "oklch":
      return oklchCss(o);
    case "oklab": {
      const lab = toOklab(color);
      return `oklab(${n(lab.l, 3)} ${n(lab.a, 3)} ${n(lab.b, 3)}${alpha})`;
    }
    case "p3": {
      const p = toP3(color);
      return `color(display-p3 ${n(p.r, 4)} ${n(p.g, 4)} ${n(p.b, 4)}${alpha})`;
    }
    default:
      return formatColor(oklchCss(o), mode);
  }
}
