// Required steps of the design quality layer (SPEC §8.5), enforced around agent writes. Pure.
//   brief        write_html into an artboard of a file without tokens needs a brief (soft error)
//   review       review checkpoints (see review.ts)
//   tokens       raw colours and sizes that equal a token value get a warning naming the token
//   small-steps  a write_html that adds a very large tree gets a warning
import { colorsEqual, findColorsInValue, htmlToTrees, normalizeStyles, parseColor } from "@opencrease/css";
import { artboardOf, briefFor, getNode, resolveToken, type FoldDocument, type NodeTree, type StyleMap, type TokenType } from "@opencrease/model";
import { SMALL_STEP_LAYER_LIMIT, type RequiredStep } from "@opencrease/protocol";

/** Steps used when a call comes without a policy (unit tests, plugins): only review nudges, as before. */
export const LEGACY_STEPS: RequiredStep[] = ["review"];

// ---------------------------------------------------------------------------------- brief first

/** Soft error text when write_html must wait for a brief, or null when the write may go ahead. */
export function briefGate(doc: FoldDocument, targetNodeId: unknown, steps: readonly RequiredStep[]): string | null {
  if (!steps.includes("brief")) return null;
  if (doc.tokens.length > 0) return null;
  const target = typeof targetNodeId === "string" ? getNode(doc, targetNodeId) : undefined;
  if (!target) return null; // the tool reports the bad id itself
  const board = target.type === "Root" ? undefined : artboardOf(doc, target.id);
  if (briefFor(doc, board?.id)) return null;
  const where = board ? `"${board.name}"` : "this file";
  return [
    `Brief first: ${where} has no design brief and the file has no tokens yet, so nothing was written.`,
    `Call oc_post_brief with fileId${board ? `, artboardId "${board.id}"` : ""} and a mood, palette, type and direction (or create the file's tokens with create_tokens), then send this write_html again.`,
    `The user can switch this step off for the file in Settings, Design guide.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------------- small steps

export function countLayers(trees: NodeTree[]): number {
  let n = 0;
  const visit = (t: NodeTree) => {
    n++;
    t.children?.forEach(visit);
  };
  trees.forEach(visit);
  return n;
}

export function smallStepsWarning(layers: number, limit = SMALL_STEP_LAYER_LIMIT): string | null {
  if (layers <= limit) return null;
  return `Small steps: this write_html added ${layers} layers in one call (the guide asks for at most about ${limit}). Build one visual group per call, a nav bar, a heading block or one card, so the user can follow along and stop you early. Repeat items with duplicate_nodes instead of writing them out.`;
}

// ---------------------------------------------------------------------------------- tokens over literals

const COLOR_PROPS = new Set([
  "color", "backgroundColor", "background", "backgroundImage", "borderColor", "borderTopColor", "borderRightColor",
  "borderBottomColor", "borderLeftColor", "border", "borderTop", "borderRight", "borderBottom", "borderLeft",
  "outline", "outlineColor", "boxShadow", "textShadow", "fill", "stroke", "textDecorationColor", "caretColor",
  "WebkitTextStrokeColor", "WebkitTextStroke",
]);

const SIZE_PROPS: Record<string, TokenType> = {
  width: "container", minWidth: "container", maxWidth: "container", flexBasis: "container",
  padding: "spacing", paddingTop: "spacing", paddingRight: "spacing", paddingBottom: "spacing", paddingLeft: "spacing",
  paddingInline: "spacing", paddingBlock: "spacing", gap: "spacing", rowGap: "spacing", columnGap: "spacing",
  borderRadius: "radius", borderTopLeftRadius: "radius", borderTopRightRadius: "radius", borderBottomLeftRadius: "radius", borderBottomRightRadius: "radius",
  fontSize: "fontSize", lineHeight: "lineHeight", letterSpacing: "letterSpacing",
};

export interface LiteralMatch {
  literal: string;
  token: string;
  props: string[];
  count: number;
}

function normSize(v: string | number): string | null {
  if (typeof v === "number") return Number.isFinite(v) && v !== 0 ? `${v}px` : null;
  const s = v.trim().toLowerCase();
  if (!s || s.includes("var(") || /^0(px|em|rem|%)?$/.test(s)) return null;
  const m = /^(-?\d*\.?\d+)(px|em|rem|%)?$/.exec(s);
  if (!m) return null;
  return `${Number(m[1])}${m[2] ?? "px"}`;
}

/** Literal colours and sizes in `styles` that equal one of the document's token values. */
export function literalTokenMatches(doc: FoldDocument, styleMaps: StyleMap[]): LiteralMatch[] {
  if (!doc.tokens.length) return [];
  const colorTokens: Array<{ name: string; value: string }> = [];
  const sizeTokens = new Map<TokenType, Array<{ name: string; value: string }>>();
  for (const t of doc.tokens) {
    const resolved = resolveToken(doc, t.name);
    if (resolved === undefined) continue;
    if (t.type === "color") {
      const v = String(resolved);
      if (parseColor(v)) colorTokens.push({ name: t.name, value: v });
    } else if (Object.values(SIZE_PROPS).includes(t.type)) {
      const v = normSize(resolved);
      if (!v) continue;
      const list = sizeTokens.get(t.type) ?? [];
      list.push({ name: t.name, value: v });
      sizeTokens.set(t.type, list);
    }
  }

  const found = new Map<string, LiteralMatch>();
  const note = (literal: string, token: string, prop: string) => {
    const key = `${literal}\u0000${token}`;
    const m = found.get(key) ?? { literal, token, props: [], count: 0 };
    m.count++;
    if (!m.props.includes(prop)) m.props.push(prop);
    found.set(key, m);
  };

  for (const styles of styleMaps) {
    for (const [prop, raw] of Object.entries(styles)) {
      if (raw === "" || raw === null || raw === undefined) continue;
      const value = String(raw);
      if (COLOR_PROPS.has(prop) && colorTokens.length) {
        const literals = findColorsInValue(value).filter((c) => !c.startsWith("var("));
        // plain colour properties may hold a named colour ("white") that the scanner skips
        if (!literals.length && !value.includes("var(") && parseColor(value)) literals.push(value.trim());
        for (const lit of literals) {
          const hit = colorTokens.find((t) => colorsEqual(t.value, lit));
          if (hit) note(lit, hit.name, prop);
        }
      }
      const type = SIZE_PROPS[prop];
      if (type) {
        const tokens = sizeTokens.get(type);
        if (!tokens?.length) continue;
        for (const part of typeof raw === "number" ? [raw] : value.split(/\s+/)) {
          const v = normSize(part);
          if (!v) continue;
          const hit = tokens.find((t) => t.value === v);
          if (hit) note(typeof part === "number" ? `${part}px` : part, hit.name, prop);
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count);
}

export function tokensWarning(matches: LiteralMatch[], max = 8): string | null {
  if (!matches.length) return null;
  const lines = matches.slice(0, max).map((m) => `- ${m.literal} in ${m.props.join(", ")}${m.count > 1 ? ` (${m.count} times)` : ""}: use var(${m.token})`);
  if (matches.length > max) lines.push(`- and ${matches.length - max} more`);
  return `Tokens over literals: these raw values equal tokens in this file. Reference the tokens instead, for example with update_styles:\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------------- per tool

/** Style maps a write tool is about to apply, from its arguments. */
export function stylesOfCall(tool: string, args: Record<string, unknown>): { styles: StyleMap[]; trees?: NodeTree[] } {
  if (tool === "write_html") {
    const { trees } = htmlToTrees(String(args.html ?? ""));
    const styles: StyleMap[] = [];
    const visit = (t: NodeTree) => {
      if (t.styles) styles.push(t.styles);
      t.children?.forEach(visit);
    };
    trees.forEach(visit);
    return { styles, trees };
  }
  if (tool === "update_styles") {
    const updates = Array.isArray(args.updates) ? (args.updates as Array<{ styles?: Record<string, unknown> }>) : [];
    return { styles: updates.map((u) => normalizeStyles(u.styles ?? {}).styles) };
  }
  if (tool === "create_artboard") return { styles: [normalizeStyles((args.styles as Record<string, unknown>) ?? {}).styles] };
  return { styles: [] };
}

/** Warnings to append to a successful write. */
export function qualityWarnings(tool: string, args: Record<string, unknown>, doc: FoldDocument, steps: readonly RequiredStep[]): string[] {
  const wantTokens = steps.includes("tokens");
  const wantSmall = steps.includes("small-steps") && tool === "write_html";
  if (!wantTokens && !wantSmall) return [];
  let parsed: ReturnType<typeof stylesOfCall>;
  try {
    parsed = stylesOfCall(tool, args);
  } catch {
    return [];
  }
  const out: string[] = [];
  if (wantSmall && parsed.trees) {
    const w = smallStepsWarning(countLayers(parsed.trees));
    if (w) out.push(w);
  }
  if (wantTokens) {
    const w = tokensWarning(literalTokenMatches(doc, parsed.styles));
    if (w) out.push(w);
  }
  return out;
}
