// Components (SPEC §4.9): main components, instances, overrides, variants, slots and code mapping.
//
// Instances are materialised: an instance is a Frame with `instance` data whose children are real nodes
// generated from the main component. Every generated layer has `source`, the id path of the layer it
// mirrors in the main component ("A-0", or "B-0/C-0" for a layer inside a nested instance B-0). Rendering,
// hit testing, measuring, export and the layer tree therefore work on instances without special cases.
//
// Edits to generated layers are recorded as overrides on the instance (keyed by `source`), and every
// transaction ends with a sync pass (`ComponentHooks.finalize`) that regenerates the instances of any
// main component that changed, re-applying their overrides. Because the sync runs inside the same
// transaction, one undo step reverts an edit together with the instance updates it caused.
import type { Tx } from "./contracts";
import type {
  CodeRef, ComponentDef, ComponentPropDef, ComponentPropType, InstanceData, NodeOverride, PropValue,
} from "./component-types";
import { ModelError } from "./errors";
import { nextNodeId } from "./ids";
import { ancestors, getNode, pageOfNode } from "./queries";
import type { FoldDocument, NodeId, NodeTree, NodeType, OFNode, StyleMap, StyleValue } from "./types";
import { isDraft, original } from "immer";

/** Styles that place an instance in its parent. They belong to the instance, never to the main component. */
export const INSTANCE_POSITION_KEYS: readonly string[] = ["position", "left", "top", "right", "bottom", "inset"];
const PROP_TYPES: readonly ComponentPropType[] = ["text", "boolean", "enum", "instance-swap", "slot"];
const MAX_DEPTH = 12;
const MAX_ROUNDS = 12;

type NodeStore = Record<NodeId, OFNode>;

function fail(code: ModelError["code"], message: string): never {
  throw new ModelError(code, message);
}

function copy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// =====================================================================================================
// Queries

/** A main component (a Frame marked with `component`). */
export function isMainComponent(node: OFNode | undefined): boolean {
  return !!node?.component;
}

/** A component set (a Frame holding variant components). */
export function isComponentSet(node: OFNode | undefined): boolean {
  return !!node?.componentSet;
}

/** The root of an instance the user placed (not one generated inside another instance). */
export function isInstanceRoot(node: OFNode | undefined): boolean {
  return !!node?.instance && node.source === undefined;
}

/** Any instance frame, including nested instances generated inside another instance. */
export function isInstance(node: OFNode | undefined): boolean {
  return !!node?.instance;
}

/** A layer generated from a main component (inside an instance). */
export function isLinked(node: OFNode | undefined): boolean {
  return node?.source !== undefined;
}

/** Node map that holds the main components of an instance (local nodes or a subscribed library copy). */
export function componentStore(doc: FoldDocument, library?: string): NodeStore | undefined {
  if (!library) return doc.nodes;
  return doc.libraries?.[library]?.nodes;
}

/** Main component of an instance (local or from a library), if it still exists. */
export function mainComponentOf(doc: FoldDocument, node: OFNode | undefined): OFNode | undefined {
  if (!node?.instance) return undefined;
  const store = componentStore(doc, node.instance.library);
  const main = store && has(store, node.instance.componentId) ? store[node.instance.componentId] : undefined;
  return main?.component ? main : undefined;
}

/** The component set a main component belongs to. */
export function componentSetOf(store: NodeStore, main: OFNode | undefined): OFNode | undefined {
  if (!main?.parentId) return undefined;
  const parent = store[main.parentId];
  return parent?.componentSet ? parent : undefined;
}

/** Variant components of a set, in order. */
export function variantsOf(store: NodeStore, set: OFNode): OFNode[] {
  return set.children.map((id) => store[id]).filter((n): n is OFNode => !!n?.component);
}

/** Enum props of a component set, derived from the `variant` values of its components. */
export function setEnumProps(store: NodeStore, set: OFNode): ComponentPropDef[] {
  const order: string[] = [];
  const options = new Map<string, string[]>();
  for (const v of variantsOf(store, set)) {
    for (const [key, value] of Object.entries(v.component!.variant ?? {})) {
      if (!options.has(key)) {
        options.set(key, []);
        order.push(key);
      }
      const list = options.get(key)!;
      if (!list.includes(value)) list.push(value);
    }
  }
  return order.map((name) => ({ name, type: "enum", options: options.get(name)!, default: options.get(name)![0] }));
}

/** Every prop of a main component: the set's enum props first, then its own props. */
export function allProps(store: NodeStore, main: OFNode): ComponentPropDef[] {
  const set = componentSetOf(store, main);
  return [...(set ? setEnumProps(store, set) : []), ...(main.component?.props ?? [])];
}

/** Display name of a component: the set name for variants. */
export function componentDisplayName(store: NodeStore, main: OFNode): string {
  return componentSetOf(store, main)?.name ?? main.name;
}

/** Label for canvas badges: "Button primary/md" for a variant, "Card" otherwise. */
export function componentLabel(store: NodeStore, main: OFNode): string {
  const set = componentSetOf(store, main);
  if (!set) return main.name;
  const values = Object.values(main.component?.variant ?? {});
  return values.length ? `${set.name} ${values.join("/")}` : `${set.name} ${main.name}`;
}

/** Code component mapping of a main component (its own, else its set's). */
export function codeRefOf(store: NodeStore, main: OFNode): CodeRef | undefined {
  return main.component?.codeRef ?? componentSetOf(store, main)?.componentSet?.codeRef;
}

/** Nearest ancestor instance root: the instance whose overrides cover a generated layer. */
export function instanceOwner(doc: FoldDocument, id: NodeId): OFNode | undefined {
  return ancestors(doc, id).find((n) => n.instance && n.source === undefined);
}

/** Nearest main component containing a node (the node itself included). */
export function enclosingComponent(doc: FoldDocument, id: NodeId): OFNode | undefined {
  const node = getNode(doc, id);
  if (!node) return undefined;
  if (node.component) return node;
  return ancestors(doc, id).find((n) => n.component);
}

/** Id path of a layer inside a main component ("" for the component frame). */
export function pathInComponent(doc: FoldDocument, id: NodeId, mainId: NodeId): string | undefined {
  if (id === mainId) return "";
  const node = getNode(doc, id);
  if (!node) return undefined;
  if (node.source === undefined) return ancestors(doc, id).some((a) => a.id === mainId) ? id : undefined;
  const owner = instanceOwner(doc, id);
  if (!owner) return undefined;
  const ownerPath = pathInComponent(doc, owner.id, mainId);
  if (ownerPath === undefined || ownerPath === "") return undefined;
  return `${ownerPath}/${node.source}`;
}

/** Resolves an id path inside a main component to the layer in the main tree that defines it. */
export function resolvePath(store: NodeStore, mainId: NodeId, path: string): OFNode | undefined {
  const main = has(store, mainId) ? store[mainId] : undefined;
  if (!main) return undefined;
  if (path === "") return main;
  // ids are unique within a store, so each segment names a layer of the previous segment's main component
  let current: OFNode | undefined;
  for (const seg of path.split("/")) {
    if (current && !current.instance) return undefined;
    current = has(store, seg) ? store[seg] : undefined;
    if (!current) return undefined;
  }
  return current;
}

/** Is this layer an instance slot (a generated frame whose children belong to the instance)? */
export function isSlotLayer(doc: FoldDocument, node: OFNode): boolean {
  if (node.source === undefined) return false;
  const owner = instanceOwner(doc, node.id);
  const main = mainComponentOf(doc, owner);
  return !!main?.component?.props.some((p) => p.type === "slot" && p.target === node.source);
}

/** Number of override entries on an instance (0 for none). */
export function overrideCount(node: OFNode | undefined): number {
  if (!node?.instance) return 0;
  let n = 0;
  for (const ov of Object.values(node.instance.overrides)) {
    n += Object.keys(ov.styles ?? {}).length;
    for (const k of ["text", "visible", "name", "src", "componentId"] as const) if (ov[k] !== undefined) n++;
    n += Object.keys(ov.props ?? {}).length;
  }
  return n;
}

/** Overrides that apply to a generated layer (or a nested instance) inside its owning instance. */
export function overridesForLayer(doc: FoldDocument, node: OFNode): NodeOverride | undefined {
  if (isInstanceRoot(node)) return node.instance!.overrides[""];
  if (node.source === undefined) return undefined;
  return instanceOwner(doc, node.id)?.instance?.overrides[node.source];
}

/** Does a generated layer, or anything inside a nested instance, carry overrides? */
export function hasOverrides(doc: FoldDocument, node: OFNode): boolean {
  if (isInstanceRoot(node)) return overrideCount(node) > 0;
  if (node.source === undefined) return false;
  const owner = instanceOwner(doc, node.id);
  if (!owner?.instance) return false;
  const prefix = `${node.source}/`;
  return Object.keys(owner.instance.overrides).some((k) => k === node.source || (node.instance !== undefined && k.startsWith(prefix)));
}

export interface PropState {
  def: ComponentPropDef;
  value: PropValue | undefined;
  /** the instance sets the value itself (not the main component's default) */
  overridden: boolean;
}

/** Props of an instance (top-level or nested) with their current values. */
export function instancePropStates(doc: FoldDocument, node: OFNode): PropState[] {
  const main = mainComponentOf(doc, node);
  if (!main || !node.instance) return [];
  const store = componentStore(doc, node.instance.library)!;
  const values = node.instance.props;
  return allProps(store, main).map((def) => {
    if (def.type === "enum") return { def, value: main.component!.variant?.[def.name], overridden: false };
    const own = values[def.name];
    if (own !== undefined) return { def, value: own, overridden: true };
    const layer = def.target !== undefined ? resolvePath(store, main.id, def.target) : undefined;
    let value: PropValue | undefined = def.default;
    if (def.type === "text") value = layer?.text ?? (typeof def.default === "string" ? def.default : "");
    else if (def.type === "boolean") value = layer ? layer.visible : def.default === true;
    else if (def.type === "instance-swap") value = layer?.instance?.componentId ?? def.default;
    else if (def.type === "slot") value = undefined;
    return { def, value, overridden: false };
  });
}

export interface ComponentSummary {
  id: NodeId;
  name: string;
  /** "Button primary/md" for variants */
  label: string;
  library?: string;
  libraryName?: string;
  pageId?: string;
  setId?: NodeId;
  setName?: string;
  variant?: Record<string, string>;
  props: ComponentPropDef[];
  codeRef?: CodeRef;
  description?: string;
  instanceCount: number;
}

function summarise(store: NodeStore, main: OFNode, extra: Partial<ComponentSummary>): ComponentSummary {
  const set = componentSetOf(store, main);
  const out: ComponentSummary = {
    id: main.id,
    name: main.name,
    label: componentLabel(store, main),
    props: copy(allProps(store, main)),
    instanceCount: 0,
    ...extra,
  };
  if (set) {
    out.setId = set.id;
    out.setName = set.name;
  }
  if (main.component?.variant) out.variant = { ...main.component.variant };
  const codeRef = codeRefOf(store, main);
  if (codeRef) out.codeRef = copy(codeRef);
  if (main.component?.description) out.description = main.component.description;
  return out;
}

/** Every main component in the file, then those of subscribed libraries. */
export function listComponents(doc: FoldDocument, opts: { libraries?: boolean } = {}): ComponentSummary[] {
  const counts = new Map<string, number>();
  for (const n of Object.values(doc.nodes)) {
    if (!isInstanceRoot(n)) continue;
    const key = `${n.instance!.library ?? ""}|${n.instance!.componentId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: ComponentSummary[] = [];
  for (const n of Object.values(doc.nodes)) {
    if (!n.component) continue;
    out.push(summarise(doc.nodes, n, { pageId: pageOfNode(doc, n.id)?.id, instanceCount: counts.get(`|${n.id}`) ?? 0 }));
  }
  if (opts.libraries !== false) {
    for (const [libId, lib] of Object.entries(doc.libraries ?? {})) {
      for (const n of Object.values(lib.nodes)) {
        if (!n.component) continue;
        out.push(summarise(lib.nodes, n, { library: libId, libraryName: lib.name, instanceCount: counts.get(`${libId}|${n.id}`) ?? 0 }));
      }
    }
  }
  return out;
}

/** Instance roots of a component (local components when `library` is omitted). */
export function instancesOf(doc: FoldDocument, componentId: NodeId, library?: string): OFNode[] {
  return Object.values(doc.nodes).filter(
    (n) => isInstanceRoot(n) && n.instance!.componentId === componentId && (n.instance!.library ?? undefined) === (library ?? undefined),
  );
}

/** Components whose instances appear (directly or nested) inside a main component. */
export function componentDependencies(store: NodeStore, componentId: NodeId): Set<NodeId> {
  const out = new Set<NodeId>();
  const visit = (id: NodeId) => {
    const stack = [id];
    while (stack.length) {
      const n = store[stack.pop()!];
      if (!n) continue;
      if (n.instance && n.source === undefined && n.id !== id && !n.instance.library) {
        if (!out.has(n.instance.componentId)) {
          out.add(n.instance.componentId);
          visit(n.instance.componentId);
        }
      }
      stack.push(...n.children);
    }
  };
  visit(componentId);
  return out;
}

// =====================================================================================================
// Materialisation: the layer tree an instance should have

interface Desired {
  path: string;
  type: NodeType;
  name: string;
  styles: StyleMap;
  visible: boolean;
  text?: string;
  src?: string;
  tag?: string;
  attrs?: Record<string, string>;
  shader?: OFNode["shader"];
  /** generated nested instance */
  instance?: InstanceData;
  /** slot of the instanced component: children belong to the instance */
  slot?: boolean;
  /** main-tree ids of the slot's default content */
  slotDefault?: NodeId[];
  children: Desired[];
}

function withoutPosition(styles: StyleMap): StyleMap {
  const out: StyleMap = {};
  for (const [k, v] of Object.entries(styles)) if (!INSTANCE_POSITION_KEYS.includes(k)) out[k] = v;
  return out;
}

function positionOnly(styles: StyleMap): StyleMap {
  const out: StyleMap = {};
  for (const [k, v] of Object.entries(styles)) if (INSTANCE_POSITION_KEYS.includes(k)) out[k] = v;
  return out;
}

function baseDesired(n: OFNode, path: string): Desired {
  const d: Desired = { path, type: n.type, name: n.name, styles: { ...n.styles }, visible: n.visible, children: [] };
  if (n.text !== undefined) d.text = n.text;
  if (n.src !== undefined) d.src = n.src;
  if (n.tag !== undefined) d.tag = n.tag;
  if (n.attrs) d.attrs = { ...n.attrs };
  if (n.shader) d.shader = copy(n.shader);
  return d;
}

function stripOverrides(overrides: Record<string, NodeOverride>, prefix: string): Record<string, NodeOverride> {
  const out: Record<string, NodeOverride> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (k === prefix) out[""] = v;
    else if (k.startsWith(`${prefix}/`)) out[k.slice(prefix.length + 1)] = v;
  }
  return out;
}

function mergeOverride(a: NodeOverride | undefined, b: NodeOverride | undefined): NodeOverride {
  const out: NodeOverride = { ...copy(a ?? {}), ...copy(b ?? {}) };
  if (a?.styles || b?.styles) out.styles = { ...(a?.styles ?? {}), ...(b?.styles ?? {}) };
  if (a?.props || b?.props) out.props = { ...(a?.props ?? {}), ...(b?.props ?? {}) };
  return out;
}

function mergeOverrides(base: Record<string, NodeOverride>, top: Record<string, NodeOverride>): Record<string, NodeOverride> {
  const out: Record<string, NodeOverride> = copy(base);
  for (const [k, v] of Object.entries(top)) out[k] = mergeOverride(out[k], v);
  return out;
}

function applyOverride(d: Desired, ov: NodeOverride | undefined): void {
  if (!ov) return;
  for (const [k, v] of Object.entries(ov.styles ?? {})) {
    if (v === null) delete d.styles[k];
    else d.styles[k] = v;
  }
  if (ov.name !== undefined) d.name = ov.name;
  if (ov.text !== undefined && d.type === "Text") d.text = ov.text;
  if (ov.visible !== undefined) d.visible = ov.visible;
  if (ov.src !== undefined && d.type === "Image") d.src = ov.src;
}

function indexDesired(d: Desired, out = new Map<string, Desired>()): Map<string, Desired> {
  out.set(d.path, d);
  for (const c of d.children) indexDesired(c, out);
  return out;
}

function prefixPaths(d: Desired, prefix: string): void {
  d.path = d.path === "" ? prefix : `${prefix}/${d.path}`;
  for (const c of d.children) prefixPaths(c, prefix);
}

/** Finds the generated layer with a given `source` under a node (real nodes). */
function findBySource(store: NodeStore, rootId: NodeId, source: string): OFNode | undefined {
  const stack = [...(store[rootId]?.children ?? [])];
  while (stack.length) {
    const n = store[stack.pop()!];
    if (!n) continue;
    if (n.source === source) return n;
    if (n.source !== undefined) stack.push(...n.children);
  }
  return undefined;
}

/**
 * Layer tree for an instance of `componentId` with prop values and overrides. Nested instances inside
 * the main component are materialised recursively from their own main component, so prop values and
 * overrides that reach into them (`"B-0/C-0"`) apply at every depth.
 */
function materialize(
  store: NodeStore,
  componentId: NodeId,
  props: Record<string, PropValue>,
  overrides: Record<string, NodeOverride>,
  library: string | undefined,
  depth: number,
): Desired | null {
  const main = has(store, componentId) ? store[componentId] : undefined;
  if (!main?.component || depth > MAX_DEPTH) return null;
  const defs = main.component.props;
  const slotTargets = new Set(defs.filter((p) => p.type === "slot" && p.target).map((p) => p.target!));
  const swapProps = new Map(defs.filter((p) => p.type === "instance-swap" && p.target).map((p) => [p.target!, p]));

  const nested = (n: OFNode): Desired => {
    const swap = swapProps.get(n.id);
    const ov = overrides[n.id];
    const swapValue = swap ? props[swap.name] : undefined;
    const componentIdNext = (typeof swapValue === "string" && swapValue) || ov?.componentId || n.instance!.componentId;
    const nprops = { ...n.instance!.props, ...(ov?.props ?? {}) };
    const nov = mergeOverrides(n.instance!.overrides, stripOverrides(overrides, n.id));
    const d = materialize(store, componentIdNext, nprops, nov, library, depth + 1);
    if (!d) {
      // main component missing: keep the layer as a plain frame
      const plain = baseDesired(n, n.id);
      plain.children = [];
      return plain;
    }
    prefixPaths(d, n.id);
    d.styles = { ...d.styles, ...positionOnly(n.styles) };
    d.visible = nov[""]?.visible ?? n.visible;
    const data: InstanceData = { componentId: componentIdNext, props: nprops, overrides: nov };
    if (library) data.library = library;
    d.instance = data;
    // slots of the nested instance hold content of this main component (free layers under its slot frame)
    for (const s of indexDesired(d).values()) {
      if (!s.slot) continue;
      const rel = s.path.slice(n.id.length + 1);
      const real = findBySource(store, n.id, rel);
      s.children = real ? real.children.map((c) => store[c]).filter(Boolean).map(walk) : [];
      s.slot = false;
      delete s.slotDefault;
    }
    return d;
  };

  const walk = (n: OFNode): Desired => {
    if (n.instance && n.source === undefined) return nested(n);
    const d = baseDesired(n, n.id);
    if (slotTargets.has(n.id)) {
      d.slot = true;
      d.slotDefault = [...n.children];
      return d;
    }
    d.children = n.children.map((c) => store[c]).filter(Boolean).map(walk);
    return d;
  };

  const set = componentSetOf(store, main);
  const root = baseDesired(main, "");
  root.styles = withoutPosition(main.styles);
  root.name = set?.name ?? main.name;
  root.children = main.children.map((c) => store[c]).filter(Boolean).map(walk);

  const index = indexDesired(root);
  for (const def of defs) {
    if (def.target === undefined) continue;
    const d = index.get(def.target);
    const value = props[def.name];
    if (!d || value === undefined) continue;
    if (def.type === "text" && d.type === "Text") d.text = String(value);
    else if (def.type === "boolean") d.visible = value === true || value === "true";
  }
  for (const [path, ov] of Object.entries(overrides)) applyOverride(index.get(path) ?? ({ styles: {} } as Desired), ov);
  return root;
}

// =====================================================================================================
// Hooks: override capture, structure guards and the sync pass. One instance per transaction (TxImpl).

function sameStyles(a: StyleMap, b: StyleMap): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => has(b, k) && a[k] === b[k]);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export class ComponentHooks {
  /** nodes whose content changed (or parents whose children changed) */
  readonly dirty = new Set<NodeId>();
  /** instance roots to regenerate */
  readonly dirtyInstances = new Set<NodeId>();
  #syncing = false;

  constructor(readonly doc: FoldDocument) {}

  get syncing(): boolean {
    return this.#syncing;
  }

  touch(id: NodeId | null | undefined): void {
    if (id && !this.#syncing) this.dirty.add(id);
  }

  // ---- guards ----

  /** Throws when children cannot be added to or removed from `parentId` (inside an instance). */
  guardStructure(parentId: NodeId, verb = "add layers to"): void {
    if (this.#syncing) return;
    const parent = getNode(this.doc, parentId);
    if (!parent) return;
    if (isInstanceRoot(parent)) {
      fail("instance_structure", `Cannot ${verb} the instance "${parent.name}". Edit its main component, or detach the instance first.`);
    }
    if (parent.source !== undefined && !isSlotLayer(this.doc, parent)) {
      const owner = instanceOwner(this.doc, parent.id);
      fail("instance_structure", `Cannot ${verb} "${parent.name}" inside the instance "${owner?.name ?? "instance"}". Edit the main component, or detach the instance first.`);
    }
  }

  /** Throws when a generated layer would be deleted or moved on its own. */
  guardLinked(id: NodeId, verb: string): void {
    if (this.#syncing) return;
    const node = getNode(this.doc, id);
    if (node?.source === undefined) return;
    const owner = instanceOwner(this.doc, id);
    fail("instance_structure", `"${node.name}" is part of the instance "${owner?.name ?? "instance"}" and cannot be ${verb}. Hide it instead, edit the main component, or detach the instance.`);
  }

  /** Throws when placing instances of `componentIds` under `parentId` would make a component contain itself. */
  guardCycle(parentId: NodeId, componentIds: Iterable<NodeId>): void {
    const ids = [...componentIds];
    if (!ids.length) return;
    const containers: NodeId[] = [];
    const parent = getNode(this.doc, parentId);
    if (!parent) return;
    for (const n of [parent, ...ancestors(this.doc, parentId)]) if (n.component) containers.push(n.id);
    if (!containers.length) return;
    for (const cid of ids) {
      const deps = componentDependencies(this.doc.nodes, cid);
      for (const container of containers) {
        if (container === cid || deps.has(container)) {
          const name = getNode(this.doc, container)?.name ?? container;
          fail("cycle", `An instance of this component cannot go inside "${name}": the component would contain itself.`);
        }
      }
    }
  }

  /** Local component ids used by instance roots in a subtree. */
  instanceComponentsIn(rootId: NodeId): NodeId[] {
    const out: NodeId[] = [];
    const stack = [rootId];
    while (stack.length) {
      const n = getNode(this.doc, stack.pop()!);
      if (!n) continue;
      if (isInstanceRoot(n) && !n.instance!.library) out.push(n.instance!.componentId);
      stack.push(...n.children);
    }
    return out;
  }

  // ---- override capture ----

  #ownerAndPath(node: OFNode): { owner: OFNode; path: string } | undefined {
    if (isInstanceRoot(node)) return { owner: node, path: "" };
    if (node.source === undefined) return undefined;
    const owner = instanceOwner(this.doc, node.id);
    return owner ? { owner, path: node.source } : undefined;
  }

  #base(owner: OFNode, path: string): OFNode | undefined {
    const store = componentStore(this.doc, owner.instance!.library);
    return store ? resolvePath(store, owner.instance!.componentId, path) : undefined;
  }

  #override(owner: OFNode, path: string): NodeOverride {
    const overrides = owner.instance!.overrides;
    if (!overrides[path]) overrides[path] = {};
    return overrides[path];
  }

  #prune(owner: OFNode, path: string): void {
    const ov = owner.instance!.overrides[path];
    if (!ov) return;
    if (ov.styles && Object.keys(ov.styles).length === 0) delete ov.styles;
    if (ov.props && Object.keys(ov.props).length === 0) delete ov.props;
    if (Object.keys(ov).length === 0) delete owner.instance!.overrides[path];
  }

  /** Records style edits on an instance (or a layer inside one) as overrides. */
  captureStyles(id: NodeId, before: StyleMap): void {
    if (this.#syncing) return;
    const node = getNode(this.doc, id);
    const at = node && this.#ownerAndPath(node);
    if (!node || !at) return;
    const { owner, path } = at;
    const isRoot = path === "";
    const base = this.#base(owner, path);
    const baseStyles = base ? (isRoot ? withoutPosition(base.styles) : base.styles) : {};
    let changed = false;
    for (const key of new Set([...Object.keys(before), ...Object.keys(node.styles)])) {
      const next = has(node.styles, key) ? node.styles[key] : undefined;
      if (before[key] === next) continue;
      if (isRoot && INSTANCE_POSITION_KEYS.includes(key)) continue;
      const ov = this.#override(owner, path);
      ov.styles ??= {};
      const baseValue = has(baseStyles, key) ? baseStyles[key] : undefined;
      if (next === baseValue) delete ov.styles[key];
      else ov.styles[key] = next === undefined ? null : next;
      changed = true;
    }
    if (changed) this.#prune(owner, path);
  }

  /** Records name, text, visibility and image edits as overrides (or prop values for bound layers). */
  captureUpdate(id: NodeId, patch: Record<string, unknown>, before: Pick<OFNode, "name" | "text" | "visible" | "src">): void {
    if (this.#syncing) return;
    const node = getNode(this.doc, id);
    const at = node && this.#ownerAndPath(node);
    if (!node || !at) return;
    const { owner, path } = at;
    const base = this.#base(owner, path);
    const main = mainComponentOf(this.doc, owner);
    const defs = main?.component?.props ?? [];
    if (patch.name !== undefined && node.name !== before.name) {
      const baseName = path === "" && main ? componentDisplayName(componentStore(this.doc, owner.instance!.library)!, main) : base?.name;
      const ov = this.#override(owner, path);
      if (node.name === baseName) delete ov.name;
      else ov.name = node.name;
    }
    if (has(patch, "text") && node.text !== before.text && node.type === "Text") {
      const bound = defs.find((p) => p.type === "text" && p.target === path);
      if (bound) owner.instance!.props[bound.name] = node.text ?? "";
      else {
        const ov = this.#override(owner, path);
        if (node.text === base?.text) delete ov.text;
        else ov.text = node.text;
      }
    }
    if (patch.visible !== undefined && node.visible !== before.visible && path !== "") {
      const bound = defs.find((p) => p.type === "boolean" && p.target === path);
      if (bound) owner.instance!.props[bound.name] = node.visible;
      else {
        const ov = this.#override(owner, path);
        if (node.visible === base?.visible) delete ov.visible;
        else ov.visible = node.visible;
      }
    }
    if (has(patch, "src") && node.src !== before.src && node.src !== undefined) {
      const ov = this.#override(owner, path);
      if (node.src === base?.src) delete ov.src;
      else ov.src = node.src;
    }
    this.#prune(owner, path);
  }

  /** After a deep copy: remap prop targets of copied components, and cut copied generated layers loose. */
  afterClone(newRootId: NodeId, idMap: Record<NodeId, NodeId>): void {
    for (const newId of Object.values(idMap)) {
      const n = getNode(this.doc, newId);
      if (!n?.component) continue;
      for (const def of n.component.props) {
        if (!def.target) continue;
        const [first, ...rest] = def.target.split("/");
        if (idMap[first]) def.target = [idMap[first], ...rest].join("/");
      }
    }
    const root = getNode(this.doc, newRootId);
    if (root?.source !== undefined) unlinkSubtree(this.doc, newRootId);
  }

  // ---- sync ----

  /** Regenerates instances affected by this transaction until nothing changes (bounded). */
  finalize(): void {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const components = new Set<NodeId>();
      for (const id of this.dirty) {
        const node = getNode(this.doc, id);
        if (!node) continue;
        if (node.component) components.add(node.id);
        for (const a of ancestors(this.doc, id)) if (a.component) components.add(a.id);
      }
      this.dirty.clear();
      const roots = new Set(this.dirtyInstances);
      this.dirtyInstances.clear();
      if (components.size) {
        // scan the state before this transaction, plus instances created in it
        const base = isDraft(this.doc.nodes) ? (original(this.doc.nodes) as NodeStore) : this.doc.nodes;
        const consider = (id: NodeId, n: OFNode | undefined) => {
          if (!n?.instance || n.instance.library || !components.has(n.instance.componentId)) return;
          const current = getNode(this.doc, id);
          if (!current) return;
          const owner = current.source === undefined ? current : instanceOwner(this.doc, id);
          if (owner) roots.add(owner.id);
        };
        for (const id in base) consider(id, base[id]);
        for (const id of this.#created) if (!has(base, id)) consider(id, getNode(this.doc, id));
      }
      if (!roots.size) return;
      for (const id of roots) this.syncInstance(id);
    }
  }

  #created = new Set<NodeId>();

  /** Instance roots created in this transaction (the sync scan reads the state before it). */
  noteCreated(id: NodeId): void {
    this.#created.add(id);
  }

  /** Regenerates one instance root from its main component. */
  syncInstance(rootId: NodeId): void {
    const root = getNode(this.doc, rootId);
    if (!root?.instance || root.source !== undefined) return;
    const store = componentStore(this.doc, root.instance.library);
    if (!store) return;
    const desired = materialize(store, root.instance.componentId, root.instance.props, root.instance.overrides, root.instance.library, 0);
    if (!desired) return;
    this.#syncing = true;
    try {
      const styles = { ...desired.styles, ...positionOnly(root.styles) };
      if (!sameStyles(root.styles, styles)) {
        root.styles = styles;
        this.#changed(root.id);
      }
      if (root.name !== desired.name) {
        root.name = desired.name;
        this.#changed(root.id);
      }
      this.#syncChildren(root, desired, store, root.instance.library);
    } finally {
      this.#syncing = false;
    }
  }

  #changed(id: NodeId): void {
    this.dirty.add(id);
  }

  #syncNode(node: OFNode, d: Desired, store: NodeStore, library: string | undefined, fresh: boolean): void {
    let changed = false;
    const set = <K extends keyof OFNode>(key: K, value: OFNode[K] | undefined, same: (a: unknown, b: unknown) => boolean = (a, b) => a === b) => {
      if (value === undefined) {
        if (key in node) {
          delete node[key];
          changed = true;
        }
        return;
      }
      if (!same(node[key], value)) {
        node[key] = copy(value) as OFNode[K];
        changed = true;
      }
    };
    set("type", d.type);
    set("name", d.name);
    set("visible", d.visible);
    if (!sameStyles(node.styles, d.styles)) {
      node.styles = { ...d.styles };
      changed = true;
    }
    set("text", d.text);
    set("src", d.src);
    set("tag", d.tag);
    set("attrs", d.attrs, sameJson);
    set("shader", d.shader, sameJson);
    set("instance", d.instance, sameJson);
    set("source", d.path);
    if (node.component) {
      delete node.component;
      changed = true;
    }
    if (changed) this.#changed(node.id);
    if (d.slot) {
      if (fresh && d.slotDefault?.length) {
        node.children = d.slotDefault.filter((id) => store[id]).map((id) => copyFromStore(this.doc, store, id, node.id, library));
        this.#changed(node.id);
      }
      return;
    }
    this.#syncChildren(node, d, store, library);
  }

  #syncChildren(node: OFNode, d: Desired, store: NodeStore, library: string | undefined): void {
    const existing = new Map<string, NodeId>();
    const free: NodeId[] = [];
    for (const c of node.children) {
      const child = getNode(this.doc, c);
      if (!child) continue;
      if (child.source !== undefined && !existing.has(child.source)) existing.set(child.source, c);
      else if (child.source === undefined) free.push(c);
      else this.#remove(c);
    }
    const next: NodeId[] = [];
    for (const cd of d.children) {
      let id = existing.get(cd.path);
      if (id) {
        existing.delete(cd.path);
        this.#syncNode(this.doc.nodes[id], cd, store, library, false);
      } else {
        id = nextNodeId(this.doc);
        this.doc.nodes[id] = { id, type: cd.type, name: cd.name, parentId: node.id, children: [], visible: true, locked: false, styles: {} };
        this.#syncNode(this.doc.nodes[id], cd, store, library, true);
      }
      next.push(id);
    }
    for (const id of existing.values()) this.#remove(id);
    next.push(...free);
    if (!sameIds(node.children, next)) {
      node.children = next;
      this.#changed(node.id);
    }
  }

  #remove(id: NodeId): void {
    const node = getNode(this.doc, id);
    if (!node) return;
    for (const c of [...node.children]) this.#remove(c);
    delete this.doc.nodes[id];
  }
}

/** Deep-copies a subtree from a component store into the document as free layers (new ids). */
function copyFromStore(doc: FoldDocument, store: NodeStore, sourceId: NodeId, parentId: NodeId, library: string | undefined): NodeId {
  const src = store[sourceId];
  const id = nextNodeId(doc);
  const clone = copy(src);
  clone.id = id;
  clone.parentId = parentId;
  delete clone.source;
  delete clone.component;
  delete clone.componentSet;
  if (clone.instance && library) clone.instance.library = library;
  clone.children = [];
  doc.nodes[id] = clone;
  const created = doc.nodes[id];
  if (src.source !== undefined) {
    // generated layers of a nested instance stay generated (their owner comes along)
    created.source = src.source;
  }
  created.children = src.children.filter((c) => store[c]).map((c) => copyFromStore(doc, store, c, id, library));
  return id;
}

/**
 * Turns generated layers in a subtree into ordinary layers. Generated nested instances become instance
 * roots of their own (their generated layers are re-keyed relative to them).
 */
export function unlinkSubtree(doc: FoldDocument, rootId: NodeId): void {
  const rekey = (id: NodeId, prefix: string) => {
    const n = getNode(doc, id);
    if (!n || n.source === undefined) return;
    if (n.source.startsWith(prefix)) n.source = n.source.slice(prefix.length);
    for (const c of n.children) rekey(c, prefix);
  };
  const walk = (id: NodeId) => {
    const n = getNode(doc, id);
    if (!n || n.source === undefined) return;
    const old = n.source;
    delete n.source;
    if (n.instance) {
      for (const c of n.children) rekey(c, `${old}/`);
      return;
    }
    for (const c of n.children) walk(c);
  };
  walk(rootId);
}

// =====================================================================================================
// Operations (run inside a transaction)

function hooksOf(tx: Tx): ComponentHooks {
  const hooks = (tx as unknown as { components?: ComponentHooks }).components;
  if (!hooks) fail("invalid_argument", "Component operations need a DocStore transaction");
  return hooks;
}

function need(doc: FoldDocument, id: NodeId): OFNode {
  return getNode(doc, id) ?? fail("not_found", `Node ${id} not found`);
}

function needComponent(doc: FoldDocument, id: NodeId): OFNode {
  const node = need(doc, id);
  if (!node.component) fail("invalid_argument", `"${node.name}" (${id}) is not a main component`);
  return node;
}

export interface CreateComponentOptions {
  name?: string;
  props?: ComponentPropDef[];
  codeRef?: CodeRef | null;
  description?: string;
}

/** Marks a Frame as a main component. */
export function createComponent(tx: Tx, nodeId: NodeId, opts: CreateComponentOptions = {}): void {
  const hooks = hooksOf(tx);
  const node = need(tx.doc, nodeId);
  if (node.type !== "Frame") fail("invalid_argument", `Only frames can become components ("${node.name}" is a ${node.type})`);
  if (node.component) fail("invalid_argument", `"${node.name}" is already a main component`);
  if (node.componentSet) fail("invalid_argument", `"${node.name}" is a component set`);
  if (node.instance) fail("invalid_argument", `"${node.name}" is an instance. Detach it first to make a new component from it.`);
  if (node.source !== undefined) fail("instance_structure", `"${node.name}" is part of an instance. Detach the instance first.`);
  node.component = { props: [] };
  if (opts.name?.trim()) node.name = opts.name.trim();
  hooks.touch(nodeId);
  if (opts.props || opts.codeRef || opts.description) {
    setComponentDef(tx, nodeId, { props: opts.props, codeRef: opts.codeRef ?? undefined, description: opts.description });
  }
}

/** Turns a main component back into a plain frame. Its instances keep their layers and show a missing main. */
export function removeComponent(tx: Tx, nodeId: NodeId): void {
  const node = needComponent(tx.doc, nodeId);
  delete node.component;
  hooksOf(tx).touch(nodeId);
}

export interface ComponentDefPatch {
  name?: string;
  props?: ComponentPropDef[];
  codeRef?: CodeRef | null;
  description?: string | null;
  variant?: Record<string, string>;
}

function validateProps(doc: FoldDocument, main: OFNode, props: unknown): ComponentPropDef[] {
  if (!Array.isArray(props)) fail("invalid_argument", "props must be an array");
  const seen = new Set<string>();
  return props.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") fail("invalid_argument", "Each prop must be an object");
    const p = raw as Partial<ComponentPropDef>;
    const name = typeof p.name === "string" ? p.name.trim() : "";
    if (!name) fail("invalid_argument", "Each prop needs a name");
    if (seen.has(name)) fail("duplicate_name", `Prop "${name}" is defined twice`);
    seen.add(name);
    if (!PROP_TYPES.includes(p.type as ComponentPropType)) fail("invalid_argument", `Prop "${name}" has unknown type "${String(p.type)}"`);
    const def: ComponentPropDef = { name, type: p.type! };
    if (def.type === "enum") {
      fail("invalid_argument", `Prop "${name}": enum props come from variants. Combine components into a component set (oc_create_component_set) and give each a variant value.`);
    }
    if (typeof p.description === "string" && p.description) def.description = p.description;
    const target = typeof p.target === "string" ? p.target : undefined;
    if (target === undefined) fail("invalid_argument", `Prop "${name}" needs a target layer`);
    const layer = findLayerForPath(doc, main.id, target) ? resolvePath(doc.nodes, main.id, target) : undefined;
    if (!layer) fail("not_found", `Prop "${name}": no layer "${target}" inside "${main.name}"`);
    def.target = target;
    switch (def.type) {
      case "text":
        if (layer.type !== "Text") fail("invalid_argument", `Prop "${name}": text props bind to a Text layer, "${layer.name}" is a ${layer.type}`);
        if (typeof p.default === "string") def.default = p.default;
        break;
      case "boolean":
        if (target === "") fail("invalid_argument", `Prop "${name}": a boolean prop cannot hide the component itself`);
        if (typeof p.default === "boolean") def.default = p.default;
        break;
      case "instance-swap":
        if (!layer.instance || layer.source !== undefined || target.includes("/")) {
          fail("invalid_argument", `Prop "${name}": instance-swap props bind to an instance placed directly in the main component`);
        }
        def.default = layer.instance.componentId;
        break;
      case "slot":
        if (target === "" || layer.type !== "Frame" || layer.instance || target.includes("/")) {
          fail("invalid_argument", `Prop "${name}": slot props bind to a plain frame inside the main component`);
        }
        break;
    }
    return def;
  });
}

/** Real layer in the document for a path inside a local main component. */
export function findLayerForPath(doc: FoldDocument, mainId: NodeId, path: string): NodeId | undefined {
  if (path === "") return getNode(doc, mainId) ? mainId : undefined;
  const [first, ...rest] = path.split("/");
  const top = getNode(doc, first);
  if (!top || top.source !== undefined || !ancestors(doc, first).some((a) => a.id === mainId)) return undefined;
  if (!rest.length) return top.id;
  if (!top.instance) return undefined;
  return findBySource(doc.nodes, top.id, rest.join("/"))?.id;
}

function validateCodeRef(raw: unknown): CodeRef {
  if (!raw || typeof raw !== "object") fail("invalid_argument", "codeRef must be an object");
  const r = raw as Partial<CodeRef>;
  const pkg = typeof r.package === "string" ? r.package.trim() : "";
  const exp = typeof r.export === "string" ? r.export.trim() : "";
  if (!pkg) fail("invalid_argument", "codeRef.package is required, e.g. \"@acme/ui\"");
  if (!exp || !/^[A-Za-z_$][\w$.]*$/.test(exp)) fail("invalid_argument", "codeRef.export must be an export name, e.g. \"Button\"");
  const out: CodeRef = { package: pkg, export: exp };
  if (r.propsMap && typeof r.propsMap === "object") {
    out.propsMap = {};
    for (const [k, v] of Object.entries(r.propsMap)) if (typeof v === "string") out.propsMap[k] = v.trim();
  }
  return out;
}

/** Updates prop definitions, code mapping, description or variant values of a main component. */
export function setComponentDef(tx: Tx, componentId: NodeId, patch: ComponentDefPatch): void {
  const hooks = hooksOf(tx);
  const main = needComponent(tx.doc, componentId);
  const def = main.component as ComponentDef;
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) fail("invalid_argument", "Component name cannot be empty");
    main.name = name;
  }
  if (patch.props !== undefined) def.props = validateProps(tx.doc, main, patch.props);
  if (patch.codeRef !== undefined) {
    if (patch.codeRef === null) delete def.codeRef;
    else def.codeRef = validateCodeRef(patch.codeRef);
  }
  if (patch.description !== undefined) {
    if (patch.description) def.description = patch.description;
    else delete def.description;
  }
  if (patch.variant !== undefined) {
    if (!componentSetOf(tx.doc.nodes, main)) fail("invalid_argument", `"${main.name}" is not in a component set, so it has no variant values`);
    const variant: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch.variant)) {
      const key = k.trim();
      const value = String(v).trim();
      if (key && value) variant[key] = value;
    }
    def.variant = variant;
  }
  hooks.touch(componentId);
}

/** Updates the code mapping or description of a component set. */
export function setComponentSetDef(tx: Tx, setId: NodeId, patch: { name?: string; codeRef?: CodeRef | null; description?: string | null }): void {
  const set = need(tx.doc, setId);
  if (!set.componentSet) fail("invalid_argument", `"${set.name}" is not a component set`);
  if (patch.name !== undefined && patch.name.trim()) set.name = patch.name.trim();
  if (patch.codeRef !== undefined) {
    if (patch.codeRef === null) delete set.componentSet.codeRef;
    else set.componentSet.codeRef = validateCodeRef(patch.codeRef);
  }
  if (patch.description !== undefined) {
    if (patch.description) set.componentSet.description = patch.description;
    else delete set.componentSet.description;
  }
  const hooks = hooksOf(tx);
  for (const v of variantsOf(tx.doc.nodes, set)) hooks.touch(v.id);
}

export interface CreateInstanceOptions {
  index?: number;
  library?: string;
  props?: Record<string, PropValue>;
  /** styles for the instance frame: position keys belong to the instance, others become overrides */
  styles?: Record<string, StyleValue>;
  name?: string;
}

/** Builds an instance root (not attached to its parent's children yet). */
function buildInstanceNode(tx: Tx, componentId: NodeId, parentId: NodeId, opts: CreateInstanceOptions): NodeId {
  const hooks = hooksOf(tx);
  const store = componentStore(tx.doc, opts.library) ?? fail("not_found", `Library ${opts.library} is not subscribed in this file`);
  const main = has(store, componentId) ? store[componentId] : undefined;
  if (!main?.component) fail("not_found", `No component with id "${componentId}"${opts.library ? " in that library" : ""}`);
  if (!opts.library) hooks.guardCycle(parentId, [componentId]);
  const id = nextNodeId(tx.doc);
  const data: InstanceData = { componentId, props: {}, overrides: {} };
  if (opts.library) data.library = opts.library;
  tx.doc.nodes[id] = {
    id,
    type: "Frame",
    name: componentDisplayName(store, main),
    parentId,
    children: [],
    visible: true,
    locked: false,
    styles: withoutPosition(main.styles),
    instance: data,
  };
  hooks.noteCreated(id);
  if (opts.props) applyPropValues(tx, id, opts.props);
  hooks.syncInstance(id);
  if (opts.styles) {
    const position: Record<string, StyleValue> = {};
    const rest: Record<string, StyleValue> = {};
    for (const [k, v] of Object.entries(opts.styles)) (INSTANCE_POSITION_KEYS.includes(k) ? position : rest)[k] = v;
    Object.assign(tx.doc.nodes[id].styles, position);
    if (Object.keys(rest).length) tx.setStyles(id, rest);
  }
  if (opts.name?.trim()) tx.updateNode(id, { name: opts.name.trim() });
  return id;
}

/** Places an instance of a component under `parentId`. Returns the instance id. */
export function createInstance(tx: Tx, componentId: NodeId, parentId: NodeId, opts: CreateInstanceOptions = {}): NodeId {
  const hooks = hooksOf(tx);
  const parent = need(tx.doc, parentId);
  if (parent.type !== "Root" && parent.type !== "Frame") fail("invalid_parent", `${parent.type} ${parent.id} cannot contain an instance`);
  hooks.guardStructure(parentId);
  const id = buildInstanceNode(tx, componentId, parentId, opts);
  const children = tx.doc.nodes[parentId].children;
  const at = opts.index === undefined ? children.length : Math.min(Math.max(Math.trunc(opts.index), 0), children.length);
  children.splice(at, 0, id);
  hooks.touch(parentId);
  return id;
}

/** Resolves a component reference by id, name, set name or code export name. */
export function resolveComponentRef(doc: FoldDocument, ref: string, library?: string): { id: NodeId; library?: string } | undefined {
  const stores: Array<[NodeStore, string | undefined]> = library
    ? [[componentStore(doc, library) ?? {}, library]]
    : [[doc.nodes, undefined], ...Object.entries(doc.libraries ?? {}).map(([k, v]) => [v.nodes, k] as [NodeStore, string])];
  const key = ref.trim();
  for (const [store, lib] of stores) {
    const direct = has(store, key) ? store[key] : undefined;
    if (direct?.component) return { id: direct.id, library: lib };
    if (direct?.componentSet) {
      const first = variantsOf(store, direct)[0];
      if (first) return { id: first.id, library: lib };
    }
  }
  const lower = key.toLowerCase();
  for (const [store, lib] of stores) {
    const nodes = Object.values(store);
    const set = nodes.find((n) => n.componentSet && (n.name.toLowerCase() === lower || n.componentSet.codeRef?.export === key));
    if (set) {
      const first = variantsOf(store, set)[0];
      if (first) return { id: first.id, library: lib };
    }
    const comp = nodes.find((n) => n.component && (n.name.toLowerCase() === lower || n.component.codeRef?.export === key));
    if (comp) return { id: comp.id, library: lib };
  }
  return undefined;
}

/** Builds an instance from a NodeTree `instance` spec. Falls back to the tree's children when the component is missing. */
export function buildInstanceTree(tx: Tx, tree: NodeTree, parentId: NodeId, buildFallback: () => NodeId): NodeId {
  const spec = tree.instance!;
  const ref = typeof spec.component === "string" ? resolveComponentRef(tx.doc, spec.component, spec.library) : undefined;
  if (!ref) {
    if (tree.children?.length) return buildFallback();
    fail("not_found", `No component "${String(spec.component)}" in this file. Use oc_list_components to see the available components.`);
  }
  const id = buildInstanceNode(tx, ref.id, parentId, { library: ref.library, props: spec.props, styles: tree.styles, name: tree.name });
  if (spec.overrides && typeof spec.overrides === "object") {
    const data = tx.doc.nodes[id].instance!;
    data.overrides = { ...data.overrides, ...copy(spec.overrides) };
    hooksOf(tx).syncInstance(id);
  }
  if (spec.slots) {
    const main = mainComponentOf(tx.doc, tx.doc.nodes[id])!;
    for (const [name, trees] of Object.entries(spec.slots)) {
      const def = main.component!.props.find((p) => p.type === "slot" && p.name === name);
      if (!def || !Array.isArray(trees) || !trees.length) continue;
      const slot = findBySource(tx.doc.nodes, id, def.target!);
      if (!slot) continue;
      for (const c of [...slot.children]) tx.deleteNode(c);
      tx.insertTrees(slot.id, trees);
    }
  }
  return id;
}

/** Maps design or code prop names to design props; enum props switch the variant. */
function applyPropValues(tx: Tx, instanceId: NodeId, values: Record<string, PropValue>): void {
  const node = need(tx.doc, instanceId);
  const main = mainComponentOf(tx.doc, node);
  if (!main || !node.instance) return;
  const store = componentStore(tx.doc, node.instance.library)!;
  const codeRef = codeRefOf(store, main);
  const reverse = new Map(Object.entries(codeRef?.propsMap ?? {}).filter(([, v]) => v).map(([k, v]) => [v, k]));
  const defs = allProps(store, main);
  const named: Record<string, PropValue> = {};
  for (const [key, value] of Object.entries(values)) {
    const name = defs.some((d) => d.name === key) ? key : reverse.get(key);
    if (name) named[name] = value;
  }
  setInstanceProps(tx, instanceId, named);
}

/**
 * Sets prop values on an instance. Enum props pick the matching variant, text and boolean props change the
 * bound layers, instance-swap props take a component id. On a nested instance (inside another instance)
 * the values are stored as overrides of the outer instance.
 */
export function setInstanceProps(tx: Tx, instanceId: NodeId, values: Record<string, PropValue | null>): void {
  const hooks = hooksOf(tx);
  const node = need(tx.doc, instanceId);
  if (!node.instance) fail("invalid_argument", `"${node.name}" is not an instance`);
  const main = mainComponentOf(tx.doc, node) ?? fail("not_found", `The main component of "${node.name}" no longer exists`);
  const store = componentStore(tx.doc, node.instance.library)!;
  const defs = allProps(store, main);
  const enumChanges: Record<string, string> = {};
  const plain: Record<string, PropValue | null> = {};
  for (const [name, value] of Object.entries(values)) {
    const def = defs.find((d) => d.name === name);
    if (!def) fail("not_found", `"${componentDisplayName(store, main)}" has no prop "${name}". Props: ${defs.map((d) => d.name).join(", ") || "none"}`);
    if (def.type === "enum") {
      const v = String(value);
      if (!def.options?.includes(v)) fail("invalid_argument", `Prop "${name}" must be one of ${def.options?.join(", ")}`);
      enumChanges[name] = v;
    } else if (def.type === "slot") {
      fail("invalid_argument", `Prop "${name}" is a slot: put layers into it instead of setting a value`);
    } else if (value === null) {
      plain[name] = null;
    } else if (def.type === "boolean") {
      plain[name] = value === true || value === "true";
    } else if (def.type === "instance-swap") {
      const target = resolveComponentRef(tx.doc, String(value), node.instance.library);
      if (!target || (target.library ?? undefined) !== (node.instance.library ?? undefined)) fail("not_found", `Prop "${name}": no component "${String(value)}"`);
      plain[name] = target.id;
    } else {
      plain[name] = String(value);
    }
  }
  let componentId = node.instance.componentId;
  if (Object.keys(enumChanges).length) {
    const set = componentSetOf(store, main)!;
    const want = { ...(main.component!.variant ?? {}), ...enumChanges };
    const variants = variantsOf(store, set);
    const score = (v: OFNode) => {
      const vals = v.component!.variant ?? {};
      if (Object.entries(enumChanges).some(([k, val]) => vals[k] !== val)) return -1;
      return Object.entries(want).filter(([k, val]) => vals[k] === val).length;
    };
    const best = variants.reduce<OFNode | undefined>((acc, v) => (score(v) > (acc ? score(acc) : -1) ? v : acc), undefined);
    if (!best || score(best) < 0) fail("not_found", `No variant matches ${JSON.stringify(want)}`);
    componentId = best.id;
  }

  if (node.source === undefined) {
    const data = node.instance;
    for (const [k, v] of Object.entries(plain)) {
      if (v === null) delete data.props[k];
      else data.props[k] = v;
    }
    if (componentId !== data.componentId) {
      data.overrides = remapOverrides(store, data.componentId, componentId, data.overrides);
      data.componentId = componentId;
    }
    hooks.dirtyInstances.add(node.id);
    hooks.touch(node.id);
    return;
  }
  // nested instance: store on the owning instance
  const owner = instanceOwner(tx.doc, node.id) ?? fail("not_found", "Nested instance without an owner");
  const overrides = owner.instance!.overrides;
  const ov = (overrides[node.source] ??= {});
  if (Object.keys(plain).length) {
    ov.props ??= {};
    for (const [k, v] of Object.entries(plain)) {
      if (v === null) delete ov.props[k];
      else ov.props[k] = v;
    }
    if (!Object.keys(ov.props).length) delete ov.props;
  }
  if (componentId !== node.instance.componentId) ov.componentId = componentId;
  if (!Object.keys(ov).length) delete overrides[node.source];
  hooks.dirtyInstances.add(owner.id);
  hooks.touch(owner.id);
}

/** Moves override keys from one variant to another by matching layer names along the path. */
export function remapOverrides(store: NodeStore, fromId: NodeId, toId: NodeId, overrides: Record<string, NodeOverride>): Record<string, NodeOverride> {
  const namePaths = (rootId: NodeId) => {
    const byId = new Map<NodeId, string>();
    const byName = new Map<string, NodeId>();
    const walk = (id: NodeId, prefix: string) => {
      const n = store[id];
      if (!n) return;
      const counts = new Map<string, number>();
      for (const c of n.children) {
        const child = store[c];
        if (!child) continue;
        const k = counts.get(child.name) ?? 0;
        counts.set(child.name, k + 1);
        const key = `${prefix}/${child.name}#${k}`;
        byId.set(c, key);
        byName.set(key, c);
        if (!(child.instance && child.source === undefined)) walk(c, key);
      }
    };
    walk(rootId, "");
    return { byId, byName };
  };
  const from = namePaths(fromId);
  const to = namePaths(toId);
  const out: Record<string, NodeOverride> = {};
  for (const [path, ov] of Object.entries(overrides)) {
    if (path === "") {
      out[""] = ov;
      continue;
    }
    const [first, ...rest] = path.split("/");
    const key = from.byId.get(first);
    const mapped = key ? to.byName.get(key) : undefined;
    if (mapped) out[[mapped, ...rest].join("/")] = ov;
  }
  return out;
}

/** Clears overrides of an instance (or of a nested instance or layer inside one). Prop values stay. */
export function resetOverrides(tx: Tx, nodeId: NodeId): void {
  const hooks = hooksOf(tx);
  const node = need(tx.doc, nodeId);
  if (isInstanceRoot(node)) {
    node.instance!.overrides = {};
    hooks.dirtyInstances.add(node.id);
    hooks.touch(node.id);
    return;
  }
  if (node.source === undefined) fail("invalid_argument", `"${node.name}" is not an instance or a layer inside one`);
  const owner = instanceOwner(tx.doc, node.id) ?? fail("not_found", "Layer without an owning instance");
  const overrides = owner.instance!.overrides;
  for (const key of Object.keys(overrides)) {
    if (key === node.source || key.startsWith(`${node.source}/`)) delete overrides[key];
  }
  hooks.dirtyInstances.add(owner.id);
  hooks.touch(owner.id);
}

/** Turns an instance into ordinary layers. Nested instances inside it stay instances. */
export function detachInstance(tx: Tx, nodeId: NodeId): void {
  const hooks = hooksOf(tx);
  const node = need(tx.doc, nodeId);
  if (!node.instance) fail("invalid_argument", `"${node.name}" is not an instance`);
  if (node.source !== undefined) {
    const owner = instanceOwner(tx.doc, nodeId);
    fail("instance_structure", `"${node.name}" is nested in the instance "${owner?.name ?? "instance"}". Detach that instance first.`);
  }
  delete node.instance;
  for (const c of node.children) unlinkSubtree(tx.doc, c);
  hooks.touch(node.id);
}

export interface CreateSetOptions {
  name?: string;
  /** variant prop name (default "variant") */
  propName?: string;
  /** one value per component (default: from each component name) */
  values?: string[];
}

function variantValue(name: string): string {
  const last = name.split("/").pop()!.trim();
  const eq = /=\s*(.+)$/.exec(last);
  return (eq ? eq[1] : last).trim().toLowerCase().replace(/\s+/g, "-") || "default";
}

/** Combines sibling main components into a component set, each one a variant. Returns the set id. */
export function createComponentSet(tx: Tx, componentIds: NodeId[], opts: CreateSetOptions = {}): NodeId {
  const hooks = hooksOf(tx);
  if (!componentIds.length) fail("invalid_argument", "Pass at least one component");
  const comps = componentIds.map((id) => needComponent(tx.doc, id));
  const parentId = comps[0].parentId!;
  if (comps.some((c) => c.parentId !== parentId)) fail("invalid_argument", "Variants must share the same parent");
  if (componentSetOf(tx.doc.nodes, comps[0])) fail("invalid_argument", `"${comps[0].name}" is already in a component set`);
  const parent = need(tx.doc, parentId);
  hooks.guardStructure(parentId);
  const propName = opts.propName?.trim() || "variant";
  const onPage = parent.type === "Root";
  const lefts = comps.map((c) => (typeof c.styles.left === "number" ? c.styles.left : parseFloat(String(c.styles.left ?? "0")) || 0));
  const tops = comps.map((c) => (typeof c.styles.top === "number" ? c.styles.top : parseFloat(String(c.styles.top ?? "0")) || 0));
  const prefix = comps[0].name.includes("/") ? comps[0].name.split("/")[0].trim() : "";
  const name = opts.name?.trim() || prefix || comps[0].name;
  const index = Math.min(...comps.map((c) => parent.children.indexOf(c.id)));
  const [setId] = tx.insertTrees(parentId, [{
    type: "Frame",
    name,
    styles: {
      ...(onPage ? { left: Math.min(...lefts), top: Math.min(...tops) } : {}),
      display: "flex",
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "flex-start",
      gap: 24,
      padding: 24,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: "#8B5CF6",
      borderRadius: 8,
    },
  }], index);
  tx.doc.nodes[setId].componentSet = {};
  const used = new Set<string>();
  comps.forEach((c, i) => {
    let value = opts.values?.[i]?.trim() || variantValue(c.name);
    for (let n = 2; used.has(value); n++) value = `${variantValue(c.name)}-${n}`;
    used.add(value);
    tx.moveNode(c.id, setId);
    const node = tx.doc.nodes[c.id];
    for (const k of INSTANCE_POSITION_KEYS) delete node.styles[k];
    node.component!.variant = { [propName]: value };
    if (prefix && node.name.startsWith(`${prefix}/`)) node.name = node.name.slice(prefix.length + 1).trim() || node.name;
    hooks.touch(c.id);
  });
  return setId;
}

/** Duplicates a variant inside its set with a new value for one variant prop. Returns the new component id. */
export function addVariant(tx: Tx, componentId: NodeId, propName?: string, value?: string): NodeId {
  const main = needComponent(tx.doc, componentId);
  const set = componentSetOf(tx.doc.nodes, main) ?? fail("invalid_argument", `"${main.name}" is not in a component set`);
  const key = propName ?? Object.keys(main.component!.variant ?? {})[0] ?? "variant";
  const taken = new Set(variantsOf(tx.doc.nodes, set).map((v) => v.component!.variant?.[key]));
  let next = value?.trim() || `${main.component!.variant?.[key] ?? "variant"}-copy`;
  for (let n = 2; taken.has(next); n++) next = `${value?.trim() || main.component!.variant?.[key] || "variant"}-${n}`;
  const { newId } = tx.duplicateNode(componentId, set.id);
  const copyNode = tx.doc.nodes[newId];
  copyNode.component!.variant = { ...(main.component!.variant ?? {}), [key]: next };
  copyNode.name = next;
  hooksOf(tx).touch(newId);
  return newId;
}

/** Names of the props a layer is bound to in its main component (for the inspector). */
export function propsBoundTo(doc: FoldDocument, node: OFNode): ComponentPropDef[] {
  const main = enclosingComponent(doc, node.id);
  if (!main?.component) return [];
  const path = pathInComponent(doc, node.id, main.id);
  return path === undefined ? [] : main.component.props.filter((p) => p.target === path);
}
