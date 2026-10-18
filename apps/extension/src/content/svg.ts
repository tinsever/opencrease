// Inline <svg> → self-contained markup: computed presentation styles become attributes (so CSS classes and
// currentColor survive), <use> references to symbols in the page are expanded, ids are made unique.
import { hexColors } from "../snapshot/styles";

const PRESENTATION = [
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
  "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "opacity",
  "stop-color", "stop-opacity", "clip-rule", "font-family", "font-size", "font-weight", "text-anchor",
  "dominant-baseline",
];

const ROOT_DEFAULTS: Record<string, string> = {
  fill: "rgb(0, 0, 0)", "fill-opacity": "1", "fill-rule": "nonzero", stroke: "none", "stroke-width": "1px",
  "stroke-opacity": "1", "stroke-linecap": "butt", "stroke-linejoin": "miter", "stroke-dasharray": "none",
  "stroke-dashoffset": "0px", "stroke-miterlimit": "4", opacity: "1", "stop-color": "rgb(0, 0, 0)",
  "stop-opacity": "1", "clip-rule": "nonzero", "text-anchor": "start", "dominant-baseline": "auto",
};

const DROP = new Set(["script", "foreignobject", "style", "title", "desc", "metadata"]);
const NON_INHERITED = new Set(["opacity", "stop-color", "stop-opacity"]);

export function rewriteSvgReferences(value: string, ids: ReadonlyMap<string, string>, pageUrl: string): string {
  const reference = (target: string): string => {
    try {
      const url = new URL(target, pageUrl);
      const page = new URL(pageUrl);
      const id = decodeURIComponent(url.hash.slice(1));
      if (url.origin === page.origin && url.pathname === page.pathname && url.search === page.search && ids.has(id)) return `#${ids.get(id)}`;
    } catch { /* Leave external or malformed references untouched. */ }
    return target;
  };
  if (value.startsWith("#")) return reference(value);
  return value.replace(/url\(\s*(["']?)(.*?)\1\s*\)/g, (_all, _quote: string, target: string) => `url(${reference(target)})`);
}

function inlineStyles(orig: Element, clone: Element, parentCs: CSSStyleDeclaration | null): void {
  const cs = getComputedStyle(orig);
  for (const prop of PRESENTATION) {
    const v = cs.getPropertyValue(prop);
    if (!v) continue;
    const base = parentCs && !NON_INHERITED.has(prop) ? parentCs.getPropertyValue(prop) : ROOT_DEFAULTS[prop];
    if (prop.startsWith("font") && orig.tagName.toLowerCase() !== "text" && orig.tagName.toLowerCase() !== "tspan") continue;
    if (v !== base || orig.hasAttribute(prop)) clone.setAttribute(prop, hexColors(v));
  }
  clone.removeAttribute("class");
  clone.removeAttribute("style");
  if (cs.display === "none") clone.setAttribute("display", "none");
}

function walkPairs(orig: Element, clone: Element, parentCs: CSSStyleDeclaration | null): void {
  inlineStyles(orig, clone, parentCs);
  const cs = getComputedStyle(orig);
  const oKids = [...orig.children];
  const cKids = [...clone.children];
  for (let i = 0; i < oKids.length && i < cKids.length; i++) walkPairs(oKids[i], cKids[i], cs);
}

function cloneRef(ref: Element, use: Element): Element {
  const ns = "http://www.w3.org/2000/svg";
  const x = use.getAttribute("x") ?? "0";
  const y = use.getAttribute("y") ?? "0";
  if (ref.tagName.toLowerCase() === "symbol") {
    const svg = document.createElementNS(ns, "svg");
    const vb = ref.getAttribute("viewBox");
    if (vb) svg.setAttribute("viewBox", vb);
    svg.setAttribute("x", x);
    svg.setAttribute("y", y);
    svg.setAttribute("width", use.getAttribute("width") ?? "100%");
    svg.setAttribute("height", use.getAttribute("height") ?? "100%");
    for (const c of ref.children) svg.appendChild(c.cloneNode(true));
    return svg;
  }
  const g = document.createElementNS(ns, "g");
  if (x !== "0" || y !== "0") g.setAttribute("transform", `translate(${x} ${y})`);
  g.appendChild(ref.cloneNode(true));
  return g;
}

/** Serialises an inline svg. `uid` makes ids unique across snapshots. */
export function serializeSvg(svg: SVGSVGElement, uid: string, warn: (m: string) => void): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  walkPairs(svg, clone, null);

  // expand <use href="#id"> (symbols from sprites elsewhere in the page)
  const rootNode = svg.getRootNode() as Document | ShadowRoot;
  const origUses = [...svg.querySelectorAll("use")];
  const cloneUses = [...clone.querySelectorAll("use")];
  origUses.forEach((orig, i) => {
    const target = cloneUses[i];
    if (!target) return;
    const href = orig.getAttribute("href") ?? orig.getAttribute("xlink:href") ?? "";
    if (!href.startsWith("#")) {
      if (href) warn("Some icons reference external SVG sprites and were left out.");
      target.remove();
      return;
    }
    const ref = (rootNode.getElementById ? rootNode.getElementById(href.slice(1)) : null) ?? document.getElementById(href.slice(1));
    if (!ref) {
      target.remove();
      return;
    }
    const expanded = cloneRef(ref, orig);
    // the symbol's shapes inherit from <use>: carry its computed paint
    const cs = getComputedStyle(orig);
    for (const prop of ["fill", "stroke", "stroke-width", "color"]) {
      const v = cs.getPropertyValue(prop);
      if (v && !expanded.hasAttribute(prop)) expanded.setAttribute(prop, hexColors(v));
    }
    for (const a of target.attributes) {
      if (!["href", "xlink:href", "x", "y", "width", "height"].includes(a.name) && !expanded.hasAttribute(a.name)) expanded.setAttribute(a.name, a.value);
    }
    target.replaceWith(expanded);
  });

  for (const el of [...clone.querySelectorAll("*")]) {
    if (DROP.has(el.tagName.toLowerCase())) el.remove();
  }

  // Rewrite attributes before XML serialization escapes quotes in url("#id").
  const elements = [clone, ...clone.querySelectorAll("*")];
  const ids = new Map(elements.filter((el) => el.id).map((el) => [el.id, `${uid}-${el.id}`]));
  for (const el of elements) {
    for (const attr of [...el.attributes]) {
      el.setAttribute(attr.name, attr.name === "id" ? ids.get(attr.value)! : rewriteSvgReferences(attr.value, ids, document.baseURI));
    }
  }
  const markup = new XMLSerializer().serializeToString(clone);
  return markup.replace(/\sxmlns(:xlink)?="[^"]*"/g, "").replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
}
