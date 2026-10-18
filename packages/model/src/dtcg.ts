// W3C Design Tokens Community Group (DTCG) JSON: export and import.
//
// Export groups tokens by OpenCrease type ({"color": {"primary": {"$type": "color", "$value": "#f00"}}}),
// writes aliases as DTCG references ("{color.primary}") and keeps what DTCG has no field for in
// `$extensions`: the exact CSS name, the OpenCrease type, and per-mode values with the mode collections.
// Import accepts any DTCG file (nested groups, inherited `$type`, object dimensions) plus those extensions.
import { modeCollections } from "./modes";
import { normalizeTokenName, parseAlias, TAILWIND_NAMESPACES } from "./tokens";
import type { FoldDocument, ModeCollection, Token, TokenType } from "./types";
import { TOKEN_TYPES } from "./nodes";

const EXT = "opencrease";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

const DTCG_TYPE: Record<TokenType, string> = {
  color: "color",
  spacing: "dimension",
  radius: "dimension",
  fontSize: "dimension",
  letterSpacing: "dimension",
  container: "dimension",
  breakpoint: "dimension",
  fontFamily: "fontFamily",
  fontWeight: "fontWeight",
  lineHeight: "number",
  opacity: "number",
};

const PX_TYPES = new Set<TokenType>(["spacing", "radius", "fontSize", "letterSpacing", "container", "breakpoint"]);

/** Key of a token inside its type group: the name without `--` and without the type's namespace prefix. */
function shortName(t: Pick<Token, "type" | "name">): string {
  const name = normalizeTokenName(t.name);
  const ns = TAILWIND_NAMESPACES[t.type];
  if (name.startsWith(ns) && name.length > ns.length) return name.slice(ns.length);
  return name.slice(2);
}

function splitFamilies(value: string): string[] {
  return value
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function exportValue(t: Token, value: string | number, paths: Map<string, string>): unknown {
  const alias = parseAlias(value);
  if (alias && paths.has(alias.name)) return `{${paths.get(alias.name)}}`;
  if (typeof value === "number") return PX_TYPES.has(t.type) ? `${value}px` : value;
  if (t.type === "fontFamily" && !alias) {
    const fams = splitFamilies(value);
    return fams.length === 1 ? fams[0] : fams;
  }
  if (t.type === "fontWeight" && /^\d+$/.test(value)) return Number(value);
  return value;
}

/** DTCG JSON document for the file's tokens (pretty-printed). */
export function tokensToDtcg(doc: Pick<FoldDocument, "tokens" | "modeCollections">): string {
  const paths = new Map<string, string>();
  const out: Json = {};
  for (const t of doc.tokens) paths.set(normalizeTokenName(t.name), `${t.type}.${shortName(t)}`);
  for (const t of doc.tokens) {
    const group = (out[t.type] ??= { $type: DTCG_TYPE[t.type] }) as Json;
    const entry: Json = { $value: exportValue(t, t.value, paths) };
    if (t.description) entry.$description = t.description;
    const ext: Json = { name: normalizeTokenName(t.name), type: t.type };
    if (t.modes && Object.keys(t.modes).length) {
      ext.modes = Object.fromEntries(Object.entries(t.modes).map(([m, v]) => [m, exportValue(t, v, paths)]));
    }
    entry.$extensions = { [EXT]: ext };
    group[shortName(t)] = entry;
  }
  const collections = modeCollections(doc);
  if (collections.length) out.$extensions = { [EXT]: { modeCollections: collections.map((c) => ({ name: c.name, modes: [...c.modes] })) } };
  return `${JSON.stringify(out, null, 2)}\n`;
}

// ---------------------------------------------------------------------------------------------
// Import

export interface DtcgImport {
  tokens: Array<{ type: TokenType; name: string; value: string | number; description?: string; modes?: Record<string, string | number> }>;
  modeCollections: Array<Pick<ModeCollection, "name" | "modes">>;
  warnings: string[];
}

function guessDimensionType(path: string[]): TokenType {
  const p = path.join("-").toLowerCase();
  if (/radius|radii|rounded|corner/.test(p)) return "radius";
  if (/letter|tracking/.test(p)) return "letterSpacing";
  if (/font-?size|^text|typescale|type-?scale|^size-text/.test(p)) return "fontSize";
  if (/breakpoint|screen|^bp/.test(p)) return "breakpoint";
  if (/container|max-?width/.test(p)) return "container";
  if (/line-?height|leading/.test(p)) return "lineHeight";
  return "spacing";
}

function guessNumberType(path: string[], value: unknown): TokenType {
  const p = path.join("-").toLowerCase();
  if (/opacity|alpha/.test(p)) return "opacity";
  if (/weight/.test(p)) return "fontWeight";
  if (/line|leading/.test(p)) return "lineHeight";
  return typeof value === "number" && value >= 0 && value <= 1 ? "opacity" : "lineHeight";
}

function typeFor(dtcgType: string | undefined, path: string[], value: unknown): TokenType | null {
  const first = path[0];
  switch (dtcgType) {
    case "color":
      return "color";
    case "dimension":
      return (TOKEN_TYPES as readonly string[]).includes(first) && PX_TYPES.has(first as TokenType) ? (first as TokenType) : guessDimensionType(path);
    case "fontFamily":
      return "fontFamily";
    case "fontWeight":
      return "fontWeight";
    case "number":
      return first === "lineHeight" || first === "opacity" ? first : guessNumberType(path, value);
    case undefined:
      return (TOKEN_TYPES as readonly string[]).includes(first) ? (first as TokenType) : null;
    default:
      return null;
  }
}

function dimensionValue(v: unknown): string | number | null {
  if (typeof v === "number" || typeof v === "string") return v;
  if (isObj(v) && typeof v.value === "number" && typeof v.unit === "string") return `${v.value}${v.unit}`;
  return null;
}

function familyValue(v: unknown): string | null {
  const list = Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : null;
  if (!list) return null;
  return list.map((f) => (/[\s]/.test(f) && !/^["']/.test(f) && !/^(ui-|system-ui|sans-serif|serif|monospace)/.test(f) ? `"${f}"` : f)).join(", ");
}

function colorValue(v: unknown): string | null {
  if (typeof v === "string") return v;
  // DTCG 2025 colour objects: { colorSpace, components, alpha?, hex? }
  if (isObj(v)) {
    if (typeof v.hex === "string") return v.hex;
    if (typeof v.colorSpace === "string" && Array.isArray(v.components)) {
      const comps = v.components.map((c) => (c === "none" ? "none" : String(c))).join(" ");
      const alpha = typeof v.alpha === "number" && v.alpha !== 1 ? ` / ${v.alpha}` : "";
      const space = v.colorSpace;
      if (space === "srgb") return `color(srgb ${comps}${alpha})`;
      if (["oklch", "oklab", "lab", "lch", "hsl", "hwb"].includes(space)) return `${space}(${comps}${alpha})`;
      return `color(${space} ${comps}${alpha})`;
    }
  }
  return null;
}

/** Parses DTCG JSON (string or object). Never throws for content problems; they become warnings. */
export function parseDtcg(input: string | unknown): DtcgImport {
  const result: DtcgImport = { tokens: [], modeCollections: [], warnings: [] };
  let root: unknown = input;
  if (typeof input === "string") {
    try {
      root = JSON.parse(input);
    } catch (e) {
      result.warnings.push(`Not valid JSON: ${(e as Error).message}`);
      return result;
    }
  }
  if (!isObj(root)) {
    result.warnings.push("Expected a JSON object of token groups.");
    return result;
  }
  const rootExt = isObj(root.$extensions) ? root.$extensions[EXT] : undefined;
  if (isObj(rootExt) && Array.isArray(rootExt.modeCollections)) {
    for (const c of rootExt.modeCollections) {
      if (isObj(c) && typeof c.name === "string" && Array.isArray(c.modes)) result.modeCollections.push({ name: c.name, modes: c.modes.map(String) });
    }
  }

  interface Raw { path: string[]; type: TokenType; value: unknown; description?: string; name?: string; modes?: Json }
  const raws: Raw[] = [];
  const walk = (node: Json, path: string[], inheritedType: string | undefined) => {
    const groupType = typeof node.$type === "string" ? node.$type : inheritedType;
    if ("$value" in node) {
      const ext = isObj(node.$extensions) && isObj(node.$extensions[EXT]) ? (node.$extensions[EXT] as Json) : undefined;
      const explicit = ext && typeof ext.type === "string" && (TOKEN_TYPES as readonly string[]).includes(ext.type) ? (ext.type as TokenType) : null;
      const type = explicit ?? typeFor(groupType, path, node.$value);
      if (!type) {
        result.warnings.push(`Skipped ${path.join(".")}: ${groupType ?? "untyped"} tokens have no OpenCrease equivalent.`);
        return;
      }
      raws.push({
        path,
        type,
        value: node.$value,
        description: typeof node.$description === "string" ? node.$description : undefined,
        name: ext && typeof ext.name === "string" ? ext.name : undefined,
        modes: ext && isObj(ext.modes) ? ext.modes : undefined,
      });
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith("$") || !isObj(v)) continue;
      walk(v, [...path, k], groupType);
    }
  };
  walk(root, [], undefined);

  const slug = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const names = new Map<string, string>(); // dotted path → css name
  for (const r of raws) names.set(r.path.join("."), normalizeTokenName(r.name ?? `--${r.path.map(slug).filter(Boolean).join("-")}`));

  const convert = (r: Raw, v: unknown): string | number | null => {
    if (typeof v === "string") {
      const ref = /^\{([^}]+)\}$/.exec(v.trim());
      if (ref) {
        const target = names.get(ref[1]);
        if (!target) {
          result.warnings.push(`${r.path.join(".")} references {${ref[1]}}, which is not in the file.`);
          return null;
        }
        return `var(${target})`;
      }
    }
    switch (r.type) {
      case "color":
        return colorValue(v);
      case "fontFamily":
        return familyValue(v);
      case "fontWeight":
        return typeof v === "number" ? v : typeof v === "string" ? (/^\d+$/.test(v) ? Number(v) : v) : null;
      case "lineHeight":
      case "opacity":
        return typeof v === "number" || typeof v === "string" ? v : null;
      default:
        return dimensionValue(v);
    }
  };

  for (const r of raws) {
    const value = convert(r, r.value);
    if (value === null || value === "") {
      result.warnings.push(`Skipped ${r.path.join(".")}: unsupported value.`);
      continue;
    }
    const token: DtcgImport["tokens"][number] = { type: r.type, name: names.get(r.path.join("."))!, value };
    if (r.description) token.description = r.description.slice(0, 1024);
    if (r.modes) {
      const modes: Record<string, string | number> = {};
      for (const [m, mv] of Object.entries(r.modes)) {
        const v = convert(r, mv);
        if (v !== null && v !== "") modes[m] = v;
      }
      if (Object.keys(modes).length) token.modes = modes;
    }
    result.tokens.push(token);
  }
  return result;
}
