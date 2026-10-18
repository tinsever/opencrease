// ::before and ::after cannot be measured, so for the duration of a capture they are turned into real
// <of-pseudo> elements carrying the pseudo-element's computed style, and the originals are hidden.
// The returned function puts the page back exactly as it was.

const HIDE_ATTR = "data-of-pseudo-host";
const HIDE_CSS = `[${HIDE_ATTR}]::before,[${HIDE_ATTR}]::after{content:none!important}`;
export const PSEUDO_TAG = "of-pseudo";
export const PSEUDO_KIND_ATTR = "data-of-pseudo";

/** Parses a computed `content` value into text, or a url, or null when nothing is generated. */
export function parseContent(content: string, el: Element): { text: string } | { url: string } | null {
  const c = content.trim();
  if (!c || c === "none" || c === "normal") return null;
  const url = /^url\(\s*(["']?)(.*?)\1\s*\)$/.exec(c);
  if (url) return { url: url[2] };
  let text = "";
  let i = 0;
  while (i < c.length) {
    const ch = c[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let s = "";
      while (j < c.length && c[j] !== ch) {
        if (c[j] === "\\" && j + 1 < c.length) {
          const hex = /^[0-9a-fA-F]{1,6}\s?/.exec(c.slice(j + 1));
          if (hex) {
            s += String.fromCodePoint(parseInt(hex[0].trim(), 16));
            j += 1 + hex[0].length;
            continue;
          }
          s += c[j + 1];
          j += 2;
          continue;
        }
        s += c[j];
        j++;
      }
      text += s;
      i = j + 1;
      continue;
    }
    const attr = /^attr\(\s*([\w-]+)\s*\)/.exec(c.slice(i));
    if (attr) {
      text += el.getAttribute(attr[1]) ?? "";
      i += attr[0].length;
      continue;
    }
    const fn = /^[\w-]+\([^)]*\)/.exec(c.slice(i));
    if (fn) {
      // counter(), counters(), quotes: not resolvable from script
      i += fn[0].length;
      continue;
    }
    i++;
  }
  return { text };
}

function hasBox(cs: CSSStyleDeclaration): boolean {
  const w = parseFloat(cs.width) || 0;
  const h = parseFloat(cs.height) || 0;
  const painted =
    (cs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) ||
    cs.backgroundImage !== "none" ||
    parseFloat(cs.borderTopWidth) > 0 ||
    parseFloat(cs.borderLeftWidth) > 0 ||
    cs.boxShadow !== "none";
  return w > 0 && h > 0 && !!painted;
}

function copyStyle(from: CSSStyleDeclaration, to: HTMLElement): void {
  for (let i = 0; i < from.length; i++) {
    const prop = from[i];
    if (prop === "content" || prop.startsWith("--")) continue;
    to.style.setProperty(prop, from.getPropertyValue(prop));
  }
}

function shadowOf(el: Element): ShadowRoot | null {
  const api = (globalThis as { chrome?: { dom?: { openOrClosedShadowRoot?(e: Element): ShadowRoot | null } } }).chrome?.dom;
  try {
    if (api?.openOrClosedShadowRoot) return api.openOrClosedShadowRoot(el) ?? null;
  } catch {
    // not available in this context
  }
  const ff = (el as Element & { openOrClosedShadowRoot?: ShadowRoot | null }).openOrClosedShadowRoot;
  return ff ?? el.shadowRoot ?? null;
}

export { shadowOf };

/** Materialises pseudo-elements inside root (including shadow trees). Returns the undo function. */
export function materializePseudos(root: Element, skip: (el: Element) => boolean): () => void {
  const created: Element[] = [];
  const hosts: Element[] = [];
  const styles: HTMLStyleElement[] = [];
  const scopes = new Set<Document | ShadowRoot>();

  const visit = (el: Element) => {
    if (skip(el)) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "svg" || tag === "img" || tag === "input" || tag === "textarea" || tag === "select" || tag === PSEUDO_TAG) return;
    const pseudoEls: Array<[string, HTMLElement]> = [];
    for (const which of ["::before", "::after"] as const) {
      const cs = getComputedStyle(el, which);
      if (cs.display === "none") continue;
      const content = parseContent(cs.content, el);
      if (!content) continue;
      let node: HTMLElement;
      if ("url" in content) {
        const img = document.createElement("img");
        img.src = content.url;
        node = img;
      } else {
        if (content.text === "" && !hasBox(cs)) continue;
        node = document.createElement(PSEUDO_TAG);
        node.textContent = content.text;
      }
      copyStyle(cs, node);
      node.setAttribute(PSEUDO_KIND_ATTR, which.slice(2));
      pseudoEls.push([which, node]);
    }
    const shadow = shadowOf(el);
    const children = [...(shadow ? shadow.children : el.children)];
    if (pseudoEls.length) {
      const parent: Element | ShadowRoot = shadow ?? el;
      for (const [which, node] of pseudoEls) {
        if (which === "::before") parent.insertBefore(node, parent.firstChild);
        else parent.appendChild(node);
        created.push(node);
      }
      el.setAttribute(HIDE_ATTR, "");
      hosts.push(el);
      const scope = el.getRootNode() as Document | ShadowRoot;
      scopes.add(scope);
    }
    for (const c of children) visit(c);
  };
  visit(root);

  for (const scope of scopes) {
    const style = document.createElement("style");
    style.textContent = HIDE_CSS;
    if (scope instanceof Document || scope.nodeType === Node.DOCUMENT_NODE) (scope as Document).documentElement.appendChild(style);
    else (scope as ShadowRoot).appendChild(style);
    styles.push(style);
  }

  return () => {
    for (const n of created) n.remove();
    for (const h of hosts) h.removeAttribute(HIDE_ATTR);
    for (const s of styles) s.remove();
  };
}
