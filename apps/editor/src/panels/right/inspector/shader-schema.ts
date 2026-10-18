// Param schemas for every shader in @paper-design/shaders-react, generated at runtime from the
// package's presets (defaults and types), its enum objects (shape/type options) and meta (colour
// limits). Numeric ranges come from a small table of known parameters with a heuristic fallback.
import * as Core from "@paper-design/shaders";
import * as Shaders from "@paper-design/shaders-react";

export type ParamDef =
  | { key: string; label: string; kind: "number"; min: number; max: number; step: number; default: number; group: ParamGroup }
  | { key: string; label: string; kind: "angle"; default: number; group: ParamGroup }
  | { key: string; label: string; kind: "color"; default: string; group: ParamGroup }
  | { key: string; label: string; kind: "colors"; default: string[]; max: number; group: ParamGroup }
  | { key: string; label: string; kind: "enum"; options: string[]; default: string; group: ParamGroup }
  | { key: string; label: string; kind: "boolean"; default: boolean; group: ParamGroup }
  | { key: string; label: string; kind: "image"; default: string; required: boolean; group: ParamGroup };

export type ParamGroup = "main" | "placement";

export interface ShaderPreset {
  name: string;
  params: Record<string, unknown>;
}

export interface ShaderDef {
  name: string;
  label: string;
  params: ParamDef[];
  presets: ShaderPreset[];
  takesImage: boolean;
}

type Lib = Record<string, unknown>;
const lib = Shaders as unknown as Lib;
const core = Core as unknown as Lib;

/** Shaders whose `image` param is an input image (filters, logo effects). */
const IMAGE_SHADERS = new Set(["FlutedGlass", "HalftoneCmyk", "GemSmoke", "LensDistortion", "HalftoneDots", "LiquidMetal", "Heatmap", "ImageDithering", "Water", "PaperTexture"]);
const IMAGE_REQUIRED = new Set(["ImageDithering", "HalftoneDots", "HalftoneCmyk", "FlutedGlass", "LensDistortion", "Heatmap"]);

/** Enum params: shader → param → name of the options object exported by @paper-design/shaders. */
const ENUMS: Record<string, Record<string, string>> = {
  "*": { fit: "ShaderFitOptions" },
  Dithering: { shape: "DitheringShapes", type: "DitheringTypes" },
  ImageDithering: { type: "DitheringTypes" },
  DotGrid: { shape: "DotGridShapes" },
  GemSmoke: { shape: "GemSmokeShapes" },
  FlutedGlass: { shape: "GlassGridShapes", distortionShape: "GlassDistortionShapes" },
  GrainGradient: { shape: "GrainGradientShapes" },
  HalftoneCmyk: { type: "HalftoneCmykTypes" },
  HalftoneDots: { type: "HalftoneDotsTypes", grid: "HalftoneDotsGrids" },
  LiquidMetal: { shape: "LiquidMetalShapes" },
  PulsingBorder: { aspectRatio: "PulsingBorderAspectRatios" },
  Warp: { shape: "WarpPatterns" },
};

/** Never shown: internal sizing and timeline values. */
const HIDDEN = new Set(["frame", "originX", "originY", "worldWidth", "worldHeight", "margin"]);
const PLACEMENT = new Set(["fit", "scale", "rotation", "offsetX", "offsetY"]);
const ANGLES = new Set(["rotation", "angle", "angle1", "angle2", "focalAngle"]);

type Range = [min: number, max: number, step: number];
/** Known numeric ranges: "Shader.param" wins over "param". */
const RANGES: Record<string, Range> = {
  speed: [0, 2, 0.01],
  scale: [0.01, 4, 0.01],
  offsetX: [-1, 1, 0.01],
  offsetY: [-1, 1, 0.01],
  "Metaballs.count": [1, 20, 1],
  "LensDistortion.count": [1, 50, 1],
  stepsPerColor: [1, 10, 1],
  bandCount: [1, 15, 1],
  octaveCount: [1, 8, 1],
  swirlIterations: [0, 20, 1],
  noiseIterations: [1, 8, 1],
  spots: [1, 4, 1],
  crumpleCount: [1, 15, 1],
  colorSteps: [1, 7, 1],
  seed: [0, 1000, 1],
  positions: [0, 100, 1],
  "Dithering.size": [0.5, 20, 0.1],
  "ImageDithering.size": [0.5, 20, 0.1],
  "DotGrid.size": [1, 100, 1],
  gapX: [2, 500, 1],
  gapY: [2, 500, 1],
  "DotGrid.strokeWidth": [0, 50, 0.5],
  "DotOrbit.size": [0, 1, 0.01],
  "ColorPanels.density": [0.25, 7, 0.01],
  "ColorPanels.length": [0, 3, 0.01],
  "SmokeRing.noiseScale": [0.01, 5, 0.01],
  "StaticRadialGradient.distortionFreq": [0, 20, 1],
  "PerlinNoise.lacunarity": [1.5, 10, 0.01],
  "PerlinNoise.persistence": [0.3, 1, 0.01],
  "HalftoneDots.radius": [0, 2, 0.01],
  "LiquidMetal.repetition": [1, 10, 0.01],
  "LiquidMetal.shiftRed": [-1, 1, 0.01],
  "LiquidMetal.shiftBlue": [-1, 1, 0.01],
  "Waves.shape": [0, 3, 0.01],
  "Waves.spacing": [0, 2, 0.01],
  "Spiral.density": [0, 1, 0.01],
  "Warp.shapeScale": [0, 1, 0.01],
  "PaperTexture.foldSizeX": [0, 1, 0.01],
  "PaperTexture.foldSizeY": [0, 1, 0.01],
};

const NO_BOUNDS_SIGNED = /offset|shift|bias|imageX|imageY/i;

function range(shader: string, key: string, value: number): Range {
  const r = RANGES[`${shader}.${key}`] ?? RANGES[key];
  if (r) return [Math.min(r[0], value), Math.max(r[1], value), r[2]];
  if (Number.isInteger(value) && value > 1) return [0, Math.max(10, value * 3), 1];
  if (value > 1) return [0, Math.max(2, Math.ceil(value * 2.5)), 0.01];
  if (value < 0 || NO_BOUNDS_SIGNED.test(key)) return [-1, 1, 0.01];
  return [0, 1, 0.01];
}

export function paramLabel(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1").replace(/([a-z])(\d)/g, "$1 $2").toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function shaderLabel(name: string): string {
  return paramLabel(name).replace(/ cmyk$/i, " CMYK");
}

const isColorString = (v: unknown): v is string => typeof v === "string" && /^(#|rgb|hsl|oklch|oklab|lab|lch|color\()/i.test(v.trim());

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function maxColors(name: string): number {
  const meta = core[`${lowerFirst(name)}Meta`] as { maxColorCount?: number } | undefined;
  return meta?.maxColorCount ?? 10;
}

function enumOptions(shader: string, key: string): string[] | null {
  const ref = ENUMS[shader]?.[key] ?? ENUMS["*"][key];
  const obj = ref ? (core[ref] as Record<string, unknown> | undefined) : undefined;
  return obj ? Object.keys(obj) : null;
}

export function presetsFor(name: string): ShaderPreset[] {
  const list = lib[`${lowerFirst(name)}Presets`];
  return Array.isArray(list) ? (list as ShaderPreset[]) : [];
}

function buildDef(name: string): ShaderDef {
  const presets = presetsFor(name);
  const defaults = presets[0]?.params ?? {};
  const params: ParamDef[] = [];
  const takesImage = IMAGE_SHADERS.has(name);
  if (takesImage) params.push({ key: "image", label: "Image", kind: "image", default: "", required: IMAGE_REQUIRED.has(name), group: "main" });
  for (const [key, value] of Object.entries(defaults)) {
    if (HIDDEN.has(key) || key === "image") continue;
    const label = paramLabel(key);
    const group: ParamGroup = PLACEMENT.has(key) ? "placement" : "main";
    const options = enumOptions(name, key);
    if (options && (typeof value === "string" || typeof value === "number")) {
      params.push({ key, label, kind: "enum", options, default: String(value), group });
    } else if (typeof value === "boolean") {
      params.push({ key, label, kind: "boolean", default: value, group });
    } else if (Array.isArray(value) && value.every(isColorString)) {
      params.push({ key, label, kind: "colors", default: value as string[], max: maxColors(name), group });
    } else if (isColorString(value)) {
      params.push({ key, label, kind: "color", default: value, group });
    } else if (typeof value === "number" && ANGLES.has(key)) {
      params.push({ key, label, kind: "angle", default: value, group });
    } else if (typeof value === "number") {
      const [min, max, step] = range(name, key, value);
      params.push({ key, label, kind: "number", min, max, step, default: value, group });
    }
  }
  // main params first, placement at the end, keeping the package's order within each group
  params.sort((a, b) => (a.group === b.group ? 0 : a.group === "main" ? -1 : 1));
  return { name, label: shaderLabel(name), params, presets, takesImage };
}

let cache: ShaderDef[] | null = null;

/** Every shader component exported by @paper-design/shaders-react, generators first, image filters last. */
export function shaderDefs(): ShaderDef[] {
  if (cache) return cache;
  const names = Object.keys(lib).filter((k) => /^[A-Z]/.test(k) && k !== "ShaderMount" && Array.isArray(lib[`${lowerFirst(k)}Presets`]));
  const defs = names.map(buildDef);
  defs.sort((a, b) => Number(a.takesImage) - Number(b.takesImage));
  cache = defs;
  return defs;
}

export function shaderDef(name: string): ShaderDef | undefined {
  return shaderDefs().find((d) => d.name === name);
}

/** Params with defaults filled in for every schema param the spec does not set. */
export function paramValue(def: ParamDef, params: Record<string, unknown>): unknown {
  const v = params[def.key];
  return v === undefined ? def.default : v;
}

/** Default params for a shader: its first preset without the hidden sizing keys. */
export function defaultParams(name: string): Record<string, unknown> {
  const preset = presetsFor(name)[0]?.params ?? {};
  return Object.fromEntries(Object.entries(preset).filter(([k]) => !HIDDEN.has(k)));
}
