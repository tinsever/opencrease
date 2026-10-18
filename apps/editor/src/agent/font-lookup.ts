// get_font_family_info lookups: bundled fonts, Google Fonts (probed through the CSS API) and fonts
// installed on the user's machine (detected by measuring text).
import { proxiedFontsUrl } from "../canvas/fonts";
import type { FontLookup } from "./env";
import { BUNDLED_FAMILIES, faceStyleName, googleFontsProbeUrl, parseFontFaceCss, type FontFace } from "./fonts";

const googleCache = new Map<string, Promise<FontFace[] | null>>();

function probeGoogle(family: string): Promise<FontFace[] | null> {
  const key = family.toLowerCase();
  let p = googleCache.get(key);
  if (!p) {
    p = fetch(proxiedFontsUrl(googleFontsProbeUrl(family)))
      .then(async (res) => {
        if (!res.ok) return null;
        const faces = parseFontFaceCss(await res.text(), family);
        return faces.length ? faces : null;
      })
      .catch(() => null);
    googleCache.set(key, p);
  }
  return p;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** True when the browser renders `family` differently from all generic fallbacks, i.e. it is installed. */
export function isLocalFont(family: string): boolean {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  const ctx = measureCtx;
  if (!ctx) return false;
  const sample = "mmmmmmmmmmlli1WQ@#&gy";
  return ["monospace", "serif", "sans-serif"].some((base) => {
    ctx.font = `72px ${base}`;
    const a = ctx.measureText(sample).width;
    ctx.font = `72px "${family.replace(/"/g, "")}", ${base}`;
    return ctx.measureText(sample).width !== a;
  });
}

/** Installed fonts: the browser cannot list their weights without the Local Font Access permission. */
function localFaces(): FontFace[] {
  return [{ style: faceStyleName(400, false), weight: 400, isItalic: false }];
}

export async function lookupFontFamilies(names: string[]): Promise<FontLookup> {
  const out: FontLookup = { fontsPerFamily: {}, errors: [], sources: {} };
  await Promise.all(
    names.map(async (name) => {
      const bundled = BUNDLED_FAMILIES[name.toLowerCase()];
      if (bundled) {
        out.fontsPerFamily[name] = bundled;
        out.sources![name] = "bundled";
        return;
      }
      const google = await probeGoogle(name);
      if (google) {
        out.fontsPerFamily[name] = google;
        out.sources![name] = "google";
        return;
      }
      if (isLocalFont(name)) {
        out.fontsPerFamily[name] = localFaces();
        out.sources![name] = "local";
        return;
      }
      out.errors.push(`Font family "${name}" is not available.`);
    }),
  );
  return out;
}
