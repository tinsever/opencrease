// Loading component data from `.fold` documents: keeps valid fields, drops malformed ones.
import type {
  CodeRef, ComponentDef, ComponentPropDef, ComponentPropType, InstanceData, LibraryCopy, LibraryPublishInfo, NodeOverride, PropValue,
} from "./component-types";
import type { OFNode, Token } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const PROP_TYPES: readonly ComponentPropType[] = ["text", "boolean", "enum", "instance-swap", "slot"];

function propValues(v: unknown): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  if (!isObj(v)) return out;
  for (const [k, val] of Object.entries(v)) if (typeof val === "string" || typeof val === "boolean") out[k] = val;
  return out;
}

function codeRef(v: unknown): CodeRef | undefined {
  if (!isObj(v) || typeof v.package !== "string" || typeof v.export !== "string") return undefined;
  const out: CodeRef = { package: v.package, export: v.export };
  if (isObj(v.propsMap)) {
    out.propsMap = {};
    for (const [k, val] of Object.entries(v.propsMap)) if (typeof val === "string") out.propsMap[k] = val;
  }
  return out;
}

function propDef(v: unknown): ComponentPropDef | undefined {
  if (!isObj(v) || typeof v.name !== "string" || !PROP_TYPES.includes(v.type as ComponentPropType)) return undefined;
  const out: ComponentPropDef = { name: v.name, type: v.type as ComponentPropType };
  if (typeof v.default === "string" || typeof v.default === "boolean") out.default = v.default;
  if (Array.isArray(v.options)) out.options = v.options.filter((o): o is string => typeof o === "string");
  if (typeof v.target === "string") out.target = v.target;
  if (typeof v.description === "string" && v.description) out.description = v.description;
  return out;
}

function override(v: unknown): NodeOverride | undefined {
  if (!isObj(v)) return undefined;
  const out: NodeOverride = {};
  if (isObj(v.styles)) {
    out.styles = {};
    for (const [k, val] of Object.entries(v.styles)) {
      if (val === null || typeof val === "string" || (typeof val === "number" && Number.isFinite(val))) out.styles[k] = val;
    }
  }
  if (typeof v.text === "string") out.text = v.text;
  if (typeof v.visible === "boolean") out.visible = v.visible;
  if (typeof v.name === "string") out.name = v.name;
  if (typeof v.src === "string") out.src = v.src;
  if (isObj(v.props)) out.props = propValues(v.props);
  if (typeof v.componentId === "string") out.componentId = v.componentId;
  return out;
}

function instance(v: unknown): InstanceData | undefined {
  if (!isObj(v) || typeof v.componentId !== "string") return undefined;
  const out: InstanceData = { componentId: v.componentId, props: propValues(v.props), overrides: {} };
  if (typeof v.library === "string" && v.library) out.library = v.library;
  if (isObj(v.overrides)) {
    for (const [k, val] of Object.entries(v.overrides)) {
      const ov = override(val);
      if (ov) out.overrides[k] = ov;
    }
  }
  return out;
}

/** Copies component fields of a raw node onto a normalised node. Only Frames carry component data. */
export function normalizeComponentFields(raw: Obj, node: OFNode): void {
  if (typeof raw.source === "string") node.source = raw.source;
  if (node.type !== "Frame") return;
  if (isObj(raw.component)) {
    const def: ComponentDef = {
      props: Array.isArray(raw.component.props) ? raw.component.props.map(propDef).filter((p): p is ComponentPropDef => !!p) : [],
    };
    if (isObj(raw.component.variant)) {
      def.variant = {};
      for (const [k, val] of Object.entries(raw.component.variant)) if (typeof val === "string") def.variant[k] = val;
    }
    const ref = codeRef(raw.component.codeRef);
    if (ref) def.codeRef = ref;
    if (typeof raw.component.description === "string" && raw.component.description) def.description = raw.component.description;
    node.component = def;
  }
  if (isObj(raw.componentSet)) {
    node.componentSet = {};
    const ref = codeRef(raw.componentSet.codeRef);
    if (ref) node.componentSet.codeRef = ref;
    if (typeof raw.componentSet.description === "string" && raw.componentSet.description) node.componentSet.description = raw.componentSet.description;
  }
  const inst = instance(raw.instance);
  if (inst) node.instance = inst;
}

/** Subscribed library copies and publish info; `normalizeNode` validates the copied nodes. */
export function normalizeLibraryFields(
  input: Obj,
  normalizeNode: (id: string, value: unknown) => OFNode | undefined,
  normalizeToken: (value: unknown) => Token | undefined,
): { libraries?: Record<string, LibraryCopy>; library?: LibraryPublishInfo } {
  const out: { libraries?: Record<string, LibraryCopy>; library?: LibraryPublishInfo } = {};
  if (isObj(input.library) && typeof input.library.version === "number") {
    out.library = { version: input.library.version, publishedAt: typeof input.library.publishedAt === "number" ? input.library.publishedAt : 0 };
  }
  if (isObj(input.libraries)) {
    const libraries: Record<string, LibraryCopy> = {};
    for (const [id, raw] of Object.entries(input.libraries)) {
      if (!isObj(raw)) continue;
      const nodes: LibraryCopy["nodes"] = {};
      for (const [nid, n] of Object.entries(isObj(raw.nodes) ? raw.nodes : {})) {
        const node = normalizeNode(nid, n);
        if (node) nodes[nid] = node;
      }
      libraries[id] = {
        name: typeof raw.name === "string" ? raw.name : "Library",
        version: typeof raw.version === "number" ? raw.version : 0,
        publishedAt: typeof raw.publishedAt === "number" ? raw.publishedAt : 0,
        componentIds: Array.isArray(raw.componentIds) ? raw.componentIds.filter((c): c is string => typeof c === "string" && !!nodes[c]) : [],
        nodes,
        tokens: Array.isArray(raw.tokens) ? raw.tokens.map(normalizeToken).filter((t): t is Token => !!t) : [],
      };
      if (isObj(raw.assets)) libraries[id].assets = raw.assets as LibraryCopy["assets"];
    }
    if (Object.keys(libraries).length) out.libraries = libraries;
  }
  return out;
}
