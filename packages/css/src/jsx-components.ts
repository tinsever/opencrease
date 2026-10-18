// Code component output for instances: `<Button variant="primary">Shop</Button>` plus import lines,
// for components that declare a `codeRef` (SPEC §4.9). Instances without one export as plain markup.
import {
  codeRefOf, componentDisplayName, componentStore, instancePropStates, mainComponentOf,
  type CodeRef, type FoldDocument, type NodeId, type OFNode,
} from "@opencrease/model";

/** package → named imports, plus default imports under a local name */
export type CodeImports = Map<string, { named: Set<string>; defaults: Set<string> }>;

const IDENT = /^[A-Za-z_$][\w$]*$/;

function attr(name: string, value: string): string {
  if (/["\\\n\r&{}]/.test(value)) return `${name}={${JSON.stringify(value)}}`;
  return `${name}="${value}"`;
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}

function pascal(name: string): string {
  const out = name.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : "")).replace(/^[^A-Za-z_$]+/, "");
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : "Component";
}

/** Tag name and import for a code reference. "Icons.Arrow" imports Icons; "default" imports the default export. */
function tagFor(ref: CodeRef, displayName: string, imports: CodeImports): string {
  let entry = imports.get(ref.package);
  if (!entry) {
    entry = { named: new Set(), defaults: new Set() };
    imports.set(ref.package, entry);
  }
  if (ref.export === "default") {
    const local = pascal(displayName);
    entry.defaults.add(local);
    return local;
  }
  entry.named.add(ref.export.split(".")[0]);
  return ref.export;
}

export function importLines(imports: CodeImports): string[] {
  const lines: string[] = [];
  for (const [pkg, { named, defaults }] of [...imports].sort(([a], [b]) => a.localeCompare(b))) {
    const parts: string[] = [];
    const def = [...defaults][0];
    if (def) parts.push(def);
    if (named.size) parts.push(`{ ${[...named].sort().join(", ")} }`);
    lines.push(`import ${parts.join(", ")} from ${JSON.stringify(pkg)};`);
    for (const extra of [...defaults].slice(1)) lines.push(`import ${extra} from ${JSON.stringify(pkg)};`);
  }
  return lines;
}

function findBySource(doc: FoldDocument, rootId: NodeId, source: string): OFNode | undefined {
  const stack = [...(doc.nodes[rootId]?.children ?? [])];
  while (stack.length) {
    const n = doc.nodes[stack.shift()!];
    if (!n) continue;
    if (n.source === source) return n;
    stack.push(...n.children);
  }
  return undefined;
}

/** Element for a component id when it has a code mapping (used for instance-swap values). */
function componentElement(doc: FoldDocument, componentId: NodeId, library: string | undefined, imports: CodeImports): string | undefined {
  const store = componentStore(doc, library);
  const main = store?.[componentId];
  if (!store || !main?.component) return undefined;
  const ref = codeRefOf(store, main);
  if (!ref) return JSON.stringify(componentDisplayName(store, main));
  const tag = tagFor(ref, componentDisplayName(store, main), imports);
  const variant = main.component.variant ?? {};
  const attrs = Object.entries(variant).map(([k, v]) => {
    const name = ref.propsMap?.[k] ?? k;
    return name && IDENT.test(name) ? ` ${attr(name, v)}` : "";
  });
  return `<${tag}${attrs.join("")} />`;
}

export interface CodeInstanceOptions {
  idAttr?: string;
  renderChild(child: OFNode, depth: number): string[];
}

/**
 * JSX for an instance whose main component (or its set) has a code mapping, or null to fall back to markup.
 * Props map through `propsMap`; a prop mapped to `children` (or a slot) becomes the element's children.
 */
export function renderCodeInstance(doc: FoldDocument, node: OFNode, depth: number, imports: CodeImports, opts: CodeInstanceOptions): string[] | null {
  const main = mainComponentOf(doc, node);
  if (!main || !node.instance) return null;
  const store = componentStore(doc, node.instance.library)!;
  const ref = codeRefOf(store, main);
  if (!ref) return null;
  const pad = "  ".repeat(depth);
  const tag = tagFor(ref, componentDisplayName(store, main), imports);
  const attrs: string[] = [];
  if (opts.idAttr) attrs.push(opts.idAttr);
  let childText: string | undefined;
  let childLines: string[] | undefined;
  const ownerPrefix = node.source !== undefined ? `${node.source}/` : "";

  for (const { def, value } of instancePropStates(doc, node)) {
    const codeName = ref.propsMap && def.name in ref.propsMap ? ref.propsMap[def.name] : def.name;
    if (!codeName) continue;
    const isChildren = codeName === "children";
    if (!isChildren && !IDENT.test(codeName)) continue;
    switch (def.type) {
      case "enum":
      case "text": {
        if (typeof value !== "string") break;
        if (isChildren) childText = value;
        else attrs.push(attr(codeName, value));
        break;
      }
      case "boolean":
        if (value === true) attrs.push(codeName);
        else if (value === false) attrs.push(`${codeName}={false}`);
        break;
      case "instance-swap": {
        if (typeof value !== "string") break;
        const el = componentElement(doc, value, node.instance.library, imports);
        if (el) attrs.push(`${codeName}={${el}}`);
        break;
      }
      case "slot": {
        if (def.target === undefined) break;
        const slot = findBySource(doc, node.id, `${ownerPrefix}${def.target}`);
        const kids = slot ? slot.children.map((c) => doc.nodes[c]).filter((c): c is OFNode => !!c && c.visible) : [];
        if (!kids.length) break;
        if (isChildren) {
          childLines = kids.flatMap((k) => opts.renderChild(k, depth + 1));
        } else {
          const inner = kids.flatMap((k) => opts.renderChild(k, depth + 2));
          const body = kids.length === 1 ? inner : [`${pad}    <>`, ...kids.flatMap((k) => opts.renderChild(k, depth + 3)), `${pad}    </>`];
          attrs.push(`${codeName}={\n${body.join("\n")}\n${pad}  }`);
        }
        break;
      }
    }
  }
  const open = attrs.length ? `<${tag} ${attrs.join(" ")}` : `<${tag}`;
  if (childLines?.length) return [`${pad}${open}>`, ...childLines, `${pad}</${tag}>`];
  if (childText !== undefined) return [`${pad}${open}>${escapeText(childText).split("\n").join("<br />")}</${tag}>`];
  return [`${pad}${open} />`];
}
