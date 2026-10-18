// Pure helpers for the Text details section.
import type { StyleValue } from "@opencrease/model";

export const FEATURES: Array<{ tag: string; label: string }> = [
  { tag: "liga", label: "Ligatures" }, { tag: "dlig", label: "Discretionary ligatures" }, { tag: "calt", label: "Contextual alternates" },
  { tag: "tnum", label: "Tabular figures" }, { tag: "pnum", label: "Proportional figures" }, { tag: "onum", label: "Old-style figures" },
  { tag: "lnum", label: "Lining figures" }, { tag: "zero", label: "Slashed zero" }, { tag: "frac", label: "Fractions" },
  { tag: "case", label: "Case-sensitive forms" }, { tag: "smcp", label: "Small caps" }, { tag: "c2sc", label: "Capitals to small caps" },
  { tag: "salt", label: "Stylistic alternates" }, { tag: "ss01", label: "Stylistic set 1" }, { tag: "ss02", label: "Stylistic set 2" },
  { tag: "ss03", label: "Stylistic set 3" }, { tag: "ss04", label: "Stylistic set 4" }, { tag: "ss05", label: "Stylistic set 5" },
];
/** Features fonts enable by default: toggling them writes an explicit "off". */
export const DEFAULT_ON = new Set(["liga", "calt", "kern"]);

export function parseFeatures(v: StyleValue | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!v || v === "normal") return out;
  for (const part of String(v).split(",")) {
    const m = /["']?(\w{4})["']?\s*(on|off|\d+)?/.exec(part.trim());
    if (m) out[m[1]] = !(m[2] === "0" || m[2] === "off");
  }
  return out;
}

export function featuresToCss(f: Record<string, boolean>): string | null {
  const parts = Object.entries(f).map(([k, on]) => (on ? `"${k}"` : `"${k}" 0`));
  return parts.length ? parts.join(", ") : null;
}

const GRADIENT_RE = /^linear-gradient\(\s*(-?[\d.]+)deg\s*,\s*(.+?)\s*,\s*([^,]+?)\s*\)$/;

export function readGradient(v: StyleValue | undefined): { angle: number; from: string; to: string } | null {
  if (typeof v !== "string") return null;
  const m = GRADIENT_RE.exec(v.trim());
  return m ? { angle: Number(m[1]), from: m[2], to: m[3] } : null;
}

export function gradientTextStyles(g: { angle: number; from: string; to: string } | null): Record<string, StyleValue | null> {
  if (!g) return { backgroundImage: null, backgroundClip: null, WebkitBackgroundClip: null, WebkitTextFillColor: null };
  return {
    backgroundImage: `linear-gradient(${Math.round(g.angle)}deg, ${g.from}, ${g.to})`,
    backgroundClip: "text",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  };
}

export function lineClampStyles(lines: number | null): Record<string, StyleValue | null> {
  if (!lines || lines < 1) return { display: null, WebkitBoxOrient: null, WebkitLineClamp: null, lineClamp: null, overflow: null };
  return { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: Math.round(lines), overflow: "hidden" };
}

