import type { Tx } from "./contracts";
import { buildInstanceTree, ComponentHooks } from "./components";
import { addPage } from "./document";
import { ModelError } from "./errors";
import { nextDividerId, nextNodeId, nextPrefixedId, nextTokenId } from "./ids";
import { collectionOfMode, findModeCycle, MODE_NAME_RE, normalizeModeName, parseModeList, tokenCollection } from "./modes";
import { normalizeSpans, spansText } from "./spans";
import { canContain, canHaveChildren, defaultNodeName, inferNodeType, PAGE_ICONS, TOKEN_TYPES } from "./nodes";
import { findToken, getNode, getPage, isAncestor } from "./queries";
import { normalizeTokenName, textStyleSlug } from "./tokens";
import type {
  AssetMeta, FoldDocument, ModeCollection, NodeId, NodeTree, NodeType, OFNode, PageIcon, PageId, PageListItem, StyleMap,
  TextSpan, TextStyle, Token,
} from "./types";

type NodePatch = Parameters<Tx["updateNode"]>[1];
type TokenInput = Parameters<Tx["createToken"]>[0];

const OPTIONAL_FIELDS = ["text", "src", "tag", "attrs", "shader", "exports", "paint", "gen"] as const;
const FIELD_TYPES: Record<(typeof OPTIONAL_FIELDS)[number] | "spans" | "mode" | "textStyle", ReadonlySet<NodeType> | null> = {
  text: new Set(["Text"]),
  src: new Set(["Image"]),
  tag: new Set(["SVG", "SVGElement"]),
  attrs: new Set(["SVG", "SVGElement"]),
  shader: new Set(["Shader"]),
  exports: null,
  paint: null,
  gen: null,
  spans: new Set(["Text"]),
  mode: new Set(["Frame"]),
  textStyle: new Set(["Text"]),
};
const H_CONSTRAINTS: ReadonlySet<string> = new Set(["left", "right", "center", "scale", "stretch"]);
const V_CONSTRAINTS: ReadonlySet<string> = new Set(["top", "bottom", "center", "scale", "stretch"]);
const INSERTABLE: ReadonlySet<string> = new Set(["Frame", "Text", "Rectangle", "Image", "SVG", "SVGElement", "Shader"]);
const TOKEN_NAME_RE = /^--[A-Za-z0-9_-]+$/;
const MAX_DESCRIPTION = 1024;

function fail(code: ModelError["code"], message: string): never {
  throw new ModelError(code, message);
}

/** Plain deep copy; works on immer drafts as well as plain objects. */
function copy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined || Number.isNaN(index)) return length;
  return Math.min(Math.max(Math.trunc(index), 0), length);
}

function checkStyleValue(key: string, value: unknown): void {
  if (typeof value === "string") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  fail("invalid_argument", `Style "${key}" must be a string or a finite number`);
}

/** Copy of a style map without empty values; throws on non string/number values. */
function cleanStyles(styles: StyleMap | undefined): StyleMap {
  const out: StyleMap = {};
  if (!styles) return out;
  for (const [key, value] of Object.entries(styles)) {
    if (value === "" || value === null || value === undefined) continue;
    checkStyleValue(key, value);
    out[key] = value;
  }
  return out;
}

/** Mutation API over a mutable document (an immer draft inside `DocStore.transact`). */
export class TxImpl implements Tx {
  /** Component bookkeeping: override capture, instance structure guards and the instance sync pass. */
  readonly components: ComponentHooks;

  constructor(readonly doc: FoldDocument) {
    this.components = new ComponentHooks(doc);
  }

  /** Regenerates instances affected by this transaction. DocStore calls it before committing. */
  finalize(): void {
    this.components.finalize();
  }

  // ---- nodes ----

  private node(id: NodeId): OFNode {
    return getNode(this.doc, id) ?? fail("not_found", `Node ${id} not found`);
  }

  private assertContain(parent: OFNode, childType: NodeType): void {
    if (!canContain(parent.type, childType)) {
      fail("invalid_parent", `${parent.type} ${parent.id} cannot contain a ${childType}`);
    }
  }

  insertTrees(parentId: NodeId, trees: NodeTree[], index?: number): NodeId[] {
    const parent = this.node(parentId);
    if (!Array.isArray(trees)) fail("invalid_argument", "trees must be an array");
    this.components.guardStructure(parentId);
    this.components.touch(parentId);
    const ids = trees.map((tree) => this.buildTree(tree, parent));
    parent.children.splice(clampIndex(index, parent.children.length), 0, ...ids);
    return ids;
  }

  private buildTree(tree: NodeTree, parent: OFNode): NodeId {
    if (!tree || typeof tree !== "object") fail("invalid_tree", "Each tree must be an object");
    if (tree.cloneOf !== undefined) return this.buildClone(tree, parent);
    if (tree.instance) {
      this.assertContain(parent, "Frame");
      return buildInstanceTree(this, tree, parent.id, () => this.buildTree({ ...tree, instance: undefined, type: "Frame" }, parent));
    }

    const type = inferNodeType(tree);
    if (!INSERTABLE.has(type)) fail("invalid_tree", `Unknown node type "${String(type)}"`);
    this.assertContain(parent, type);
    const children = tree.children ?? [];
    if (children.length > 0 && !canHaveChildren(type)) fail("invalid_tree", `${type} nodes cannot have children`);
    if (type === "SVGElement" && !tree.tag) fail("invalid_tree", "SVGElement nodes need a tag");
    if (type === "Shader" && !tree.shader?.name) fail("invalid_tree", "Shader nodes need a shader spec");

    const id = nextNodeId(this.doc);
    const node: OFNode = {
      id,
      type,
      name: "",
      parentId: parent.id,
      children: [],
      visible: tree.visible !== false,
      locked: tree.locked === true,
      styles: cleanStyles(tree.styles),
    };
    if (type === "Text") {
      const spans = Array.isArray(tree.spans) ? normalizeSpans(tree.spans) : undefined;
      node.text = tree.text ?? (Array.isArray(tree.spans) ? spansText(tree.spans) : "");
      if (spans && spansText(spans) === node.text) node.spans = spans;
      if (tree.textStyle && this.doc.textStyles?.some((st) => st.id === tree.textStyle)) node.textStyle = tree.textStyle;
    }
    if (type === "Frame" && typeof tree.mode === "string") {
      // inserted trees (pasted or agent HTML) keep the modes that exist and skip the rest
      const known = parseModeList(tree.mode).map(normalizeModeName).filter((m) => collectionOfMode(this.doc, m));
      const mode = known.length ? this.checkModeList(known.join(" ")) : "";
      if (mode) node.mode = mode;
    }
    if (type === "Image" && tree.src !== undefined) node.src = tree.src;
    if (type === "SVG" || type === "SVGElement") {
      node.tag = tree.tag ?? "svg";
      if (tree.attrs) node.attrs = { ...tree.attrs };
    }
    if (type === "Shader" && tree.shader) node.shader = copy(tree.shader);
    if (tree.paint && typeof tree.paint === "object") node.paint = copy(tree.paint);
    if (tree.constraints) this.setConstraints(node, tree.constraints);
    node.name = tree.name?.trim() || defaultNodeName(node);
    this.doc.nodes[id] = node;
    const created = this.doc.nodes[id];
    created.children = children.map((child) => this.buildTree(child, created));
    return id;
  }

  private buildClone(tree: NodeTree, parent: OFNode): NodeId {
    const source = this.node(tree.cloneOf!);
    if (source.type === "Root") fail("root_node", "Root nodes cannot be cloned");
    this.assertContain(parent, source.type);
    const idMap: Record<NodeId, NodeId> = {};
    const id = this.cloneSubtree(source.id, parent.id, idMap);
    this.components.afterClone(id, idMap);
    this.components.guardCycle(parent.id, this.components.instanceComponentsIn(id));
    const node = this.doc.nodes[id];
    if (tree.styles) this.setStyles(id, tree.styles);
    if (tree.constraints) this.setConstraints(node, tree.constraints);
    if (tree.name?.trim()) node.name = tree.name.trim();
    if (tree.text !== undefined && node.type === "Text" && tree.text !== node.text) {
      node.text = tree.text;
      delete node.spans;
    }
    return id;
  }

  /** Deep-copies a subtree with fresh ids. The copy is not attached to the parent's children. */
  private cloneSubtree(sourceId: NodeId, parentId: NodeId, idMap: Record<NodeId, NodeId>): NodeId {
    const source = this.node(sourceId);
    const id = nextNodeId(this.doc);
    idMap[sourceId] = id;
    const childIds = [...source.children];
    const clone = copy(source);
    clone.id = id;
    clone.parentId = parentId;
    clone.children = childIds.filter((c) => getNode(this.doc, c)).map((c) => this.cloneSubtree(c, id, idMap));
    this.doc.nodes[id] = clone;
    return id;
  }

  updateNode(id: NodeId, patch: NodePatch): void {
    const node = this.node(id);
    if (!patch || typeof patch !== "object") fail("invalid_argument", "patch must be an object");
    const before = { name: node.name, text: node.text, visible: node.visible, src: node.src };
    // a Text layer whose name was derived from its text keeps following the text
    const followsText = node.type === "Text" && patch.name === undefined && typeof patch.text === "string" && node.name === defaultNodeName(node);
    if (patch.name !== undefined) {
      if (typeof patch.name !== "string") fail("invalid_argument", "name must be a string");
      node.name = patch.name.trim() || defaultNodeName(patch.text !== undefined ? { ...node, text: patch.text } : node);
    }
    if (patch.visible !== undefined) node.visible = Boolean(patch.visible);
    if (patch.locked !== undefined) node.locked = Boolean(patch.locked);
    for (const key of OPTIONAL_FIELDS) {
      if (!(key in patch)) continue;
      const allowed = FIELD_TYPES[key];
      if (allowed && !allowed.has(node.type)) fail("invalid_argument", `${key} cannot be set on ${node.type} nodes`);
      const value = patch[key];
      if (value === undefined) {
        if (key === "text" || key === "tag") fail("invalid_argument", `${key} cannot be removed`);
        delete node[key];
        continue;
      }
      if (key === "text" && typeof value !== "string") fail("invalid_argument", "text must be a string");
      (node as unknown as Record<string, unknown>)[key] = copy(value);
    }
    this.patchRichFields(node, patch);
    if ("constraints" in patch) this.setConstraints(node, patch.constraints);
    if (followsText) node.name = defaultNodeName(node);
    this.components.captureUpdate(id, patch as Record<string, unknown>, before);
    this.components.touch(id);
  }

  /** spans / mode / textStyle, plus dropping spans that no longer match a changed text. */
  private patchRichFields(node: OFNode, patch: NodePatch): void {
    for (const key of ["spans", "mode", "textStyle"] as const) {
      if (key in patch && patch[key] !== undefined && !FIELD_TYPES[key]!.has(node.type)) {
        fail("invalid_argument", `${key} cannot be set on ${node.type} nodes`);
      }
    }
    if ("spans" in patch) {
      const raw = patch.spans;
      if (raw !== undefined && !Array.isArray(raw)) fail("invalid_argument", "spans must be an array");
      for (const span of raw ?? []) {
        if (!span || typeof span.text !== "string") fail("invalid_argument", "Each span needs a text string");
        for (const [k, v] of Object.entries(span.styles ?? {})) checkStyleValue(k, v);
      }
      const spans = normalizeSpans(raw as TextSpan[] | undefined);
      if (raw !== undefined) {
        const joined = spansText(raw as TextSpan[]);
        if (typeof patch.text === "string" && patch.text !== joined) fail("invalid_argument", "spans must spell out the text exactly");
        if (joined !== node.text) node.text = joined;
      }
      if (spans) node.spans = copy(spans);
      else delete node.spans;
    } else if (node.spans && node.text !== spansText(node.spans)) {
      delete node.spans;
    }
    if ("mode" in patch) {
      const mode = typeof patch.mode === "string" ? this.checkModeList(patch.mode) : "";
      if (mode) node.mode = mode;
      else delete node.mode;
    }
    if ("textStyle" in patch) {
      const id = patch.textStyle;
      if (id === undefined || id === null || id === "") delete node.textStyle;
      else if (!this.doc.textStyles?.some((st) => st.id === id)) fail("not_found", `Text style ${String(id)} not found`);
      else node.textStyle = id;
    }
  }

  /** Normalised `mode` value: known mode names, at most one per collection (the last wins). */
  private checkModeList(value: string): string {
    const byCollection = new Map<string, string>();
    for (const raw of parseModeList(value)) {
      const m = normalizeModeName(raw);
      const c = collectionOfMode(this.doc, m);
      if (!c) fail("not_found", `Unknown token mode "${raw}". Create it in a mode collection first.`);
      byCollection.delete(c.id);
      byCollection.set(c.id, m);
    }
    return [...byCollection.values()].join(" ");
  }

  private setConstraints(node: OFNode, value: OFNode["constraints"]): void {
    if (value === undefined || value === null) {
      delete node.constraints;
      return;
    }
    const h = value.horizontal ?? "left";
    const v = value.vertical ?? "top";
    if (!H_CONSTRAINTS.has(h)) fail("invalid_argument", `Unknown horizontal constraint "${String(h)}"`);
    if (!V_CONSTRAINTS.has(v)) fail("invalid_argument", `Unknown vertical constraint "${String(v)}"`);
    if (h === "left" && v === "top") delete node.constraints;
    else node.constraints = { horizontal: h, vertical: v };
  }

  setStyles(id: NodeId, styles: Record<string, string | number | null>, mode: "merge" | "replace" = "merge"): void {
    const node = this.node(id);
    if (!styles || typeof styles !== "object") fail("invalid_argument", "styles must be an object");
    const before = { ...node.styles };
    this.components.touch(id);
    if (mode === "replace") {
      node.styles = cleanStyles(styles as StyleMap);
      this.components.captureStyles(id, before);
      return;
    }
    for (const [key, value] of Object.entries(styles)) {
      if (value === null || value === "" || value === undefined) {
        if (key in node.styles) delete node.styles[key];
        continue;
      }
      checkStyleValue(key, value);
      if (node.styles[key] !== value) node.styles[key] = value;
    }
    this.components.captureStyles(id, before);
  }

  /** The node ends up at `index` among its new siblings (clamped); omitted = last. */
  moveNode(id: NodeId, parentId: NodeId, index?: number): void {
    const node = this.node(id);
    if (node.type === "Root") fail("root_node", "Root nodes cannot be moved");
    const parent = this.node(parentId);
    if (id === parentId || isAncestor(this.doc, id, parentId)) {
      fail("cycle", `Cannot move ${id} into its own subtree`);
    }
    this.assertContain(parent, node.type);
    if (node.parentId !== parentId) {
      this.components.guardLinked(id, "moved out of it");
      this.components.guardStructure(parentId, "move layers into");
      this.components.guardCycle(parentId, this.components.instanceComponentsIn(id));
    } else {
      this.components.guardLinked(id, "reordered");
    }
    this.components.touch(node.parentId);
    this.components.touch(parentId);
    if (node.parentId !== null) {
      const old = this.node(node.parentId);
      const at = old.children.indexOf(id);
      if (at !== -1) old.children.splice(at, 1);
    }
    parent.children.splice(clampIndex(index, parent.children.length), 0, id);
    if (node.parentId !== parentId) node.parentId = parentId;
  }

  deleteNode(id: NodeId): void {
    const node = this.node(id);
    if (node.type === "Root") fail("root_node", "Root nodes cannot be deleted");
    this.components.guardLinked(id, "deleted");
    this.components.touch(node.parentId);
    if (node.parentId !== null) {
      const parent = getNode(this.doc, node.parentId);
      const at = parent ? parent.children.indexOf(id) : -1;
      if (parent && at !== -1) parent.children.splice(at, 1);
    }
    this.removeSubtree(id);
  }

  private removeSubtree(id: NodeId): void {
    const node = getNode(this.doc, id);
    if (!node) return;
    for (const childId of [...node.children]) this.removeSubtree(childId);
    delete this.doc.nodes[id];
  }

  duplicateNode(id: NodeId, parentId?: NodeId, index?: number): { newId: NodeId; idMap: Record<NodeId, NodeId> } {
    const source = this.node(id);
    if (source.type === "Root") fail("root_node", "Root nodes cannot be duplicated");
    const targetId = parentId ?? source.parentId!;
    const target = this.node(targetId);
    this.assertContain(target, source.type);
    this.components.guardStructure(targetId);
    this.components.touch(targetId);
    let at = index;
    if (at === undefined && targetId === source.parentId) at = target.children.indexOf(id) + 1;
    const idMap: Record<NodeId, NodeId> = {};
    const newId = this.cloneSubtree(id, targetId, idMap);
    this.components.afterClone(newId, idMap);
    this.components.guardCycle(targetId, this.components.instanceComponentsIn(newId));
    const children = this.node(targetId).children;
    children.splice(clampIndex(at, children.length), 0, newId);
    return { newId, idMap };
  }

  // ---- pages ----

  private page(id: PageId) {
    return getPage(this.doc, id) ?? fail("not_found", `Page ${id} not found`);
  }

  private checkIcon(icon: PageIcon | null | undefined): void {
    if (icon !== null && icon !== undefined && !PAGE_ICONS.includes(icon)) {
      fail("invalid_argument", `Unknown page icon "${String(icon)}"`);
    }
  }

  createPage(name?: string, icon?: PageIcon | null, afterPageId?: PageId): PageId {
    this.checkIcon(icon);
    if (afterPageId !== undefined) this.page(afterPageId);
    const taken = new Set(Object.values(this.doc.pages).map((p) => p.name));
    let finalName = name?.trim();
    if (!finalName) {
      let n = Object.keys(this.doc.pages).length + 1;
      while (taken.has(`Page ${n}`)) n++;
      finalName = `Page ${n}`;
    }
    return addPage(this.doc, finalName, icon ?? null, afterPageId);
  }

  updatePage(id: PageId, patch: { name?: string; icon?: PageIcon | null }): void {
    const page = this.page(id);
    if (patch.name !== undefined) {
      const name = typeof patch.name === "string" ? patch.name.trim() : "";
      if (!name) fail("invalid_argument", "Page name cannot be empty");
      page.name = name;
    }
    if (patch.icon !== undefined) {
      this.checkIcon(patch.icon);
      page.icon = patch.icon;
    }
  }

  /**
   * Reorders the page list. Pages and dividers missing from `order` keep their relative order and go
   * to the end (pages are never dropped this way); dividers listed in `removeDividerIds` are removed.
   */
  arrangePages(order: Array<string | { type: "divider" }>, removeDividerIds: string[] = []): PageListItem[] {
    const existing = new Map(this.doc.pageList.map((item) => [item.id, item]));
    const remove = new Set<string>();
    for (const id of removeDividerIds) {
      const item = existing.get(id);
      if (!item) fail("not_found", `Divider ${id} not found`);
      if (item.type !== "divider") fail("invalid_argument", `${id} is a page, not a divider`);
      remove.add(id);
    }
    const next: PageListItem[] = [];
    const used = new Set<string>();
    for (const entry of order) {
      if (typeof entry === "object" && entry !== null && entry.type === "divider") {
        next.push({ type: "divider", id: nextDividerId(this.doc) });
        continue;
      }
      if (typeof entry !== "string") fail("invalid_argument", "order items must be ids or { type: \"divider\" }");
      if (used.has(entry)) fail("invalid_argument", `${entry} appears more than once`);
      const item = existing.get(entry) ?? (getPage(this.doc, entry) ? { type: "page" as const, id: entry } : undefined);
      if (!item) fail("not_found", `No page or divider ${entry}`);
      used.add(entry);
      if (!remove.has(entry)) next.push({ type: item.type, id: item.id } as PageListItem);
    }
    for (const item of this.doc.pageList) {
      if (!used.has(item.id) && !remove.has(item.id)) next.push({ type: item.type, id: item.id } as PageListItem);
    }
    this.doc.pageList = next;
    return next.map((item) => ({ ...item }));
  }

  deletePage(id: PageId): void {
    const page = this.page(id);
    if (Object.keys(this.doc.pages).length <= 1) fail("last_page", "A document needs at least one page");
    this.removeSubtree(page.rootId);
    delete this.doc.pages[id];
    const at = this.doc.pageList.findIndex((item) => item.type === "page" && item.id === id);
    if (at !== -1) this.doc.pageList.splice(at, 1);
  }

  // ---- tokens ----

  private token(nameOrId: string): Token {
    return findToken(this.doc, nameOrId) ?? fail("not_found", `Token ${nameOrId} not found`);
  }

  private checkTokenFields(t: Partial<Omit<Token, "id">>, selfId?: string): void {
    if (t.type !== undefined && !TOKEN_TYPES.includes(t.type)) fail("invalid_argument", `Unknown token type "${String(t.type)}"`);
    if (t.name !== undefined) {
      if (!TOKEN_NAME_RE.test(t.name)) fail("invalid_argument", `Invalid token name "${t.name}"`);
      if (this.doc.tokens.some((o) => o.name === t.name && o.id !== selfId)) {
        fail("duplicate_name", `A token named ${t.name} already exists`);
      }
    }
    if (t.value !== undefined) {
      const ok = (typeof t.value === "string" && t.value.trim() !== "") || (typeof t.value === "number" && Number.isFinite(t.value));
      if (!ok) fail("invalid_argument", "Token value must be a non-empty string or a finite number");
    }
    if (t.description !== undefined && (typeof t.description !== "string" || t.description.length > MAX_DESCRIPTION)) {
      fail("invalid_argument", `Token description must be a string of at most ${MAX_DESCRIPTION} characters`);
    }
  }

  private checkCycles(): void {
    const found = findModeCycle(this.doc);
    if (found) {
      const where = found.mode ? ` in mode "${found.mode}"` : "";
      fail("alias_cycle", `Token alias cycle${where}: ${[...found.cycle, found.cycle[0]].join(" → ")}`);
    }
  }

  /** Validates per-mode values: known non-default modes of one collection, valid values. */
  private checkTokenModes(modes: Record<string, string | number> | undefined): Record<string, string | number> | undefined {
    if (modes === undefined || modes === null) return undefined;
    if (typeof modes !== "object" || Array.isArray(modes)) fail("invalid_argument", "Token modes must be an object of mode name to value");
    const out: Record<string, string | number> = {};
    let collection: ModeCollection | undefined;
    for (const [raw, value] of Object.entries(modes)) {
      const m = normalizeModeName(raw);
      const c = collectionOfMode(this.doc, m);
      if (!c) fail("not_found", `Unknown token mode "${raw}"`);
      if (collection && collection.id !== c.id) fail("invalid_argument", `A token can vary by one mode collection only ("${collection.name}" and "${c.name}" given)`);
      collection = c;
      this.checkTokenFields({ value });
      if (m === c.modes[0]) continue; // the default mode is the token's value
      out[m] = typeof value === "string" ? value.trim() : value;
    }
    return Object.keys(out).length ? out : undefined;
  }

  createToken(t: TokenInput): Token {
    if (!t || typeof t !== "object") fail("invalid_argument", "token must be an object");
    if (t.type === undefined) fail("invalid_argument", "Token type is required");
    if (t.value === undefined) fail("invalid_argument", "Token value is required");
    const name = typeof t.name === "string" ? normalizeTokenName(t.name) : "";
    const value = typeof t.value === "string" ? t.value.trim() : t.value;
    this.checkTokenFields({ type: t.type, name, value, description: t.description });
    const token: Token = { id: nextTokenId(this.doc), type: t.type, name, value };
    if (t.description) token.description = t.description;
    const modes = this.checkTokenModes(t.modes);
    if (modes) token.modes = modes;
    this.doc.tokens.push(token);
    this.checkCycles();
    return copy(token);
  }

  updateToken(nameOrId: string, patch: Partial<Omit<Token, "id">>): Token {
    const token = this.token(nameOrId);
    if (!patch || typeof patch !== "object") fail("invalid_argument", "patch must be an object");
    const fields: Partial<Omit<Token, "id">> = {};
    if (patch.type !== undefined) fields.type = patch.type;
    if (patch.name !== undefined) fields.name = normalizeTokenName(String(patch.name));
    if (patch.value !== undefined) fields.value = typeof patch.value === "string" ? patch.value.trim() : patch.value;
    if (patch.description !== undefined) fields.description = patch.description;
    this.checkTokenFields(fields, token.id);
    const modes = "modes" in patch ? this.checkTokenModes(patch.modes) : token.modes;
    if (fields.type !== undefined) token.type = fields.type;
    if (fields.name !== undefined) token.name = fields.name;
    if (fields.value !== undefined) token.value = fields.value;
    if ("description" in patch) {
      if (patch.description) token.description = patch.description;
      else delete token.description;
    }
    if ("modes" in patch) {
      if (modes) token.modes = copy(modes);
      else delete token.modes;
    }
    this.checkCycles();
    return copy(token);
  }

  deleteToken(nameOrId: string): void {
    const token = this.token(nameOrId);
    this.doc.tokens.splice(this.doc.tokens.findIndex((t) => t.id === token.id), 1);
  }

  moveToken(nameOrId: string, index: number): void {
    const token = this.token(nameOrId);
    const from = this.doc.tokens.findIndex((t) => t.id === token.id);
    const [item] = this.doc.tokens.splice(from, 1);
    this.doc.tokens.splice(clampIndex(index, this.doc.tokens.length), 0, item);
  }

  // ---- token modes ----

  private collection(id: string): ModeCollection {
    return this.doc.modeCollections?.find((c) => c.id === id || c.name === id) ?? fail("not_found", `Mode collection ${id} not found`);
  }

  private checkModeNames(names: string[], selfId?: string): string[] {
    if (!Array.isArray(names) || names.length === 0) fail("invalid_argument", "A mode collection needs at least one mode");
    const out = names.map((n) => normalizeModeName(String(n)));
    for (const [i, m] of out.entries()) {
      if (!MODE_NAME_RE.test(m)) fail("invalid_argument", `Invalid mode name "${names[i]}". Use letters, digits, - and _, starting with a letter.`);
      if (out.indexOf(m) !== i) fail("duplicate_name", `Mode "${m}" is listed twice`);
      const other = collectionOfMode(this.doc, m);
      if (other && other.id !== selfId) fail("duplicate_name", `Mode "${m}" already exists in "${other.name}"`);
    }
    return out;
  }

  createModeCollection(name: string, modes: string[]): ModeCollection {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) fail("invalid_argument", "Mode collection name cannot be empty");
    if (this.doc.modeCollections?.some((c) => c.name === trimmed)) fail("duplicate_name", `A mode collection named "${trimmed}" already exists`);
    const list = this.checkModeNames(modes);
    this.doc.modeCollections ??= [];
    const collection: ModeCollection = { id: nextPrefixedId(this.doc, "m", this.doc.modeCollections), name: trimmed, modes: list };
    this.doc.modeCollections.push(collection);
    return copy(collection);
  }

  updateModeCollection(id: string, patch: { name?: string; modes?: string[]; renames?: Record<string, string> }): ModeCollection {
    const c = this.collection(id);
    if (patch.name !== undefined) {
      const trimmed = String(patch.name).trim();
      if (!trimmed) fail("invalid_argument", "Mode collection name cannot be empty");
      if (this.doc.modeCollections!.some((o) => o.name === trimmed && o.id !== c.id)) fail("duplicate_name", `A mode collection named "${trimmed}" already exists`);
      c.name = trimmed;
    }
    const renames = new Map<string, string>();
    for (const [from, to] of Object.entries(patch.renames ?? {})) {
      const f = normalizeModeName(from);
      if (!c.modes.includes(f)) fail("not_found", `Mode "${from}" is not in "${c.name}"`);
      renames.set(f, normalizeModeName(to));
    }
    const oldModes = [...c.modes];
    const renamedOld = oldModes.map((m) => renames.get(m) ?? m);
    const next = this.checkModeNames(patch.modes !== undefined ? patch.modes : renamedOld, c.id);
    const oldDefault = renamedOld[0];
    const newDefault = next[0];
    const members = this.doc.tokens.filter((t) => tokenCollection(this.doc, t)?.id === c.id);
    for (const t of members) {
      const modes: Record<string, string | number> = {};
      for (const [m, v] of Object.entries(t.modes ?? {})) modes[renames.get(m) ?? m] = v;
      if (newDefault !== oldDefault) {
        const promoted = modes[newDefault] ?? t.value;
        if (next.includes(oldDefault)) modes[oldDefault] = t.value;
        delete modes[newDefault];
        t.value = promoted;
      }
      for (const m of Object.keys(modes)) if (!next.includes(m) || m === newDefault) delete modes[m];
      if (Object.keys(modes).length) t.modes = modes;
      else delete t.modes;
    }
    for (const node of Object.values(this.doc.nodes)) {
      if (!node.mode) continue;
      const list = parseModeList(node.mode)
        .map((m) => (oldModes.includes(m) ? (renames.get(m) ?? m) : m))
        .filter((m) => !(renamedOld.includes(m) && !next.includes(m)));
      const joined = list.join(" ");
      if (!joined) delete node.mode;
      else if (joined !== node.mode) node.mode = joined;
    }
    c.modes = next;
    this.checkCycles();
    return copy(c);
  }

  deleteModeCollection(id: string): void {
    const c = this.collection(id);
    for (const t of this.doc.tokens) if (tokenCollection(this.doc, t)?.id === c.id) delete t.modes;
    for (const node of Object.values(this.doc.nodes)) {
      if (!node.mode) continue;
      const list = parseModeList(node.mode).filter((m) => !c.modes.includes(m));
      if (list.length) node.mode = list.join(" ");
      else delete node.mode;
    }
    this.doc.modeCollections = this.doc.modeCollections!.filter((o) => o.id !== c.id);
    if (this.doc.modeCollections.length === 0) delete this.doc.modeCollections;
  }

  setTokenModeValue(nameOrId: string, mode: string, value: string | number | null): Token {
    const token = this.token(nameOrId);
    const m = normalizeModeName(mode);
    const c = collectionOfMode(this.doc, m) ?? fail("not_found", `Unknown token mode "${mode}"`);
    if (m === c.modes[0]) {
      if (value === null) fail("invalid_argument", `"${m}" is the default mode: it uses the token's value, which cannot be removed`);
      return this.updateToken(token.id, { value });
    }
    const current = tokenCollection(this.doc, token);
    if (current && current.id !== c.id) fail("invalid_argument", `${token.name} already varies by "${current.name}"`);
    const modes = { ...(token.modes ?? {}) };
    if (value === null) delete modes[m];
    else {
      this.checkTokenFields({ value });
      modes[m] = typeof value === "string" ? value.trim() : value;
    }
    if (Object.keys(modes).length) token.modes = modes;
    else delete token.modes;
    this.checkCycles();
    return copy(token);
  }

  // ---- text styles ----

  private textStyle(id: string): TextStyle {
    return this.doc.textStyles?.find((s) => s.id === id || s.name === id) ?? fail("not_found", `Text style ${id} not found`);
  }

  private checkTextStyleName(name: unknown, selfId?: string): string {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) fail("invalid_argument", "Text style name cannot be empty");
    if (trimmed.length > 80) fail("invalid_argument", "Text style names are at most 80 characters");
    const slug = textStyleSlug(trimmed);
    if (!slug) fail("invalid_argument", `Text style name "${trimmed}" needs at least one letter or digit`);
    const clash = this.doc.textStyles?.find((s) => s.id !== selfId && textStyleSlug(s.name) === slug);
    if (clash) fail("duplicate_name", `A text style named "${clash.name}" already exists`);
    return trimmed;
  }

  createTextStyle(input: { name: string; styles: StyleMap; description?: string }): TextStyle {
    if (!input || typeof input !== "object") fail("invalid_argument", "text style must be an object");
    const name = this.checkTextStyleName(input.name);
    const styles = cleanStyles(input.styles);
    this.doc.textStyles ??= [];
    const style: TextStyle = { id: nextPrefixedId(this.doc, "s", this.doc.textStyles), name, styles };
    if (input.description) style.description = String(input.description).slice(0, MAX_DESCRIPTION);
    this.doc.textStyles.push(style);
    return copy(style);
  }

  updateTextStyle(id: string, patch: { name?: string; styles?: StyleMap; description?: string }): TextStyle {
    const style = this.textStyle(id);
    if (patch.name !== undefined) style.name = this.checkTextStyleName(patch.name, style.id);
    if ("description" in patch) {
      if (patch.description) style.description = String(patch.description).slice(0, MAX_DESCRIPTION);
      else delete style.description;
    }
    if (patch.styles !== undefined) {
      const before = { ...style.styles };
      const after = cleanStyles(patch.styles);
      for (const node of Object.values(this.doc.nodes)) {
        if (node.textStyle !== style.id) continue;
        const update: Record<string, string | number | null> = {};
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
          const overridden = key in before ? node.styles[key] !== before[key] : node.styles[key] !== undefined;
          if (!overridden) update[key] = after[key] ?? null;
        }
        this.setStyles(node.id, update);
      }
      style.styles = after;
    }
    return copy(style);
  }

  deleteTextStyle(id: string): void {
    const style = this.textStyle(id);
    for (const node of Object.values(this.doc.nodes)) if (node.textStyle === style.id) delete node.textStyle;
    this.doc.textStyles = this.doc.textStyles!.filter((s) => s.id !== style.id);
    if (this.doc.textStyles.length === 0) delete this.doc.textStyles;
  }

  applyTextStyle(nodeId: NodeId, styleId: string | null): void {
    const node = this.node(nodeId);
    if (node.type !== "Text") fail("invalid_argument", "Text styles apply to Text nodes");
    if (styleId === null) {
      delete node.textStyle;
      return;
    }
    const style = this.textStyle(styleId);
    const previous = node.textStyle ? this.doc.textStyles?.find((s) => s.id === node.textStyle) : undefined;
    const update: Record<string, string | number | null> = {};
    if (previous) {
      for (const [k, v] of Object.entries(previous.styles)) if (!(k in style.styles) && node.styles[k] === v) update[k] = null;
    }
    Object.assign(update, style.styles);
    this.setStyles(node.id, update);
    node.textStyle = style.id;
  }

  // ---- document ----

  setDocName(name: string): void {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) fail("invalid_argument", "Document name cannot be empty");
    this.doc.name = trimmed;
  }

  addAsset(meta: AssetMeta): void {
    if (!meta || typeof meta.hash !== "string" || !meta.hash) fail("invalid_argument", "Asset needs a hash");
    if (typeof meta.mime !== "string" || !meta.mime) fail("invalid_argument", "Asset needs a mime type");
    this.doc.assets[meta.hash] = copy(meta);
  }
}
