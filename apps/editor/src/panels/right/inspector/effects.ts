// Box/text shadows and CSS filter lists: parse and serialise.
import { splitCommas, splitSpaces } from "@opencrease/css";
import { isColorValue } from "./fills";

export interface Shadow {
  raw?: string;
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

function len(t: string): number | null {
  const m = /^(-?\d*\.?\d+)(px)?$/.exec(t);
  return m ? Number(m[1]) : null;
}

/** Parses pixel shadows; other valid CSS stays raw so editing another shadow preserves it. */
export function parseShadows(value: string | number | undefined): Shadow[] {
  if (value === undefined || value === null) return [];
  const text = String(value).trim();
  if (!text || text === "none") return [];
  const out: Shadow[] = [];
  for (const part of splitCommas(text)) {
    let inset = false;
    let color = "currentColor";
    const nums: number[] = [];
    let ok = true;
    for (const t of splitSpaces(part)) {
      if (t === "inset") inset = true;
      else if (len(t) !== null) nums.push(len(t)!);
      else if (isColorValue(t)) color = t;
      else ok = false;
    }
    if (!ok || nums.length < 2 || nums.length > 4) {
      out.push({ raw: part, inset: false, x: 0, y: 0, blur: 0, spread: 0, color: "currentColor" });
      continue;
    }
    out.push({ inset, x: nums[0], y: nums[1], blur: nums[2] ?? 0, spread: nums[3] ?? 0, color });
  }
  return out;
}

const px = (n: number) => (n === 0 ? "0" : `${Math.round(n * 100) / 100}px`);

export function shadowsToCss(shadows: Shadow[], opts: { text?: boolean } = {}): string | null {
  if (shadows.length === 0) return null;
  return shadows
    .map((s) => {
      if (s.raw) return s.raw;
      const parts = [s.inset && !opts.text ? "inset" : "", px(s.x), px(s.y), px(s.blur), opts.text ? "" : px(s.spread), s.color];
      return parts.filter(Boolean).join(" ");
    })
    .join(", ");
}

/** Moves an item in a list (drag reorder). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

export const DEFAULT_SHADOW: Shadow = { inset: false, x: 0, y: 4, blur: 12, spread: 0, color: "rgb(0 0 0 / 0.12)" };

// ---------------------------------------------------------------- filters

export type FilterName = "blur" | "brightness" | "contrast" | "saturate" | "grayscale" | "hue-rotate" | "invert" | "sepia";

export interface FilterDef {
  name: FilterName;
  label: string;
  unit: "px" | "%" | "deg";
  default: number;
  min: number;
  max: number;
}

export const FILTER_DEFS: FilterDef[] = [
  { name: "blur", label: "Blur", unit: "px", default: 4, min: 0, max: 200 },
  { name: "brightness", label: "Brightness", unit: "%", default: 120, min: 0, max: 400 },
  { name: "contrast", label: "Contrast", unit: "%", default: 120, min: 0, max: 400 },
  { name: "saturate", label: "Saturate", unit: "%", default: 140, min: 0, max: 400 },
  { name: "grayscale", label: "Grayscale", unit: "%", default: 100, min: 0, max: 100 },
  { name: "hue-rotate", label: "Hue rotate", unit: "deg", default: 90, min: -360, max: 360 },
  { name: "invert", label: "Invert", unit: "%", default: 100, min: 0, max: 100 },
  { name: "sepia", label: "Sepia", unit: "%", default: 100, min: 0, max: 100 },
];

export type FilterEntry = { name: FilterName; value: number } | { name: "raw"; raw: string };

/** Parses a filter list into known functions (values in the def's unit) and raw entries. */
export function parseFilters(value: string | number | undefined): FilterEntry[] {
  if (value === undefined || value === null) return [];
  const text = String(value).trim();
  if (!text || text === "none") return [];
  const out: FilterEntry[] = [];
  for (const part of splitSpaces(text)) {
    const m = /^([\w-]+)\(([\s\S]*)\)$/.exec(part);
    const name = m?.[1].toLowerCase();
    const arg = m?.[2].trim();
    const def = FILTER_DEFS.find((d) => d.name === name);
    const numeric = arg === "" ? (name === "blur" || name === "hue-rotate" ? "0" : "1") : arg;
    const num = numeric === undefined ? null : /^(-?\d*\.?\d+)(px|%|deg|turn|rad|grad)?$/.exec(numeric);
    const unit = num?.[2];
    const validUnit = def && (def.unit === "px" ? unit === "px" || (!unit && Number(num?.[1]) === 0) : def.unit === "deg" ? ["deg", "turn", "rad", "grad"].includes(unit ?? "") || (!unit && Number(num?.[1]) === 0) : !unit || unit === "%");
    if (!def || !num || !validUnit) {
      out.push({ name: "raw", raw: part });
      continue;
    }
    let v = Number(num[1]);
    if (def.unit === "%" && !unit) v *= 100;
    if (def.unit === "deg" && unit === "turn") v *= 360;
    if (def.unit === "deg" && unit === "rad") v = (v * 180) / Math.PI;
    if (def.unit === "deg" && unit === "grad") v *= 0.9;
    out.push({ name: def.name, value: Math.round(v * 100) / 100 });
  }
  return out;
}

export function filtersToCss(entries: FilterEntry[]): string | null {
  if (entries.length === 0) return null;
  return entries
    .map((e) => {
      if (e.name === "raw") return e.raw;
      const def = FILTER_DEFS.find((d) => d.name === e.name)!;
      return `${e.name}(${Math.round(e.value * 100) / 100}${def.unit})`;
    })
    .join(" ");
}
