import { normalizeBriefs } from "./briefs";
import { normalizeComponentFields, normalizeLibraryFields } from "./component-format";
import { createRootNode } from "./document";
import { ModelError } from "./errors";
import { stableStringify } from "./hash";
import { maxClockInIds, newFileId, nextPageId, nextTokenId, rootIdFor } from "./ids";
import { canContain, defaultNodeName, NODE_TYPES, PAGE_ICONS, TOKEN_TYPES } from "./nodes";
import { MODE_NAME_RE, normalizeModeName, parseModeList } from "./modes";
import { normalizeSpans, spansText } from "./spans";
import { normalizeTokenName, textStyleSlug } from "./tokens";
import { FORMAT_VERSION } from "./version";
import type {
  AssetMeta, FoldDocument, ModeCollection, NodeType, OFNode, Page, PageIcon, PageListItem, TextSpan, TextStyle, Token,
} from "./types";

export { FORMAT_VERSION };

export const APP_ID = "opencrease 0.1.0";

export interface FoldManifest {
  formatVersion: typeof FORMAT_VERSION;
  id: string;
  name: string;
  app: string;
}

/**
 * `.fold` contents for `manifest.json` and `document.json`. The JSON has sorted object keys and
 * 2-space indentation (arrays keep their order), so the same document always produces the same bytes.
 */
export function serializeFold(doc: FoldDocument): { manifest: FoldManifest; documentJson: string } {
  return {
    manifest: { formatVersion: FORMAT_VERSION, id: doc.id, name: doc.name, app: APP_ID },
    documentJson: `${stableStringify(doc, 2)}\n`,
  };
}

/** Parses `document.json`, checks `formatVersion` and repairs/fills missing fields. */
export function parseFold(documentJson: string): FoldDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(documentJson);
  } catch (err) {
    throw new ModelError("invalid_format", `document.json is not valid JSON: ${(err as Error).message}`);
  }
  return normalizeDocument(raw);
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Validates an already-parsed document object and fills defaults. Does not mutate the input. */
export function normalizeDocument(input: unknown): FoldDocument {
  if (!isObj(input)) throw new ModelError("invalid_format", "Document must be a JSON object");
  if (input.formatVersion === undefined) throw new ModelError("invalid_format", "Missing formatVersion");
  if (input.formatVersion !== FORMAT_VERSION) {
    throw new ModelError("unsupported_version", `Unsupported formatVersion ${String(input.formatVersion)} (expected ${FORMAT_VERSION})`);
  }
  const now = Date.now();
  const createdAt = num(input.createdAt, now);
  const doc: FoldDocument = {
    formatVersion: FORMAT_VERSION,
    id: str(input.id, "") || newFileId(),
    name: str(input.name, "").trim() || "Untitled",
    createdAt,
    updatedAt: num(input.updatedAt, createdAt),
    pageList: [],
    pages: {},
    nodes: {},
    tokens: [],
    assets: {},
    clock: Math.max(0, Math.floor(num(input.clock, 0))),
    clientId: str(input.clientId, "") || "0",
  };

  for (const [id, value] of Object.entries(isObj(input.nodes) ? input.nodes : {})) {
    const node = normalizeNode(id, value);
    if (node) doc.nodes[id] = node;
  }
  for (const [id, value] of Object.entries(isObj(input.pages) ? input.pages : {})) {
    if (!isObj(value)) continue;
    const rootId = str(value.rootId, "") || rootIdFor(id);
    const icon = PAGE_ICONS.includes(value.icon as PageIcon) ? (value.icon as PageIcon) : null;
    const page: Page = { id, name: str(value.name, "").trim() || "Page", icon, rootId };
    if (doc.nodes[rootId]?.type !== "Root") doc.nodes[rootId] = createRootNode(rootId);
    doc.pages[id] = page;
  }

  repairTrees(doc);

  const seenItems = new Set<string>();
  for (const value of Array.isArray(input.pageList) ? input.pageList : []) {
    if (!isObj(value) || typeof value.id !== "string" || seenItems.has(value.id)) continue;
    if (value.type === "page" && doc.pages[value.id]) doc.pageList.push({ type: "page", id: value.id });
    else if (value.type === "divider") doc.pageList.push({ type: "divider", id: value.id });
    else continue;
    seenItems.add(value.id);
  }
  for (const id of Object.keys(doc.pages)) {
    if (!seenItems.has(id)) doc.pageList.push({ type: "page", id } satisfies PageListItem);
  }

  const tokenNames = new Set<string>();
  for (const value of Array.isArray(input.tokens) ? input.tokens : []) {
    const token = normalizeToken(value);
    if (!token || tokenNames.has(token.name)) continue;
    tokenNames.add(token.name);
    doc.tokens.push(token);
  }

  normalizeModesAndStyles(doc, input);

  for (const [hash, value] of Object.entries(isObj(input.assets) ? input.assets : {})) {
    if (!isObj(value) || typeof value.mime !== "string") continue;
    doc.assets[hash] = { ...(value as unknown as AssetMeta), hash };
  }

  Object.assign(doc, normalizeLibraryFields(input, normalizeNode, normalizeToken));

  const briefs = normalizeBriefs(input.briefs, doc.nodes);
  if (briefs) doc.briefs = briefs;
  doc.clock = Math.max(doc.clock, maxClockInIds(doc));
  for (const token of doc.tokens) if (!token.id) token.id = nextTokenId(doc);
  if (Object.keys(doc.pages).length === 0) {
    const id = nextPageId(doc);
    const rootId = rootIdFor(id);
    doc.nodes[rootId] = createRootNode(rootId);
    doc.pages[id] = { id, name: "Page 1", icon: null, rootId };
    doc.pageList.push({ type: "page", id });
  }
  return doc;
}

/**
 * Mode collections, per-mode token values, text styles and the node fields that point at them. All are
 * optional: files without them load unchanged, and dangling references are dropped.
 */
function normalizeModesAndStyles(doc: FoldDocument, input: Obj): void {
  const collections: ModeCollection[] = [];
  const allModes = new Set<string>();
  for (const value of Array.isArray(input.modeCollections) ? input.modeCollections : []) {
    if (!isObj(value) || typeof value.name !== "string" || !value.name.trim() || !Array.isArray(value.modes)) continue;
    const modes = value.modes.map((m) => normalizeModeName(String(m))).filter((m) => MODE_NAME_RE.test(m) && !allModes.has(m));
    const unique = [...new Set(modes)];
    if (!unique.length || collections.some((c) => c.name === value.name)) continue;
    unique.forEach((m) => allModes.add(m));
    collections.push({ id: str(value.id, "") || `m-${collections.length + 1}-${doc.clientId}`, name: value.name.trim(), modes: unique });
  }
  if (collections.length) doc.modeCollections = collections;
  const defaults = new Set(collections.map((c) => c.modes[0]));
  const rawTokens = new Map<string, Obj>();
  for (const value of Array.isArray(input.tokens) ? input.tokens : []) {
    if (isObj(value) && typeof value.name === "string") rawTokens.set(normalizeTokenName(value.name), value);
  }
  for (const token of doc.tokens) {
    const raw = rawTokens.get(token.name)?.modes;
    if (!isObj(raw)) continue;
    const modes: Record<string, string | number> = {};
    let collection: string | undefined;
    for (const [m, v] of Object.entries(raw)) {
      const c = collections.find((x) => x.modes.includes(m));
      if (!c || defaults.has(m) || (collection && collection !== c.id)) continue;
      if (!(typeof v === "string" && v.trim()) && !(typeof v === "number" && Number.isFinite(v))) continue;
      collection = c.id;
      modes[m] = v;
    }
    if (Object.keys(modes).length) token.modes = modes;
  }

  const styles: TextStyle[] = [];
  for (const value of Array.isArray(input.textStyles) ? input.textStyles : []) {
    if (!isObj(value) || typeof value.name !== "string" || !value.name.trim()) continue;
    const slug = textStyleSlug(value.name);
    if (!slug || styles.some((s) => textStyleSlug(s.name) === slug)) continue;
    const map: TextStyle["styles"] = {};
    if (isObj(value.styles)) {
      for (const [k, v] of Object.entries(value.styles)) {
        if ((typeof v === "string" && v !== "") || (typeof v === "number" && Number.isFinite(v))) map[k] = v;
      }
    }
    const style: TextStyle = { id: str(value.id, "") || `s-${styles.length + 1}-${doc.clientId}`, name: value.name.trim(), styles: map };
    if (typeof value.description === "string" && value.description) style.description = value.description.slice(0, 1024);
    styles.push(style);
  }
  if (styles.length) doc.textStyles = styles;
  const styleIds = new Set(styles.map((s) => s.id));

  const rawNodes = isObj(input.nodes) ? input.nodes : {};
  for (const node of Object.values(doc.nodes)) {
    const raw = rawNodes[node.id];
    if (!isObj(raw)) continue;
    if (node.type === "Text" && Array.isArray(raw.spans)) {
      const spans = normalizeSpans(
        raw.spans.filter(isObj).map((s) => ({ text: str(s.text, ""), styles: isObj(s.styles) ? (s.styles as TextSpan["styles"]) : undefined })),
      );
      if (spans && spansText(spans) === node.text) node.spans = spans;
    }
    if (node.type === "Frame" && typeof raw.mode === "string") {
      const mode = parseModeList(raw.mode).filter((m) => allModes.has(m)).join(" ");
      if (mode) node.mode = mode;
    }
    if (node.type === "Text" && typeof raw.textStyle === "string" && styleIds.has(raw.textStyle)) node.textStyle = raw.textStyle;
  }
}

/**
 * Walks every page tree from its Root: drops dangling or structurally invalid child references,
 * keeps each node under a single parent, fixes `parentId`, and removes nodes no page can reach.
 */
function repairTrees(doc: FoldDocument): void {
  const reached = new Set<string>();
  const walk = (node: OFNode) => {
    node.children = node.children.filter((c) => {
      const child = doc.nodes[c];
      if (!child || reached.has(c) || !canContain(node.type, child.type)) return false;
      reached.add(c);
      return true;
    });
    for (const c of node.children) {
      doc.nodes[c].parentId = node.id;
      walk(doc.nodes[c]);
    }
  };
  for (const page of Object.values(doc.pages)) {
    const root = doc.nodes[page.rootId];
    reached.add(root.id);
    root.parentId = null;
    walk(root);
  }
  for (const id of Object.keys(doc.nodes)) if (!reached.has(id)) delete doc.nodes[id];
}

const H_CONSTRAINTS = ["left", "right", "center", "scale", "stretch"];
const V_CONSTRAINTS = ["top", "bottom", "center", "scale", "stretch"];

function normalizeConstraints(value: Record<string, unknown>): OFNode["constraints"] | undefined {
  const horizontal = H_CONSTRAINTS.includes(String(value.horizontal)) ? (value.horizontal as NonNullable<OFNode["constraints"]>["horizontal"]) : "left";
  const vertical = V_CONSTRAINTS.includes(String(value.vertical)) ? (value.vertical as NonNullable<OFNode["constraints"]>["vertical"]) : "top";
  return horizontal === "left" && vertical === "top" ? undefined : { horizontal, vertical };
}

function normalizeGen(g: Obj): NonNullable<OFNode["gen"]> {
  const out: NonNullable<OFNode["gen"]> = { prompt: String(g.prompt), target: g.target === "fill" ? "fill" : "src" };
  if (typeof g.provider === "string" && g.provider) out.provider = g.provider;
  if (typeof g.model === "string" && g.model) out.model = g.model;
  for (const k of ["seed", "width", "height"] as const) {
    const v = g[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  if (g.edit === true) out.edit = true;
  return out;
}

function normalizeNode(id: string, value: unknown): OFNode | undefined {
  if (!isObj(value)) return undefined;
  const type = value.type as NodeType;
  if (!NODE_TYPES.includes(type)) return undefined;
  const node: OFNode = {
    id,
    type,
    name: "",
    parentId: type === "Root" ? null : str(value.parentId, "") || null,
    children: Array.isArray(value.children) ? value.children.filter((c): c is string => typeof c === "string") : [],
    visible: value.visible !== false,
    locked: value.locked === true,
    styles: {},
  };
  if (isObj(value.styles)) {
    for (const [k, v] of Object.entries(value.styles)) {
      if (typeof v === "string" || (typeof v === "number" && Number.isFinite(v))) node.styles[k] = v;
    }
  }
  if (type === "Text") node.text = str(value.text, "");
  if (typeof value.src === "string") node.src = value.src;
  if (typeof value.tag === "string") node.tag = value.tag;
  else if (type === "SVG") node.tag = "svg";
  if (isObj(value.attrs)) {
    node.attrs = Object.fromEntries(Object.entries(value.attrs).map(([k, v]) => [k, String(v)]));
  }
  if (isObj(value.shader) && typeof value.shader.name === "string") {
    node.shader = { name: value.shader.name, params: isObj(value.shader.params) ? value.shader.params : {} };
  }
  if (Array.isArray(value.exports)) node.exports = value.exports as OFNode["exports"];
  if (isObj(value.paint)) node.paint = value.paint as OFNode["paint"];
  if (isObj(value.constraints)) {
    const c = normalizeConstraints(value.constraints);
    if (c) node.constraints = c;
  }
  normalizeComponentFields(value, node);
  if (isObj(value.gen) && typeof value.gen.prompt === "string" && value.gen.prompt) node.gen = normalizeGen(value.gen);
  node.name = str(value.name, "").trim() || defaultNodeName(node);
  return node;
}

function normalizeToken(value: unknown): Token | undefined {
  if (!isObj(value) || typeof value.name !== "string") return undefined;
  if (!TOKEN_TYPES.includes(value.type as Token["type"])) return undefined;
  if (typeof value.value !== "string" && typeof value.value !== "number") return undefined;
  const token: Token = {
    id: str(value.id, ""),
    type: value.type as Token["type"],
    name: normalizeTokenName(value.name),
    value: value.value,
  };
  if (typeof value.description === "string" && value.description) token.description = value.description;
  return token;
}
