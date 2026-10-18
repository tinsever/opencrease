// Fast OKLCH → sRGB / Display P3 math for drawing the picker plane (culori is used for everything else).

export interface Oklch {
  l: number; // 0..1
  c: number; // 0..~0.4
  h: number; // degrees
  a: number; // alpha 0..1
}

export const MAX_CHROMA = 0.37;

/** Linear-light sRGB components (may be outside 0..1). */
export function oklchToLinearSrgb(l: number, c: number, h: number): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

export function linearSrgbToP3([r, g, b]: [number, number, number]): [number, number, number] {
  return [0.8224621 * r + 0.177538 * g, 0.0331941 * r + 0.9668058 * g, 0.0170827 * r + 0.0723974 * g + 0.9105199 * b];
}

const EPS = 0.000001;
const inUnit = (v: number) => v >= -EPS && v <= 1 + EPS;

export function inSrgb(l: number, c: number, h: number): boolean {
  return oklchToLinearSrgb(l, c, h).every(inUnit);
}

export function inP3(l: number, c: number, h: number): boolean {
  return linearSrgbToP3(oklchToLinearSrgb(l, c, h)).every(inUnit);
}

/** Largest chroma at (l, h) inside the gamut (binary search). */
export function maxChroma(l: number, h: number, gamut: "srgb" | "p3" = "srgb"): number {
  const test = gamut === "srgb" ? inSrgb : inP3;
  let lo = 0;
  let hi = MAX_CHROMA + 0.1;
  if (l <= 0 || l >= 1) return 0;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (test(l, mid, h)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function gammaEncode(v: number): number {
  const x = Math.min(1, Math.max(0, v));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** 0..255 sRGB bytes, clamped. */
export function oklchToSrgbBytes(l: number, c: number, h: number): [number, number, number] {
  const [r, g, b] = oklchToLinearSrgb(l, c, h);
  return [Math.round(gammaEncode(r) * 255), Math.round(gammaEncode(g) * 255), Math.round(gammaEncode(b) * 255)];
}

/** 0..255 Display P3 bytes (P3 primaries, sRGB transfer curve), clamped. */
export function oklchToP3Bytes(l: number, c: number, h: number): [number, number, number] {
  const [r, g, b] = linearSrgbToP3(oklchToLinearSrgb(l, c, h));
  return [Math.round(gammaEncode(r) * 255), Math.round(gammaEncode(g) * 255), Math.round(gammaEncode(b) * 255)];
}

export function oklchCss(o: Oklch): string {
  const n = (v: number, d: number) => {
    const s = v.toFixed(d).replace(/\.?0+$/, "");
    return s === "-0" ? "0" : s;
  };
  const base = `${n(o.l, 3)} ${n(o.c, 3)} ${n(o.h, 1)}`;
  return o.a < 0.999 ? `oklch(${base} / ${n(o.a, 3)})` : `oklch(${base})`;
}
