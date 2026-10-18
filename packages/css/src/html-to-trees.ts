import type { NodeTree, StyleMap, StyleValue } from "@opencrease/model";
import { safeImageUrl, safeSvgAttrs, SVG_TAGS } from "./security";
import { ElementType, parseDocument } from "htmlparser2";
import { normalizeStyles, parseInlineStyle } from "./styles";

type DomDocument = ReturnType<typeof parseDocument>;
type DomNode = DomDocument["children"][number];
type DomElement = Extract<DomNode, { attribs: Record<string, string> }>;
type DomText = Extract<DomNode, { type: typeof ElementType.Text }>;

function isTag(node: DomNode): node is DomElement {
  return node.type === ElementType.Tag || node.type === ElementType.Script || node.type === ElementType.Style;
}

function isText(node: DomNode): node is DomText {
  return node.type === ElementType.Text;
}

function isIgnorable(node: DomNode): boolean {
  return node.type === ElementType.Comment || node.type === ElementType.Directive || node.type === ElementType.CDATA;
}

export interface HtmlToTreesOptions {
  /** Maps `paper-asset://...` and `asset://...` URLs (img src, svg image href, css url()) to stored URLs. */
  resolveAssetUrl?(url: string): string;
  /**
   * Code component names (codeRef exports such as "Button") accepted as tags, so JSX from get_jsx
   * (`<Button variant="primary" />`) comes back as instances. Matched case-sensitively.
   */
  componentTags?: Iterable<string>;
}

export interface HtmlToTreesResult {
  trees: NodeTree[];
  warnings: string[];
}

/** Elements flattened into a Text node when they only contain text. */
const INLINE_TAGS = new Set([
  "span", "b", "strong", "i", "em", "br", "a", "small", "code", "u", "s", "mark", "sub", "sup",
  "abbr", "del", "ins", "kbd", "q", "cite", "time", "font", "wbr",
]);

/** Dropped silently (document metadata). */
const SILENT_DROP = new Set(["head", "meta", "link", "title", "base", "template", "noscript", "source", "track", "param"]);
/** Dropped with a warning, content discarded. */
const LOUD_DROP = new Set([
  "script", "style", "iframe", "video", "audio", "object", "embed", "input", "select", "option",
  "optgroup", "datalist", "frame", "frameset", "applet", "dialog", "math",
]);
/** Dropped with a warning, text content kept as a Text node. */
const DROP_KEEP_TEXT = new Set(["table", "textarea"]);
/** Unwrapped (children kept, element itself ignored). */
const TRANSPARENT = new Set(["html", "body"]);

const SVG_DROP = new Set(["script", "style", "foreignObject", "foreignobject"]);
/** The HTML parser lowercases tag names; SVG needs the camelCase ones back (linearGradient, clipPath, ...). */
const SVG_TAG_CASE: Record<string, string> = Object.fromEntries(
  [
    "altGlyph", "animateMotion", "animateTransform", "clipPath", "feBlend", "feColorMatrix", "feComponentTransfer",
    "feComposite", "feConvolveMatrix", "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feDropShadow",
    "feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR", "feGaussianBlur", "feImage", "feMerge", "feMergeNode",
    "feMorphology", "feOffset", "fePointLight", "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence",
    "glyphRef", "linearGradient", "radialGradient", "textPath",
  ].map((t) => [t.toLowerCase(), t]),
);
const LAYOUT_KEYS = ["flexDirection", "flexWrap", "gap", "rowGap", "columnGap", "alignItems", "justifyContent", "alignContent"];

type WsMode = "normal" | "pre" | "pre-line";

interface Ctx {
  warnings: string[];
  resolve?: (url: string) => string;
}

function warn(ctx: Ctx, message: string): void {
  if (!ctx.warnings.includes(message)) ctx.warnings.push(message);
}

function attr(el: DomElement, name: string): string | undefined {
  if (name in el.attribs) return el.attribs[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(el.attribs)) if (k.toLowerCase() === lower) return v;
  return undefined;
}

function tagOf(el: DomElement): string {
  return el.name.toLowerCase();
}

function describe(el: DomElement): string {
  const name = attr(el, "layer-name");
  return name ? `<${el.name} layer-name="${name}">` : `<${el.name}>`;
}

function isAssetUrl(url: string): boolean {
  return /^(paper-asset|asset):\/\//i.test(url.trim());
}

function resolveUrl(ctx: Ctx, url: string): string {
  const u = url.trim();
  if (!safeImageUrl(u)) { warn(ctx, `Blocked image URL: ${u}`); return ""; }
  return ctx.resolve && isAssetUrl(u) ? ctx.resolve(u) : u;
}

/** Applies the asset resolver to `url(...)` references inside a CSS value. */
function resolveCssUrls(ctx: Ctx, value: string): string {
  if (!ctx.resolve || !/(paper-asset|asset):\/\//i.test(value)) return value;
  return value.replace(/url\(\s*(["']?)((?:paper-asset|asset):\/\/[^"')]*)\1\s*\)/gi, (_m, q: string, url: string) => {
    return `url(${q}${resolveUrl(ctx, url)}${q})`;
  });
}

function hasStyleAttr(el: DomElement): boolean {
  const s = attr(el, "style");
  return s !== undefined && s.trim() !== "";
}

function elementStyles(ctx: Ctx, el: DomElement): StyleMap {
  const raw = attr(el, "style");
  if (!raw) return {};
  const { styles, ignored } = normalizeStyles(parseInlineStyle(raw));
  if (ignored.length) warn(ctx, `Ignored styles on ${describe(el)}: ${ignored.join(", ")}`);
  for (const [k, v] of Object.entries(styles)) {
    if (typeof v === "string") styles[k] = resolveCssUrls(ctx, v);
  }
  return styles;
}

function tagDefaults(tag: string): StyleMap {
  switch (tag) {
    case "pre":
    case "code":
    case "kbd":
      return { whiteSpace: "pre", fontFamily: "monospace" };
    case "b":
    case "strong":
      return { fontWeight: 700 };
    case "i":
    case "em":
    case "cite":
      return { fontStyle: "italic" };
    case "u":
    case "ins":
      return { textDecoration: "underline" };
    case "s":
    case "del":
      return { textDecoration: "line-through" };
    default:
      return {};
  }
}

/** Explicit styles win over tag defaults. */
function stylesWithDefaults(ctx: Ctx, el: DomElement): StyleMap {
  return { ...tagDefaults(tagOf(el)), ...elementStyles(ctx, el) };
}

function wsModeFor(el: DomElement, styles: StyleMap, inherited: WsMode): WsMode {
  // `pre` tags and explicit white-space styles change the mode; the default whiteSpace of <code> does not.
  const explicit = parseInlineStyle(attr(el, "style") ?? "").whiteSpace;
  const ws = explicit ?? (tagOf(el) === "pre" ? String(styles.whiteSpace ?? "pre") : undefined);
  if (ws === undefined) return inherited;
  const v = ws.toLowerCase();
  if (v === "pre" || v === "pre-wrap" || v === "break-spaces") return "pre";
  if (v === "pre-line") return "pre-line";
  return "normal";
}

function withName(tree: NodeTree, el: DomElement): NodeTree {
  const name = attr(el, "layer-name");
  if (name !== undefined && name.trim() !== "") tree.name = name;
  const mode = attr(el, "data-mode");
  if (mode !== undefined && mode.trim() !== "" && tree.type === "Frame") tree.mode = mode.trim();
  const paint = attr(el, "data-paint");
  if (paint && paint.trim()) {
    try {
      const parsed: unknown = JSON.parse(paint);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) tree.paint = parsed as NodeTree["paint"];
    } catch {
      // not JSON: ignore, the element still converts
    }
  }
  return tree;
}

function withStyles(tree: NodeTree, styles: StyleMap): NodeTree {
  if (Object.keys(styles).length) tree.styles = styles;
  return tree;
}

// ---------------------------------------------------------------------------------------------
// Text handling

function textData(node: DomNode): string | null {
  return isText(node) ? node.data : null;
}

function hasText(el: DomElement): boolean {
  for (const child of el.children) {
    const t = textData(child);
    if (t !== null && /\S/.test(t.replace(/ /g, "x"))) return true;
    if (isTag(child) && hasText(child)) return true;
  }
  return false;
}

/** Text, comments, <br> and inline formatting elements that only contain such nodes. */
function isInlineItem(node: DomNode): boolean {
  if (isText(node) || isIgnorable(node)) return true;
  if (!isTag(node)) return false;
  const tag = tagOf(node);
  if (tag === "br" || tag === "wbr") return true;
  if (!INLINE_TAGS.has(tag)) return false;
  if (!hasText(node) && hasStyleAttr(node)) return false; // styled empty span: a shape, not text
  return node.children.every(isInlineItem);
}

function collapse(raw: string, ws: WsMode): string {
  if (ws === "pre") return raw.replace(/\r\n?/g, "\n");
  if (ws === "pre-line") return raw.replace(/\r\n?/g, "\n").replace(/[ \t\f]+/g, " ");
  return raw.replace(/[ \t\n\r\f]+/g, " ");
}

function rawText(nodes: DomNode[], ws: WsMode): string {
  let out = "";
  for (const node of nodes) {
    const t = textData(node);
    if (t !== null) out += collapse(t, ws);
    else if (isTag(node)) {
      const tag = tagOf(node);
      if (tag === "br") out += "\n";
      else if (tag !== "wbr") out += rawText(node.children, ws);
    }
  }
  return out;
}

function finishText(text: string, ws: WsMode): string {
  if (ws === "pre") return text;
  return text.replace(/ {2,}/g, " ").replace(/ *\n */g, "\n").replace(/^ +| +$/g, "");
}

function isSignificant(node: DomNode, ws: WsMode): boolean {
  if (isIgnorable(node)) return false;
  const t = textData(node);
  if (t !== null) return ws === "pre" ? t.length > 0 : /[^ \t\n\r\f]/.test(t);
  return true;
}

function hasFormatting(nodes: DomNode[]): boolean {
  return nodes.some(
    (n) =>
      isTag(n) &&
      tagOf(n) !== "br" &&
      (hasStyleAttr(n) || Object.keys(tagDefaults(tagOf(n))).length > 0 || hasFormatting(n.children)),
  );
}

/**
 * Builds a Text tree from inline nodes. When the whole text is wrapped by a single inline element,
 * that element's styles (and tag defaults) are merged into the Text node; partial formatting is flattened.
 */
function makeText(
  ctx: Ctx,
  nodes: DomNode[],
  styles: StyleMap,
  ws: WsMode,
  stripLeadingNewline: boolean,
  nameFrom?: DomElement,
): NodeTree | null {
  const significant = nodes.filter((n) => isSignificant(n, ws));
  if (significant.length === 1) {
    const only = significant[0];
    if (isTag(only) && tagOf(only) !== "br" && tagOf(only) !== "wbr") {
      const inner = { ...styles, ...stylesWithDefaults(ctx, only) };
      const innerWs = wsModeFor(only, inner, ws);
      const hasOwnName = attr(only, "layer-name") !== undefined;
      return makeText(ctx, only.children, inner, innerWs, tagOf(only) === "pre", hasOwnName ? only : nameFrom);
    }
  }
  if (hasFormatting(nodes)) {
    const spans = richRuns(ctx, nodes, ws, stripLeadingNewline);
    const joined = spans.map((s) => s.text).join("");
    if (!/[^\s]/.test(joined.replace(/ /g, "x"))) return null;
    const rich: NodeTree = { type: "Text", text: joined };
    if (spans.some((s) => s.styles)) rich.spans = spans;
    if (nameFrom) withName(rich, nameFrom);
    return withStyles(rich, styles);
  }
  let text = rawText(nodes, ws);
  if (stripLeadingNewline && text.startsWith("\n")) text = text.slice(1);
  text = finishText(text, ws);
  if (!/[^\s]/.test(text.replace(/ /g, "x"))) return null;
  const tree: NodeTree = { type: "Text", text };
  if (nameFrom) withName(tree, nameFrom);
  return withStyles(tree, styles);
}

/** Inline styles that make sense on a run of text (layout and box properties stay on the Text node). */
export const SPAN_STYLE_KEYS: ReadonlySet<string> = new Set([
  "color", "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "fontVariationSettings",
  "fontFeatureSettings", "fontOpticalSizing", "fontKerning", "fontVariantNumeric", "fontVariantLigatures",
  "fontVariantCaps", "fontSynthesis", "letterSpacing", "wordSpacing", "lineHeight", "textTransform",
  "textDecoration", "textDecorationLine", "textDecorationColor", "textDecorationStyle", "textDecorationThickness",
  "textUnderlineOffset", "textUnderlinePosition", "textShadow", "backgroundColor", "backgroundImage",
  "backgroundClip", "WebkitBackgroundClip", "WebkitTextFillColor", "WebkitTextStroke", "WebkitTextStrokeWidth",
  "WebkitTextStrokeColor", "opacity",
]);

function spanStyles(ctx: Ctx, el: DomElement, styles: StyleMap): StyleMap | undefined {
  const out: StyleMap = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(styles)) {
    if (SPAN_STYLE_KEYS.has(k)) out[k] = v;
    else if (k !== "whiteSpace") dropped.push(k);
  }
  if (dropped.length) warn(ctx, `Inline ${describe(el)} inside text keeps only text styles; ignored: ${dropped.join(", ")}`);
  return Object.keys(out).length ? out : undefined;
}

/**
 * Inline formatting as rich text runs. Whitespace collapses like the plain-text path (`finishText`),
 * character by character, so each run keeps its own styles through the collapsing.
 */
function richRuns(ctx: Ctx, nodes: DomNode[], ws: WsMode, stripLeadingNewline: boolean): Array<{ text: string; styles?: StyleMap }> {
  const chars: string[] = [];
  const owner: Array<StyleMap | undefined> = [];
  const visit = (list: DomNode[], styles: StyleMap | undefined, mode: WsMode) => {
    for (const node of list) {
      const t = textData(node);
      if (t !== null) {
        for (const ch of collapse(t, mode)) {
          chars.push(ch);
          owner.push(styles);
        }
      } else if (isTag(node)) {
        const tag = tagOf(node);
        if (tag === "br") {
          chars.push("\n");
          owner.push(styles);
        } else if (tag !== "wbr") {
          const own = stylesWithDefaults(ctx, node);
          const merged = spanStyles(ctx, node, { ...(styles ?? {}), ...own });
          visit(node.children, merged, wsModeFor(node, own, mode));
        }
      }
    }
  };
  visit(nodes, undefined, ws);
  if (stripLeadingNewline && chars[0] === "\n") {
    chars.shift();
    owner.shift();
  }
  const keep = chars.map(() => true);
  if (ws !== "pre") {
    let prev = "";
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === " " && (prev === " " || prev === "\n" || prev === "")) keep[i] = false;
      else prev = chars[i];
    }
    let next = "";
    for (let i = chars.length - 1; i >= 0; i--) {
      if (!keep[i]) continue;
      if (chars[i] === " " && (next === "\n" || next === "")) keep[i] = false;
      else next = chars[i];
    }
  }
  const runs: Array<{ text: string; styles?: StyleMap }> = [];
  for (let i = 0; i < chars.length; i++) {
    if (!keep[i]) continue;
    const styles = owner[i];
    const last = runs[runs.length - 1];
    if (last && JSON.stringify(last.styles ?? null) === JSON.stringify(styles ?? null)) last.text += chars[i];
    else runs.push(styles ? { text: chars[i], styles } : { text: chars[i] });
  }
  return runs;
}

function tableText(el: DomElement): string {
  const rows: string[] = [];
  const visit = (node: DomNode) => {
    if (!isTag(node)) return;
    if (tagOf(node) === "tr") {
      const cells = node.children
        .filter((c): c is DomElement => isTag(c) && (tagOf(c) === "td" || tagOf(c) === "th"))
        .map((c) => finishText(rawText(c.children, "normal"), "normal"))
        .filter((c) => c !== "");
      if (cells.length) rows.push(cells.join(" "));
      return;
    }
    node.children.forEach(visit);
  };
  visit(el);
  if (rows.length) return rows.join("\n");
  return finishText(rawText(el.children, "normal"), "normal");
}

// ---------------------------------------------------------------------------------------------
// Elements

function convertChildren(ctx: Ctx, nodes: DomNode[], ws: WsMode): NodeTree[] {
  const out: NodeTree[] = [];
  let run: DomNode[] = [];
  const flush = () => {
    if (run.length) {
      const t = makeText(ctx, run, {}, ws, false);
      if (t) out.push(t);
      run = [];
    }
  };
  for (const node of nodes) {
    if (isInlineItem(node)) {
      run.push(node);
      continue;
    }
    flush();
    if (isTag(node)) out.push(...convertElement(ctx, node, ws));
  }
  flush();
  return out;
}

/** Flex and grid containers: every child element is its own item. */
function isFlex(styles: StyleMap): boolean {
  return styles.display === "flex" || styles.display === "inline-flex" || styles.display === "grid";
}

/** Children of a flex container: each element is an item, and each run of loose text becomes a Text item. */
function convertFlexItems(ctx: Ctx, nodes: DomNode[], ws: WsMode): NodeTree[] {
  const out: NodeTree[] = [];
  let run: DomNode[] = [];
  const flush = () => {
    if (run.length) {
      const t = makeText(ctx, run, {}, ws, false);
      if (t) out.push(t);
      run = [];
    }
  };
  for (const node of nodes) {
    if (!isTag(node) || tagOf(node) === "br" || tagOf(node) === "wbr") {
      run.push(node);
      continue;
    }
    flush();
    if (isInlineItem(node)) {
      const t = makeText(ctx, [node], {}, ws, false);
      if (t) out.push(t);
    } else out.push(...convertElement(ctx, node, ws));
  }
  flush();
  return out;
}

function sizeFromAttr(value: string | undefined): StyleValue | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (v === "") return undefined;
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function convertImage(ctx: Ctx, el: DomElement): NodeTree {
  const styles = elementStyles(ctx, el);
  for (const dim of ["width", "height"] as const) {
    const v = sizeFromAttr(attr(el, dim));
    if (styles[dim] === undefined && v !== undefined) styles[dim] = v;
  }
  const src = attr(el, "src");
  if (!src) warn(ctx, `${describe(el)} has no src.`);
  const tree: NodeTree = { type: "Image", src: src ? resolveUrl(ctx, src) : "" };
  return withStyles(withName(tree, el), styles);
}

function svgAttrs(ctx: Ctx, el: DomElement): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(el.attribs)) {
    const lower = k.toLowerCase();
    if (lower === "style" || lower === "layer-name" || lower === "data-of-id") continue;
    attrs[k] = (lower === "href" || lower === "xlink:href") && isAssetUrl(v) ? resolveUrl(ctx, v) : v;
  }
  return safeSvgAttrs(attrs, el.name);
}

function convertSvgChild(ctx: Ctx, el: DomElement): NodeTree | null {
  if (SVG_DROP.has(el.name) || !SVG_TAGS.has(el.name)) {
    warn(ctx, `Dropped unsupported <${el.name}> inside <svg>.`);
    return null;
  }
  const tree: NodeTree = { type: "SVGElement", tag: SVG_TAG_CASE[el.name] ?? el.name, attrs: svgAttrs(ctx, el) };
  withName(tree, el);
  withStyles(tree, elementStyles(ctx, el));
  const elementChildren = el.children.filter((c): c is DomElement => isTag(c));
  if (elementChildren.length === 0) {
    const text = finishText(rawText(el.children, "normal"), "normal");
    if (text) tree.text = text;
  } else {
    if (el.children.some((c) => isText(c) && /\S/.test(c.data))) {
      warn(ctx, `Text mixed with elements inside <${el.name}> was dropped.`);
    }
    const children = elementChildren.map((c) => convertSvgChild(ctx, c)).filter((c): c is NodeTree => c !== null);
    if (children.length) tree.children = children;
  }
  return tree;
}

function convertSvg(ctx: Ctx, el: DomElement): NodeTree {
  const styles = elementStyles(ctx, el);
  for (const dim of ["width", "height"] as const) {
    const v = sizeFromAttr(attr(el, dim));
    if (styles[dim] === undefined && v !== undefined) styles[dim] = v;
  }
  const tree: NodeTree = { type: "SVG", tag: "svg", attrs: svgAttrs(ctx, el) };
  withName(tree, el);
  withStyles(tree, styles);
  const children = el.children
    .filter((c): c is DomElement => isTag(c))
    .map((c) => convertSvgChild(ctx, c))
    .filter((c): c is NodeTree => c !== null);
  if (children.length) tree.children = children;
  return tree;
}

function convertShader(ctx: Ctx, el: DomElement, name: string): NodeTree {
  let params: Record<string, unknown> = {};
  const raw = attr(el, "data-params");
  if (raw && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) params = parsed as Record<string, unknown>;
      else warn(ctx, `data-params of shader "${name}" must be a JSON object.`);
    } catch {
      warn(ctx, `data-params of shader "${name}" is not valid JSON.`);
    }
  }
  const tree: NodeTree = { type: "Shader", shader: { name: name.trim(), params } };
  return withStyles(withName(tree, el), elementStyles(ctx, el));
}

function convertClone(ctx: Ctx, el: DomElement): NodeTree[] {
  const id = attr(el, "node-id") ?? attr(el, "nodeid") ?? attr(el, "data-node-id");
  if (!id || !id.trim()) {
    warn(ctx, `Dropped <${el.name}> without a node-id attribute.`);
    return [];
  }
  const tree: NodeTree = { cloneOf: id.trim() };
  withName(tree, el);
  return [withStyles(tree, elementStyles(ctx, el))];
}

const INSTANCE_RESERVED = new Set(["component", "code", "library", "props", "overrides", "style", "layer-name", "id", "node-id", "data-of-id", "class", "classname", "key"]);

function parseJsonAttr(ctx: Ctx, el: DomElement, name: string): Record<string, unknown> | undefined {
  const raw = attr(el, name);
  if (raw === undefined || !raw.trim()) return undefined;
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // fall through to the warning
  }
  warn(ctx, `The ${name} attribute of <x-instance> must be a JSON object.`);
  return undefined;
}

/** Attribute value as a prop value: "{true}" → true, "{false}" → false, '{"x"}' → "x", "" (bare) → true. */
function propValueFromAttr(raw: string): string | boolean {
  const v = raw.trim();
  if (v === "" || v === "{true}") return true;
  if (v === "{false}") return false;
  const expr = /^\{([\s\S]*)\}$/.exec(v);
  if (expr) {
    try {
      const parsed: unknown = JSON.parse(expr[1]);
      if (typeof parsed === "string" || typeof parsed === "boolean") return parsed;
      if (typeof parsed === "number") return String(parsed);
    } catch {
      return expr[1].trim();
    }
  }
  return raw;
}

/**
 * `<x-instance component="ID or name" props='{"label":"Hi"}' style="...">` → an instance tree.
 * Other attributes are prop values too (design or code prop names). Children: `<x-slot name="...">`
 * fills a slot, plain text sets the prop mapped to `children`, other elements are fallback layers used
 * only when the component does not exist in the file.
 */
function convertInstance(ctx: Ctx, el: DomElement): NodeTree[] {
  const component = (attr(el, "component") ?? attr(el, "code") ?? "").trim();
  if (!component) {
    warn(ctx, "Dropped <x-instance> without a component attribute.");
    return [];
  }
  const props: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(parseJsonAttr(ctx, el, "props") ?? {})) {
    if (typeof v === "string" || typeof v === "boolean") props[k] = v;
    else if (typeof v === "number") props[k] = String(v);
  }
  for (const [k, v] of Object.entries(el.attribs)) {
    if (INSTANCE_RESERVED.has(k.toLowerCase()) || k.startsWith("data-")) continue;
    props[k] = propValueFromAttr(v);
  }
  const slots: Record<string, NodeTree[]> = {};
  const fallback: DomNode[] = [];
  for (const child of el.children) {
    if (isTag(child) && tagOf(child) === "x-slot") {
      const name = attr(child, "name")?.trim();
      if (name) slots[name] = convertChildren(ctx, child.children, "normal");
      else warn(ctx, "Dropped <x-slot> without a name attribute.");
    } else fallback.push(child);
  }
  if (fallback.length && fallback.every(isInlineItem) && props.children === undefined) {
    const text = finishText(rawText(fallback, "normal"), "normal");
    if (text) props.children = text;
  }
  const spec: NonNullable<NodeTree["instance"]> = { component };
  const library = attr(el, "library")?.trim();
  if (library) spec.library = library;
  if (Object.keys(props).length) spec.props = props;
  const overrides = parseJsonAttr(ctx, el, "overrides");
  if (overrides) spec.overrides = overrides as NonNullable<NodeTree["instance"]>["overrides"];
  if (Object.keys(slots).length) spec.slots = slots;
  const tree: NodeTree = { instance: spec };
  withName(tree, el);
  withStyles(tree, elementStyles(ctx, el));
  if (!fallback.every(isInlineItem)) {
    const children = convertChildren(ctx, fallback, "normal");
    if (children.length) tree.children = children;
  }
  return [tree];
}

/** Rewrites `<Button ...>` / `</Button>` for known code components into `<x-instance code="Button" ...>`. */
function rewriteComponentTags(html: string, names: Iterable<string>): string {
  let out = html;
  for (const name of names) {
    if (!/^[A-Z][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(name)) continue;
    const esc = name.replace(/[.$]/g, "\\$&");
    out = out
      .replace(new RegExp(`<${esc}(?=[\\s/>])`, "g"), `<x-instance code="${name}"`)
      .replace(new RegExp(`</${esc}\\s*>`, "g"), "</x-instance>");
  }
  return out;
}

function convertElement(ctx: Ctx, el: DomElement, inheritedWs: WsMode): NodeTree[] {
  const tag = tagOf(el);
  if (SILENT_DROP.has(tag)) return [];
  if (TRANSPARENT.has(tag)) return convertChildren(ctx, el.children, inheritedWs);
  if (tag === "x-paper-clone" || tag === "x-clone") return convertClone(ctx, el);
  if (tag === "x-instance") return convertInstance(ctx, el);
  if (tag === "x-slot") {
    warn(ctx, "<x-slot> only works directly inside <x-instance>; its content was inserted as is.");
    return convertChildren(ctx, el.children, inheritedWs);
  }
  if (tag === "img") return [convertImage(ctx, el)];
  if (tag === "svg") return [convertSvg(ctx, el)];
  if (tag === "canvas") {
    const shader = attr(el, "data-shader");
    if (shader && shader.trim()) return [convertShader(ctx, el, shader)];
    warn(ctx, `Dropped <canvas> without data-shader.`);
    return [];
  }
  if (LOUD_DROP.has(tag)) {
    warn(ctx, `Dropped unsupported <${tag}> element.`);
    return [];
  }
  if (DROP_KEEP_TEXT.has(tag)) {
    warn(ctx, `Dropped unsupported <${tag}> element; its text was kept as a Text node.`);
    const text = tag === "table" ? tableText(el) : rawText(el.children, "pre").replace(/^\n/, "");
    if (!/\S/.test(text)) return [];
    const tree: NodeTree = { type: "Text", text };
    return [withStyles(withName(tree, el), elementStyles(ctx, el))];
  }

  const styles = stylesWithDefaults(ctx, el);
  const ws = wsModeFor(el, styles, inheritedWs);

  // In a flex container every child element is its own flex item, even a <span>, so
  // `<div style="display:flex;gap:24px"><span>A</span><span>B</span></div>` keeps two items.
  const significant = el.children.filter((n) => isSignificant(n, ws));
  if (isFlex(styles) && significant.length > 1 && significant.some(isTag)) {
    const tree: NodeTree = { type: "Frame" };
    withName(tree, el);
    withStyles(tree, styles);
    tree.children = convertFlexItems(ctx, el.children, ws);
    return [tree];
  }

  // a mode can only be pinned on a Frame, so an element with data-mode stays a Frame around its text
  const pinsMode = (attr(el, "data-mode") ?? "").trim() !== "";
  if (el.children.every(isInlineItem) && !(pinsMode && significant.length > 0)) {
    const text = makeText(ctx, el.children, styles, ws, tag === "pre", el);
    if (text) return [text];
    const isFrame = styles.display === "flex" || styles.display === "grid" || LAYOUT_KEYS.some((k) => styles[k] !== undefined);
    const tree: NodeTree = { type: isFrame ? "Frame" : "Rectangle" };
    return [withStyles(withName(tree, el), styles)];
  }

  const tree: NodeTree = { type: "Frame" };
  withName(tree, el);
  withStyles(tree, styles);
  tree.children = convertChildren(ctx, el.children, ws);
  return [tree];
}

/**
 * Parses an HTML fragment (or document) with inline styles into node trees, following the rules in
 * docs/ARCHITECTURE.md. Only `style` attributes carry styling; `class`/`id` are ignored.
 */
export function htmlToTrees(html: string, opts: HtmlToTreesOptions = {}): HtmlToTreesResult {
  const ctx: Ctx = { warnings: [], resolve: opts.resolveAssetUrl };
  const source = opts.componentTags ? rewriteComponentTags(html ?? "", opts.componentTags) : (html ?? "");
  const dom = parseDocument(source, {
    lowerCaseAttributeNames: false,
    recognizeSelfClosing: true,
    decodeEntities: true,
  });
  const trees = convertChildren(ctx, dom.children, "normal");
  return { trees, warnings: ctx.warnings };
}
