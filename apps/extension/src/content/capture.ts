// Walks the live DOM and measures it into CapNodes: boxes in page coordinates, computed paint and text
// styles, rendered text with its line boxes, images and inline SVG. Layout is decided later (snapshot/layout.ts).
import { primaryFamily, pxNumber, snapshotStyles, isPaintless, isTransparent } from "../snapshot/styles";
import type { CapNode, CapText, CaptureOptions, FontUse, Rect, Sides } from "../snapshot/types";
import { PSEUDO_KIND_ATTR, PSEUDO_TAG, shadowOf } from "./pseudo";
import { serializeSvg } from "./svg";

export const UI_TAG = "of-snapshot-ui";

const REPLACED = new Set(["img", "svg", "video", "canvas", "iframe", "input", "textarea", "select", "object", "embed", "picture"]);
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "head", "meta", "link", "title", UI_TAG]);
const SEMANTIC_NAMES: Record<string, string> = {
  header: "Header", nav: "Navigation", main: "Main", footer: "Footer", section: "Section", article: "Article",
  aside: "Aside", form: "Form", button: "Button", a: "Link", ul: "List", ol: "List", li: "List item",
  figure: "Figure", figcaption: "Caption", table: "Table", tr: "Row", td: "Cell", th: "Cell", label: "Label",
  input: "Input", textarea: "Text area", select: "Select", blockquote: "Quote", dialog: "Dialog", body: "Body",
};

type Item =
  | { type: "text"; node: Text }
  | { type: "inline"; el: Element }
  | { type: "atomic"; el: Element }
  | { type: "block"; el: Element }
  | { type: "abs"; el: Element };

export interface CaptureResult {
  root: CapNode;
  name: string;
  fonts: FontUse[];
  warnings: string[];
}

function zeroSides(): Sides {
  return { t: 0, r: 0, b: 0, l: 0 };
}

function isHashedClass(c: string): boolean {
  return /^(css|sc|jsx|emotion|styled|svelte)-|^_|[A-Z0-9]{5,}|\d{3,}|^[a-z]{1,2}-?\d|:|\[|\//.test(c) || /^(flex|grid|block|inline|hidden|relative|absolute|items|justify|gap|p[xytrbl]?|m[xytrbl]?|w|h|min|max|text|font|bg|border|rounded|shadow|leading|tracking|space|col|row|z|top|left|right|bottom|overflow|opacity|transition|duration|ease|cursor|select|truncate)(-|$)/.test(c);
}

function humanise(s: string): string {
  const words = s.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

/** A readable layer name from an element: aria-label, semantic tag, a meaningful class or the id. */
export function layerName(el: Element): string | undefined {
  const tag = el.tagName.toLowerCase();
  if (tag === PSEUDO_TAG || el.hasAttribute(PSEUDO_KIND_ATTR)) return el.getAttribute(PSEUDO_KIND_ATTR) === "after" ? "After" : "Before";
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria && aria.length <= 40) return aria;
  if (tag === "img") {
    const alt = el.getAttribute("alt")?.trim();
    return alt && alt.length <= 40 ? alt : "Image";
  }
  if (tag === "svg") return "Icon";
  const cls = [...el.classList].find((c) => c.length > 2 && !isHashedClass(c));
  if (cls) return humanise(cls);
  if (SEMANTIC_NAMES[tag]) return SEMANTIC_NAMES[tag];
  if (el.id && !/\d{3,}/.test(el.id)) return humanise(el.id);
  return undefined;
}

/** "section.pricing" style label for the picker. */
export function selectorLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const cls = [...el.classList].find((c) => !isHashedClass(c));
  return cls ? `${tag}.${cls}` : el.id ? `${tag}#${el.id}` : tag;
}

function childNodesOf(el: Element): Node[] {
  const shadow = shadowOf(el);
  const list = shadow ? shadow.childNodes : el.childNodes;
  const out: Node[] = [];
  for (const n of list) {
    if (n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === "SLOT") {
      const assigned = (n as HTMLSlotElement).assignedNodes({ flatten: true });
      out.push(...(assigned.length ? assigned : [...n.childNodes]));
    } else out.push(n);
  }
  return out;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export class Walker {
  readonly warnings = new Set<string>();
  private fonts = new Map<string, { weights: Set<number>; italic: boolean }>();
  private sx = window.scrollX;
  private sy = window.scrollY;
  private svgCount = 0;
  private styleCache = new WeakMap<Element, CSSStyleDeclaration>();
  /** Viewport mode: in-flow nodes outside this rect are left out. */
  clip: Rect | null = null;

  constructor(private opts: CaptureOptions) {}

  warn(message: string): void {
    this.warnings.add(message);
  }

  cs(el: Element): CSSStyleDeclaration {
    let cs = this.styleCache.get(el);
    if (!cs) {
      cs = getComputedStyle(el);
      this.styleCache.set(el, cs);
    }
    return cs;
  }

  fontList(): FontUse[] {
    const loaded = new Set<string>();
    try {
      document.fonts.forEach((f) => {
        if (f.status === "loaded") loaded.add(f.family.replace(/^["']|["']$/g, "").toLowerCase());
      });
    } catch {
      // FontFaceSet not iterable here
    }
    return [...this.fonts.entries()].map(([family, v]) => ({
      family,
      weights: [...v.weights].sort((a, b) => a - b),
      italic: v.italic,
      loaded: loaded.has(family.toLowerCase()),
    }));
  }

  rectOf(el: Element): Rect {
    const r = el.getBoundingClientRect();
    let x = r.left + this.sx;
    let y = r.top + this.sy;
    let w = r.width;
    let h = r.height;
    const cs = this.cs(el);
    if (cs.transform && cs.transform !== "none" && "offsetWidth" in el) {
      // getBoundingClientRect is the transformed box; layout needs the untransformed one
      const he = el as HTMLElement;
      try {
        const m = new DOMMatrixReadOnly(cs.transform);
        const cx = x + w / 2 - m.e;
        const cy = y + h / 2 - m.f;
        w = he.offsetWidth;
        h = he.offsetHeight;
        x = cx - w / 2;
        y = cy - h / 2;
      } catch {
        // unparseable transform: keep the bounding box
      }
    }
    return { x, y, w, h };
  }

  private sides(cs: CSSStyleDeclaration, kind: "padding" | "border"): Sides {
    const get = (side: string) => pxNumber(cs.getPropertyValue(kind === "padding" ? `padding-${side}` : `border-${side}-width`)) ?? 0;
    const s = { t: get("top"), r: get("right"), b: get("bottom"), l: get("left") };
    if (kind === "border") {
      for (const [k, side] of [["t", "top"], ["r", "right"], ["b", "bottom"], ["l", "left"]] as const) {
        const style = cs.getPropertyValue(`border-${side}-style`);
        if (style === "none" || style === "hidden") s[k] = 0;
      }
    }
    return s;
  }

  private noteFont(cs: CSSStyleDeclaration): void {
    const family = primaryFamily(cs.fontFamily);
    if (!family) return;
    const entry = this.fonts.get(family) ?? { weights: new Set<number>(), italic: false };
    entry.weights.add(Number(cs.fontWeight) || 400);
    if (cs.fontStyle !== "normal") entry.italic = true;
    this.fonts.set(family, entry);
  }

  private read(el: Element): (p: string) => string {
    const cs = this.cs(el);
    return (p) => cs.getPropertyValue(p);
  }

  /** Classifies the rendered children of el, expanding display: contents and slots. */
  items(el: Element): Item[] {
    const out: Item[] = [];
    // children of flex and grid containers are blockified: each element is its own item
    const blockify = /^(inline-)?(flex|grid)$/.test(this.cs(el).display);
    const visit = (nodes: Node[]) => {
      for (const n of nodes) {
        if (n.nodeType === Node.TEXT_NODE) {
          const t = n as Text;
          if (t.data.length) out.push({ type: "text", node: t });
          continue;
        }
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        const c = n as Element;
        const tag = c.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag)) continue;
        const cs = this.cs(c);
        if (cs.display === "none") continue;
        if (cs.display === "contents") {
          visit(childNodesOf(c));
          continue;
        }
        if (cs.position === "absolute" || cs.position === "fixed") {
          out.push({ type: "abs", el: c });
          continue;
        }
        if (blockify) {
          out.push({ type: "block", el: c });
          continue;
        }
        if (tag === "br") {
          out.push({ type: "inline", el: c });
          continue;
        }
        const display = cs.display;
        if (REPLACED.has(tag) || tag === "button") {
          out.push({ type: display.startsWith("inline") ? "atomic" : "block", el: c });
          continue;
        }
        if (cs.float !== "none") {
          out.push({ type: "block", el: c });
          continue;
        }
        if (display === "inline") {
          out.push({ type: this.containsBlocks(c) ? "atomic" : "inline", el: c });
          continue;
        }
        out.push({ type: display.startsWith("inline") ? "atomic" : "block", el: c });
      }
    };
    visit(childNodesOf(el));
    return out;
  }

  /** An inline element that contains anything but text and other plain inline elements. */
  private containsBlocks(el: Element): boolean {
    return this.items(el).some((i) => i.type !== "text" && i.type !== "inline");
  }

  private hasVisibleText(items: Item[]): boolean {
    return items.some((i) => (i.type === "text" ? /\S/.test(i.node.data) : i.type === "inline" && i.el.tagName !== "BR" && this.hasVisibleText(this.items(i.el))));
  }

  /** Captures one element. Returns null for things that render nothing. */
  node(el: Element, flowOverride?: "in" | "abs"): CapNode | null {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return null;
    const cs = this.cs(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return null;
    const rect = this.rectOf(el);
    const flow = flowOverride ?? (cs.position === "absolute" || cs.position === "fixed" ? "abs" : "in");
    if (this.clip && flow === "in" && !intersects(rect, this.clip) && tag !== "body") return null;

    const base: CapNode = {
      kind: "frame",
      rect,
      styles: {},
      border: this.sides(cs, "border"),
      padding: this.sides(cs, "padding"),
      flow,
      children: [],
      paintless: true,
    };
    const name = layerName(el);
    if (name) base.name = name;
    const z = Number(cs.zIndex);
    if (flow === "abs" && Number.isFinite(z)) base.zIndex = z;
    if (cs.display === "flex" || cs.display === "inline-flex") base.hint = cs.flexDirection.startsWith("column") ? "column" : "row";

    if (tag === "img" || tag === "picture") return this.image(el, base);
    if (tag === "svg") return this.svg(el as SVGSVGElement, base);
    if (tag === "canvas" || tag === "video") return this.raster(el, base);
    if (tag === "iframe" || tag === "object" || tag === "embed") {
      this.warn("Embedded frames (iframes) are captured as empty boxes.");
      return this.frame(el, base, []);
    }
    if (tag === "input" || tag === "textarea" || tag === "select") return this.field(el, base);

    if (rect.w <= 0 && rect.h <= 0 && cs.overflow !== "visible") return null;
    const items = this.items(el);
    const inflow = items.filter((i) => i.type !== "abs");
    const onlyText = inflow.length > 0 && inflow.every((i) => i.type === "text" || i.type === "inline");
    if (onlyText && this.hasVisibleText(inflow) && !items.some((i) => i.type === "abs")) {
      const text = this.textLeaf(el, base, inflow);
      if (text) return text;
    }
    return this.frame(el, base, items);
  }

  private finishPaint(el: Element, n: CapNode, kind: CapNode["kind"]): CapNode {
    n.kind = kind;
    n.styles = snapshotStyles(this.read(el), { kind: kind === "text" ? "frame" : kind, keepFonts: this.opts.keepFonts });
    n.paintless = isPaintless(n.styles);
    return n;
  }

  private frame(el: Element, n: CapNode, items: Item[]): CapNode {
    this.finishPaint(el, n, "frame");
    const hasBlocks = items.some((i) => i.type === "block");
    let run: Item[] = [];
    const flush = () => {
      if (run.length) n.children.push(...this.inlineRun(el, n, run, hasBlocks));
      run = [];
    };
    for (const item of items) {
      if (item.type === "abs") {
        flush();
        const c = this.node(item.el, "abs");
        if (c) n.children.push(c);
      } else if (item.type === "block") {
        flush();
        const c = this.node(item.el);
        if (c && (c.rect.w > 0 || c.rect.h > 0 || c.children.length)) n.children.push(c);
      } else run.push(item);
    }
    flush();
    return n;
  }

  // ---------------------------------------------------------------------------------------------
  // text

  /** Range over a list of sibling-ish nodes. */
  private rangeOver(first: Node, last: Node): Range {
    const r = document.createRange();
    r.setStartBefore(first);
    r.setEndAfter(last);
    return r;
  }

  private lineInfo(rects: DOMRect[], lineHeightCss: string): Omit<CapText, "text" | "pre"> | null {
    const rs = rects.filter((r) => r.width > 0.5 && r.height > 0.5);
    if (!rs.length) return null;
    const lines: { top: number; bottom: number }[] = [];
    for (const r of [...rs].sort((a, b) => a.top - b.top)) {
      const line = lines.find((l) => r.top < l.bottom - 1 && r.bottom > l.top + 1);
      if (line) {
        line.top = Math.min(line.top, r.top);
        line.bottom = Math.max(line.bottom, r.bottom);
      } else lines.push({ top: r.top, bottom: r.bottom });
    }
    const contentH = lines[0].bottom - lines[0].top;
    const lh = pxNumber(lineHeightCss) ?? contentH;
    const first = lines[0];
    const last = lines[lines.length - 1];
    const lead = (l: { top: number; bottom: number }) => Math.max(0, (lh - (l.bottom - l.top)) / 2);
    return {
      lines: lines.length,
      lineHeight: lh,
      top: first.top - lead(first) + this.sy,
      bottom: last.bottom + lead(last) + this.sy,
      left: Math.min(...rs.map((r) => r.left)) + this.sx,
      right: Math.max(...rs.map((r) => r.right)) + this.sx,
    };
  }

  /** Text as rendered from DOM nodes: whitespace collapsed per white-space, <br> as "\n". */
  private collectText(nodes: Node[], pre: boolean): string {
    let out = "";
    const visit = (n: Node, preHere: boolean) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const data = (n as Text).data;
        out += preHere ? data : data.replace(/[ \t\n\r\f]+/g, " ");
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const el = n as Element;
      if (el.tagName === "BR") {
        out += "\n";
        return;
      }
      const cs = this.cs(el);
      if (cs.display === "none") return;
      const p = /^pre|break-spaces/.test(cs.whiteSpace);
      for (const c of childNodesOf(el)) visit(c, p);
    };
    for (const n of nodes) visit(n, pre);
    if (pre) return out;
    return out.replace(/ *\n */g, "\n").replace(/ {2,}/g, " ").replace(/^ +| +$/g, "");
  }

  /** The deepest element that contains all visible text: its computed text styles win. */
  private textStyleSource(el: Element, items: Item[]): Element {
    const visible = items.filter((i) => (i.type === "text" ? /\S/.test(i.node.data) : i.type === "inline" && i.el.tagName !== "BR"));
    if (visible.length === 1 && visible[0].type === "inline") {
      const inner = visible[0].el;
      return this.textStyleSource(inner, this.items(inner).filter((i) => i.type !== "abs"));
    }
    return el;
  }

  private textStyles(styleEl: Element): CapNode["styles"] {
    const all = snapshotStyles(this.read(styleEl), { kind: "text", keepFonts: this.opts.keepFonts });
    const textKeys = /^(color|font|lineHeight|letterSpacing|wordSpacing|textAlign|textTransform|textIndent|textDecoration|textUnderline|textShadow|wordBreak|overflowWrap|textOverflow|WebkitLineClamp|WebkitTextStroke|WebkitTextFill|textWrap)/;
    const out: CapNode["styles"] = {};
    for (const [k, v] of Object.entries(all)) if (textKeys.test(k)) out[k] = v;
    return out;
  }

  private textLeaf(el: Element, n: CapNode, items: Item[]): CapNode | null {
    const cs = this.cs(el);
    const pre = /^pre|break-spaces/.test(cs.whiteSpace);
    const nodes = childNodesOf(el);
    if (!nodes.length) return null;
    const styleEl = this.textStyleSource(el, items);
    const scs = this.cs(styleEl);
    const range = this.rangeOver(nodes[0], nodes[nodes.length - 1]);
    const info = this.lineInfo([...range.getClientRects()], scs.lineHeight);
    if (!info) return null;
    let text: string;
    if (!pre && "innerText" in el && !shadowOf(el)) text = (el as HTMLElement).innerText.replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").trim();
    else text = this.collectText(nodes, pre);
    if (!text || !/\S/.test(text)) return null;
    this.finishPaint(el, n, "text");
    Object.assign(n.styles, this.textStyles(styleEl));
    n.text = { text, pre, ...info };
    this.noteFont(scs);
    return n;
  }

  /** Anonymous text (a run of text and inline elements) inside a container. */
  private anonymousText(container: Element, parent: CapNode, nodes: Node[], items: Item[], stretch: boolean): CapNode | null {
    const cs = this.cs(container);
    const pre = /^pre|break-spaces/.test(cs.whiteSpace);
    const text = this.collectText(nodes, pre);
    if (!text || !/\S/.test(text)) return null;
    const styleEl = this.textStyleSource(container, items);
    const scs = this.cs(styleEl);
    const range = this.rangeOver(nodes[0], nodes[nodes.length - 1]);
    const info = this.lineInfo([...range.getClientRects()], scs.lineHeight);
    if (!info) return null;
    const contentL = parent.rect.x + parent.border.l + parent.padding.l;
    const contentR = parent.rect.x + parent.rect.w - parent.border.r - parent.padding.r;
    const x = stretch ? contentL : info.left;
    const w = stretch ? Math.max(contentR - contentL, info.right - info.left) : info.right - info.left;
    const n: CapNode = {
      kind: "text",
      rect: { x, y: info.top, w, h: info.bottom - info.top },
      styles: this.textStyles(styleEl),
      border: zeroSides(),
      padding: zeroSides(),
      flow: "in",
      children: [],
      paintless: true,
      text: { text, pre, ...info },
    };
    if (stretch) {
      const ta = cs.textAlign;
      if (ta === "center" || ta === "-webkit-center") n.styles.textAlign = "center";
      else if (ta === "right" || ta === "end") n.styles.textAlign = "right";
    }
    this.noteFont(scs);
    return n;
  }

  /** Splits a text node into one piece per rendered line (for inline content mixed with boxes). */
  private textLines(t: Text, parent: Element): CapNode[] {
    const data = t.data;
    const words: { start: number; end: number; rect: DOMRect }[] = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    const r = document.createRange();
    while ((m = re.exec(data))) {
      r.setStart(t, m.index);
      r.setEnd(t, m.index + m[0].length);
      const rects = [...r.getClientRects()].filter((q) => q.width > 0);
      if (rects.length) words.push({ start: m.index, end: m.index + m[0].length, rect: rects[0] });
    }
    if (!words.length) return [];
    const groups: (typeof words)[] = [];
    for (const w of words) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(g[g.length - 1].rect.top - w.rect.top) < 2) g.push(w);
      else groups.push([w]);
    }
    const styleEl = parent;
    const scs = this.cs(styleEl);
    this.noteFont(scs);
    return groups.map((g) => {
      const text = data.slice(g[0].start, g[g.length - 1].end).replace(/\s+/g, " ");
      const rect = g.reduce((acc, w) => ({ l: Math.min(acc.l, w.rect.left), r: Math.max(acc.r, w.rect.right), t: Math.min(acc.t, w.rect.top), b: Math.max(acc.b, w.rect.bottom) }), { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity });
      const lh = pxNumber(scs.lineHeight) ?? rect.b - rect.t;
      const lead = Math.max(0, (lh - (rect.b - rect.t)) / 2);
      const top = rect.t - lead + this.sy;
      const node: CapNode = {
        kind: "text",
        rect: { x: rect.l + this.sx, y: top, w: rect.r - rect.l, h: lh },
        styles: this.textStyles(styleEl),
        border: zeroSides(),
        padding: zeroSides(),
        flow: "in",
        children: [],
        paintless: true,
        text: { text, pre: false, lines: 1, lineHeight: lh, top, bottom: top + lh, left: rect.l + this.sx, right: rect.r + this.sx },
      };
      return node;
    });
  }

  /**
   * A run of inline content. Text-only runs become one Text layer. Runs with inline boxes (inline-block
   * buttons, icons) become one layer per piece, grouped in a synthetic line frame when the container also
   * has block children.
   */
  private inlineRun(container: Element, parent: CapNode, run: Item[], inBlockContainer: boolean): CapNode[] {
    const hasAtomic = run.some((i) => i.type === "atomic");
    if (!hasAtomic) {
      const nodes = run.map((i) => (i.type === "text" ? i.node : (i as { el: Element }).el));
      const stretch = !/^(inline-)?(flex|grid)$/.test(this.cs(container).display);
      const t = this.anonymousText(container, parent, nodes, run, stretch);
      return t ? [t] : [];
    }
    const pieces: CapNode[] = [];
    const flat = (items: Item[], styleParent: Element) => {
      for (const i of items) {
        if (i.type === "text") {
          if (/\S/.test(i.node.data)) pieces.push(...this.textLines(i.node, styleParent));
        } else if (i.type === "inline") {
          if (i.el.tagName !== "BR") flat(this.items(i.el).filter((x) => x.type !== "abs"), i.el);
        } else if (i.type === "atomic") {
          const c = this.node(i.el);
          if (c) pieces.push(c);
        }
      }
    };
    flat(run, container);
    if (!inBlockContainer || pieces.length <= 1) return pieces;
    const x = Math.min(...pieces.map((p) => p.rect.x));
    const y = Math.min(...pieces.map((p) => p.rect.y));
    const r = Math.max(...pieces.map((p) => p.rect.x + p.rect.w));
    const b = Math.max(...pieces.map((p) => p.rect.y + p.rect.h));
    return [{ kind: "frame", name: "Line", rect: { x, y, w: r - x, h: b - y }, styles: {}, border: zeroSides(), padding: zeroSides(), flow: "in", children: pieces, paintless: true, hint: "row" }];
  }

  // ---------------------------------------------------------------------------------------------
  // replaced elements

  private image(el: Element, n: CapNode): CapNode {
    const img = (el.tagName === "PICTURE" ? el.querySelector("img") : el) as HTMLImageElement | null;
    this.finishPaint(img ?? el, n, "image");
    n.src = img ? img.currentSrc || img.src : "";
    if (img && !img.complete) this.warn("Some images had not finished loading.");
    if (!n.src) this.warn("An image without a source was captured as an empty image.");
    return n;
  }

  private svg(el: SVGSVGElement, n: CapNode): CapNode {
    this.finishPaint(el, n, "svg");
    try {
      n.svg = serializeSvg(el, `s${Date.now().toString(36)}${(this.svgCount++).toString(36)}`, (m) => this.warn(m));
    } catch {
      this.warn("An SVG could not be read and was left empty.");
      n.kind = "frame";
    }
    return n;
  }

  private raster(el: Element, n: CapNode): CapNode {
    this.finishPaint(el, n, "image");
    try {
      if (el.tagName === "VIDEO") {
        const v = el as HTMLVideoElement;
        if (v.poster && v.readyState < 2) n.src = v.poster;
        else {
          const c = document.createElement("canvas");
          c.width = v.videoWidth || n.rect.w;
          c.height = v.videoHeight || n.rect.h;
          c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
          n.src = c.toDataURL("image/png");
        }
        this.warn("Videos are captured as a still frame.");
      } else n.src = (el as HTMLCanvasElement).toDataURL("image/png");
    } catch {
      this.warn("A canvas or video from another site could not be read and was left empty.");
      n.kind = "frame";
      delete n.src;
    }
    return n;
  }

  private field(el: Element, n: CapNode): CapNode {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    if (tag === "input" && ["checkbox", "radio", "range", "color", "file", "hidden", "image"].includes(type)) {
      this.finishPaint(el, n, "frame");
      if (n.paintless && (type === "checkbox" || type === "radio")) {
        const checked = (el as HTMLInputElement).checked;
        n.styles.border = "1px solid #767676";
        n.styles.borderRadius = type === "radio" ? "50%" : 3;
        if (checked) n.styles.backgroundColor = this.cs(el).accentColor && this.cs(el).accentColor !== "auto" ? this.cs(el).accentColor : "#0B57D0";
        n.paintless = false;
      }
      return n;
    }
    let text = "";
    let placeholder = false;
    if (tag === "select") text = (el as HTMLSelectElement).selectedOptions[0]?.text ?? "";
    else {
      const f = el as HTMLInputElement | HTMLTextAreaElement;
      text = type === "password" ? "•".repeat(f.value.length) : f.value;
      if (!text) {
        text = f.placeholder ?? "";
        placeholder = true;
      }
    }
    this.finishPaint(el, n, "text");
    Object.assign(n.styles, this.textStyles(el));
    if (placeholder) {
      const ph = getComputedStyle(el, "::placeholder").color;
      if (ph && !isTransparent(ph)) n.styles.color = snapshotStyles((p) => (p === "color" ? ph : ""), { kind: "text", keepFonts: false }).color ?? n.styles.color;
    }
    if (!text) {
      n.kind = "frame";
      return n;
    }
    const cs = this.cs(el);
    const lh = pxNumber(cs.lineHeight) ?? (pxNumber(cs.fontSize) ?? 16) * 1.2;
    const innerTop = n.rect.y + n.border.t;
    const innerH = n.rect.h - n.border.t - n.border.b;
    const lines = tag === "textarea" ? Math.max(1, text.split("\n").length) : 1;
    const top = tag === "textarea" ? innerTop + n.padding.t : innerTop + (innerH - lh) / 2;
    const left = n.rect.x + n.border.l + n.padding.l;
    n.text = { text, pre: tag === "textarea", lines, lineHeight: lh, top, bottom: top + lh * lines, left, right: left };
    this.noteFont(cs);
    return n;
  }
}

/** Background colour behind an element (nearest painted ancestor, then the page canvas), or white. */
export function backdropColor(el: Element | null): string {
  for (let e = el; e; e = e.parentElement) {
    const bg = getComputedStyle(e).backgroundColor;
    if (bg && !isTransparent(bg)) return bg;
  }
  return "#FFFFFF";
}

export function canvasColor(): string {
  const html = getComputedStyle(document.documentElement).backgroundColor;
  if (html && !isTransparent(html)) return html;
  const body = document.body ? getComputedStyle(document.body).backgroundColor : "";
  return body && !isTransparent(body) ? body : "#FFFFFF";
}
