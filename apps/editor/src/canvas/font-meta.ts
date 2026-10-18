// Google Fonts metadata (families, styles and variable axes) from the server's font proxy, loaded once
// per session. Also the URL helpers for variable font requests and preview subsets.
import { useSyncExternalStore } from "react";

export interface FontAxis {
  tag: string;
  min: number;
  max: number;
  defaultValue: number;
}

export interface FontFamilyInfo {
  family: string;
  category: string;
  styles: string[];
  axes: FontAxis[];
  popularity: number;
}

type MetaState = { status: "idle" | "loading" | "ready" | "error"; list: FontFamilyInfo[]; byName: Map<string, FontFamilyInfo> };

let state: MetaState = { status: "idle", list: [], byName: new Map() };
const listeners = new Set<() => void>();

function set(next: MetaState) {
  state = next;
  for (const l of listeners) l();
}

/** Starts loading the family list (once). Resolves when it is ready or failed. */
export function loadFontMeta(): Promise<void> {
  if (state.status !== "idle" || typeof fetch === "undefined") return Promise.resolve();
  set({ ...state, status: "loading" });
  return fetch("/api/fonts/families")
    .then((res) => (res.ok ? (res.json() as Promise<FontFamilyInfo[]>) : Promise.reject(new Error(String(res.status)))))
    .then((list) => {
      const sorted = [...list].sort((a, b) => a.popularity - b.popularity);
      set({ status: "ready", list: sorted, byName: new Map(sorted.map((f) => [f.family.toLowerCase(), f])) });
    })
    .catch(() => set({ ...state, status: "error" }));
}

export function subscribeFontMeta(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function fontMeta(): MetaState {
  return state;
}

export function familyInfo(family: string): FontFamilyInfo | undefined {
  return state.byName.get(family.toLowerCase());
}

export function useFontMeta(): MetaState {
  const s = useSyncExternalStore(subscribeFontMeta, fontMeta);
  if (s.status === "idle") void loadFontMeta();
  return s;
}

/** Google's css2 axis order: lowercase (registered) tags alphabetically, then uppercase (custom) ones. */
export function sortAxes(axes: readonly FontAxis[]): FontAxis[] {
  const lower = (t: string) => t === t.toLowerCase();
  return [...axes].sort((a, b) => Number(!lower(a.tag)) - Number(!lower(b.tag)) || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}

const range = (a: FontAxis) => (a.min === a.max ? `${a.min}` : `${a.min}..${a.max}`);

/** css2 query for the full variable font: every axis over its whole range, upright and italic as asked. */
export function variableFontQuery(info: Pick<FontFamilyInfo, "family" | "axes" | "styles">, italic: boolean): string {
  const name = encodeURIComponent(info.family).replace(/%20/g, "+");
  const axes = sortAxes(info.axes.filter((a) => a.tag !== "ital"));
  const hasItalic = italic && info.styles.some((s) => s.endsWith("i"));
  const tags = axes.map((a) => a.tag);
  const values = axes.map(range).join(",");
  if (hasItalic) return `family=${name}:${["ital", ...tags].join(",")}@0,${values};1,${values}&display=swap`;
  return `family=${name}:${tags.join(",")}@${values}&display=swap`;
}

/** Variation settings parsed from CSS: `"wght" 650, "opsz" 48` → { wght: 650, opsz: 48 }. */
export function parseVariations(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof v !== "string" || v.trim() === "normal") return out;
  for (const m of v.matchAll(/["']([A-Za-z0-9]{4})["']\s+(-?\d*\.?\d+)/g)) out[m[1]] = Number(m[2]);
  return out;
}

export function variationsToCss(v: Record<string, number>): string | null {
  const parts = Object.entries(v).map(([k, n]) => `"${k}" ${Math.round(n * 100) / 100}`);
  return parts.length ? parts.join(", ") : null;
}

export const AXIS_NAMES: Record<string, string> = {
  wght: "Weight", wdth: "Width", opsz: "Optical size", slnt: "Slant", ital: "Italic", GRAD: "Grade", XOPQ: "Thick stroke", YOPQ: "Thin stroke",
  XTRA: "Counter width", YTUC: "Uppercase height", YTLC: "Lowercase height", YTAS: "Ascender", YTDE: "Descender", YTFI: "Figure height",
  SOFT: "Softness", WONK: "Wonky", CASL: "Casual", CRSV: "Cursive", MONO: "Monospace", FILL: "Fill",
};

const previewLoaded = new Set<string>();

/** Name a preview face is registered under, so subsets never shadow the real font. */
export function previewFamily(family: string): string {
  return `${family} OFPreview`;
}

/** Loads a tiny subset of a Google family (just the letters of its name) for the font picker. */
export function loadPreview(family: string): void {
  if (typeof document === "undefined" || previewLoaded.has(family)) return;
  previewLoaded.add(family);
  const name = encodeURIComponent(family).replace(/%20/g, "+");
  void fetch(`/api/fonts/css2?family=${name}&text=${encodeURIComponent(family)}`)
    .then((res) => (res.ok ? res.text() : ""))
    .then((css) => {
      if (!css) return;
      const style = document.createElement("style");
      style.dataset.ofFontPreview = family;
      style.textContent = css.replace(/font-family:\s*['"]?[^;'"]+['"]?;/g, `font-family: '${previewFamily(family)}';`);
      document.head.appendChild(style);
    })
    .catch(() => undefined);
}
