// Font family lookup helpers for get_font_family_info. Parsing is pure; lookups use fetch and the DOM.

export interface FontFace {
  style: string;
  weight: number;
  isItalic: boolean;
}

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

export function faceStyleName(weight: number, italic: boolean): string {
  const base = WEIGHT_NAMES[weight] ?? String(weight);
  if (!italic) return base;
  return weight === 400 ? "Italic" : `${base} Italic`;
}

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

/**
 * Google Fonts CSS v1 URL asking for every weight in both styles. The v1 API silently skips the
 * weights a family does not have, so the response lists exactly the available faces.
 */
export function googleFontsProbeUrl(family: string): string {
  const variants = [...WEIGHTS.map(String), ...WEIGHTS.map((w) => `${w}i`)].join(",");
  return `https://fonts.googleapis.com/css?family=${encodeURIComponent(family).replace(/%20/g, "+")}:${variants}`;
}

/** Faces declared in a Google Fonts stylesheet, deduplicated and sorted (weight, then upright first). */
export function parseFontFaceCss(css: string, family?: string): FontFace[] {
  const faces = new Map<string, FontFace>();
  for (const m of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const body = m[1];
    if (family) {
      const fam = /font-family:\s*['"]?([^;'"]+)['"]?\s*;/i.exec(body)?.[1]?.trim();
      if (fam && fam.toLowerCase() !== family.toLowerCase()) continue;
    }
    const italic = /font-style:\s*italic/i.test(body);
    const wRaw = /font-weight:\s*([\d\s]+)\s*;/i.exec(body)?.[1]?.trim() ?? "400";
    const parts = wRaw.split(/\s+/).map(Number).filter((n) => Number.isFinite(n));
    const weights = parts.length === 2 ? WEIGHTS.filter((w) => w >= parts[0] && w <= parts[1]) : parts;
    for (const weight of weights) {
      const key = `${weight}${italic ? "i" : ""}`;
      if (!faces.has(key)) faces.set(key, { style: faceStyleName(weight, italic), weight, isItalic: italic });
    }
  }
  return [...faces.values()].sort((a, b) => a.weight - b.weight || Number(a.isItalic) - Number(b.isItalic));
}

/** Families bundled with the editor (always available). */
export const BUNDLED_FAMILIES: Record<string, FontFace[]> = {
  geist: WEIGHTS.map((w) => ({ style: faceStyleName(w, false), weight: w, isItalic: false })),
  "geist mono": WEIGHTS.map((w) => ({ style: faceStyleName(w, false), weight: w, isItalic: false })),
};

/** Generic CSS families that always resolve to something. */
export const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif",
  "ui-monospace", "ui-rounded", "math", "emoji", "fangsong",
]);

/** First family of a font-family stack, unquoted: `"Inter", sans-serif` → `Inter`. */
export function primaryFamily(stack: string): string {
  const first = stack.split(",")[0] ?? "";
  return first.trim().replace(/^['"]|['"]$/g, "").trim();
}
