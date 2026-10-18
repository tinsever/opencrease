import { textStyleSlug, type FoldDocument, type NodeId, type OFNode, type StyleMap, type Token } from "@opencrease/model";
import { importLines, renderCodeInstance, type CodeImports } from "./jsx-components";
import { kebabToCamel } from "./case";
import { ROOT_POSITION_KEYS, getNodeOrThrow, indent, textRuns, textStyles, visibleChildren, withoutKeys } from "./export-common";
import { stylesToTailwind } from "./tailwind";

export interface NodeToJsxOptions {
  format: "tailwind" | "inline-styles";
  /** Adds `id="<nodeId>"` to every element. */
  includeNodeIds?: boolean;
  /** Keep position/left/top/right/bottom on the exported root (stripped by default). */
  includeRootPositioning?: boolean;
  /** Emit `<Button variant="primary" />` for instances of components with a code mapping (default true). */
  codeComponents?: boolean;
}

interface Ctx {
  doc: FoldDocument;
  opts: NodeToJsxOptions;
  tokens: Token[];
  imports: CodeImports;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** A JSX attribute: plain string when safe, otherwise an expression. */
export function jsxAttr(name: string, value: string): string {
  if (/["\\\n\r&{}]/.test(value)) return `${name}={${JSON.stringify(value)}}`;
  return `${name}="${value}"`;
}

function jsxValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return JSON.stringify(value) ?? "undefined";
}

function styleObject(styles: StyleMap): string {
  const entries = Object.entries(styles);
  if (!entries.length) return "";
  const body = entries
    .map(([k, v]) => `${IDENT.test(k) ? k : JSON.stringify(k)}: ${jsxValue(v)}`)
    .join(", ");
  return `style={{ ${body} }}`;
}

function escapeJsxText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}

function textContent(text: string): string {
  return text.split("\n").map(escapeJsxText).join("<br />");
}

/** SVG attribute name as written in JSX: stroke-width → strokeWidth, xlink:href → xlinkHref, class → className. */
export function svgAttrToJsx(name: string): string {
  if (name === "class") return "className";
  if (name === "for") return "htmlFor";
  if (/^(data|aria)-/.test(name)) return name;
  if (name.includes(":")) {
    const [ns, local] = name.split(":", 2);
    return ns + local.charAt(0).toUpperCase() + kebabToCamel(local).slice(1);
  }
  if (name.includes("-")) return kebabToCamel(name);
  return name;
}

/**
 * A Text node linked to a text style exports the style's utility class (`type-heading`) plus classes
 * for the properties it overrides. Returns null when the node has no (known) text style.
 */
function linkedTextStyle(doc: FoldDocument, node: OFNode, styles: StyleMap): { className: string; rest: StyleMap } | null {
  const style = node.textStyle ? doc.textStyles?.find((s) => s.id === node.textStyle) : undefined;
  const className = style ? textStyleSlug(style.name) : "";
  if (!style || !className) return null;
  const rest: StyleMap = {};
  for (const [k, v] of Object.entries(styles)) if (style.styles[k] !== v) rest[k] = v;
  return { className, rest };
}

function styleAttrs(ctx: Ctx, styles: StyleMap, extraClasses: string[] = []): string[] {
  if (ctx.opts.format === "tailwind") {
    const { classes: mapped, rest } = stylesToTailwind(styles, ctx.tokens);
    const classes = [...extraClasses, ...mapped];
    const out: string[] = [];
    if (classes.length) out.push(jsxAttr("className", classes.join(" ")));
    const s = styleObject(rest);
    if (s) out.push(s);
    return out;
  }
  const s = styleObject(styles);
  return s ? [s] : [];
}

function openTag(tag: string, attrs: string[]): string {
  return attrs.length ? `<${tag} ${attrs.join(" ")}` : `<${tag}`;
}

function shaderProps(params: Record<string, unknown> | undefined): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined) continue;
    if (!IDENT.test(k)) {
      out.push(`{...${JSON.stringify({ [k]: v })}}`);
    } else if (typeof v === "string") {
      out.push(jsxAttr(k, v));
    } else {
      out.push(`${k}={${jsxValue(v)}}`);
    }
  }
  return out;
}

/** Shader fill drawn behind the children: absolutely positioned under a stacking context. */
const SHADER_FILL_STYLE = `style={{ position: "absolute", inset: 0, zIndex: -1, borderRadius: "inherit", overflow: "hidden", pointerEvents: "none" }}`;

function shaderFill(node: OFNode): { name: string; params: Record<string, unknown> } | null {
  const spec = node.paint?.shader;
  return spec && !node.paint?.shaderHidden && spec.name ? spec : null;
}

/** Shader component names used by a subtree (Shader nodes and shader fills), for an import line. */
export function shaderComponentsIn(doc: FoldDocument, id: NodeId): string[] {
  const out = new Set<string>();
  const walk = (n: OFNode | undefined) => {
    if (!n || (!n.visible && n.type !== "Root")) return;
    if (n.type === "Shader" && n.shader?.name) out.add(componentName(n.shader.name));
    const fill = shaderFill(n);
    if (fill) out.add(componentName(fill.name));
    for (const c of n.children) walk(doc.nodes[c]);
  };
  walk(doc.nodes[id]);
  return [...out];
}

function componentName(name: string | undefined): string {
  const cleaned = (name ?? "").replace(/[^\w$]/g, "");
  return cleaned && /^[A-Z]/.test(cleaned) ? cleaned : `Shader${cleaned ? `_${cleaned}` : ""}`;
}

function render(ctx: Ctx, node: OFNode, depth: number, isRoot: boolean): string[] {
  const pad = indent(depth);
  if (node.type === "Root") {
    return visibleChildren(ctx.doc, node).flatMap((c) => render(ctx, c, depth, true));
  }
  if (node.instance && ctx.opts.codeComponents !== false) {
    const code = renderCodeInstance(ctx.doc, node, depth, ctx.imports, {
      idAttr: ctx.opts.includeNodeIds ? jsxAttr("id", node.id) : undefined,
      renderChild: (child, d) => render(ctx, child, d, false),
    });
    if (code) return code;
  }
  let styles: StyleMap = node.type === "Text" ? textStyles(node) : { ...node.styles };
  if (isRoot && !ctx.opts.includeRootPositioning) styles = withoutKeys(styles, ROOT_POSITION_KEYS);

  const attrs: string[] = [];
  if (ctx.opts.includeNodeIds) attrs.push(jsxAttr("id", node.id));

  switch (node.type) {
    case "Text": {
      const linked = ctx.opts.format === "tailwind" ? linkedTextStyle(ctx.doc, node, styles) : null;
      if (linked) {
        attrs.push(...styleAttrs(ctx, linked.rest, [linked.className]));
      } else attrs.push(...styleAttrs(ctx, styles));
      const runs = textRuns(node);
      const body = runs
        ? runs
            .map((r) => {
              const content = textContent(r.text);
              if (!r.styles) return content;
              return `${openTag("span", styleAttrs(ctx, r.styles))}>${content}</span>`;
            })
            .join("")
        : textContent(node.text ?? "");
      return [`${pad}${openTag("div", attrs)}>${body}</div>`];
    }
    case "Image": {
      attrs.push(jsxAttr("src", node.src ?? ""), jsxAttr("alt", ""));
      attrs.push(...styleAttrs(ctx, styles));
      return [`${pad}${openTag("img", attrs)} />`];
    }
    case "Shader": {
      const tag = componentName(node.shader?.name);
      attrs.push(...shaderProps(node.shader?.params));
      attrs.push(...styleAttrs(ctx, styles));
      return [`${pad}${openTag(tag, attrs)} />`];
    }
    case "SVG":
    case "SVGElement": {
      const tag = node.tag || (node.type === "SVG" ? "svg" : "g");
      for (const [k, v] of Object.entries(node.attrs ?? {})) {
        if (k === "style") continue;
        attrs.push(jsxAttr(svgAttrToJsx(k), v));
      }
      attrs.push(...styleAttrs(ctx, styles));
      const children = visibleChildren(ctx.doc, node);
      if (children.length) {
        return [
          `${pad}${openTag(tag, attrs)}>`,
          ...children.flatMap((c) => render(ctx, c, depth + 1, false)),
          `${pad}</${tag}>`,
        ];
      }
      if (node.text) return [`${pad}${openTag(tag, attrs)}>${textContent(node.text)}</${tag}>`];
      return [`${pad}${openTag(tag, attrs)} />`];
    }
    default: {
      if (node.mode) attrs.push(jsxAttr("data-mode", node.mode));
      const fill = shaderFill(node);
      if (fill) {
        styles = { ...styles, isolation: "isolate" };
        if (styles.position === undefined) styles.position = "relative";
      }
      attrs.push(...styleAttrs(ctx, styles));
      const children = visibleChildren(ctx.doc, node);
      const fillLine = fill
        ? [`${indent(depth + 1)}${openTag(componentName(fill.name), [...shaderProps(fill.params), SHADER_FILL_STYLE])} />`]
        : [];
      if (!children.length && !fill) return [`${pad}${openTag("div", attrs)} />`];
      return [
        `${pad}${openTag("div", attrs)}>`,
        ...fillLine,
        ...children.flatMap((c) => render(ctx, c, depth + 1, false)),
        `${pad}</div>`,
      ];
    }
  }
}

/**
 * Exports a node subtree as JSX, pretty-printed with 2-space indentation. Hidden descendants are omitted.
 * Text → `<div>` (newlines as `<br />`), Image → `<img>`, SVG → JSX svg, Shader → `<MeshGradient ... />`
 * (from `@paper-design/shaders-react`). A Root node exports its artboards (wrapped in a fragment if several).
 */
export function nodeToJsx(doc: FoldDocument, id: NodeId, opts: NodeToJsxOptions): string {
  const node = getNodeOrThrow(doc, id);
  const ctx: Ctx = { doc, opts, tokens: doc.tokens ?? [], imports: new Map() };
  let body: string;
  if (node.type === "Root") {
    const children = visibleChildren(doc, node);
    body = children.length === 1
      ? render(ctx, children[0], 0, true).join("\n")
      : ["<>", ...children.flatMap((c) => render(ctx, c, 1, true)), "</>"].join("\n");
  } else {
    body = render(ctx, node, 0, true).join("\n");
  }
  const imports = importLines(ctx.imports);
  return imports.length ? `${imports.join("\n")}\n\n${body}` : body;
}
