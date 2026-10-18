// Rich text editing in place: the contentEditable DOM is built from a Text node's runs, read back into
// text + spans, and formatting (bold, italic, colour, size, any span style) is applied to the selected
// character range through the model helpers, then the DOM is rebuilt and the selection restored.
import { normalizeStyles, parseInlineStyle, SPAN_STYLE_KEYS, stylesToCss } from "@opencrease/css";
import { normalizeSpans, replaceRange, styleRange, stylesInRange, toRuns, type NodeId, type StyleMap, type StyleValue, type TextSpan } from "@opencrease/model";
import { createStore } from "./store";

export interface RichState {
  text: string;
  spans: TextSpan[] | undefined;
}

/** The character range selected in the Text node being edited (kept while focus is in the inspector). */
export interface TextRange {
  nodeId: NodeId;
  start: number;
  end: number;
}

export const richText = createStore<{ range: TextRange | null }>({ range: null });

const RUN_ATTR = "data-of-run";

/** Replaces the element's content with the runs. A trailing newline gets a <br> so the caret can sit on the last line. */
export function buildEditableDom(el: HTMLElement, state: RichState): void {
  const runs = toRuns(state.text, state.spans);
  const frag = document.createDocumentFragment();
  runs.forEach((run, i) => {
    if (!run.styles) {
      frag.appendChild(document.createTextNode(run.text));
      return;
    }
    const span = document.createElement("span");
    span.setAttribute(RUN_ATTR, String(i));
    span.style.cssText = stylesToCss(run.styles);
    span.textContent = run.text;
    frag.appendChild(span);
  });
  if (state.text.endsWith("\n") || state.text === "") frag.appendChild(document.createElement("br"));
  el.replaceChildren(frag);
  (el as HTMLElement & { __ofRuns?: TextSpan[] }).__ofRuns = runs;
}

const TAG_STYLES: Record<string, StyleMap> = {
  B: { fontWeight: 700 },
  STRONG: { fontWeight: 700 },
  I: { fontStyle: "italic" },
  EM: { fontStyle: "italic" },
  U: { textDecoration: "underline" },
  S: { textDecoration: "line-through" },
  STRIKE: { textDecoration: "line-through" },
};

function foreignStyles(el: Element): StyleMap {
  const out: StyleMap = { ...(TAG_STYLES[el.tagName] ?? {}) };
  const raw = el.getAttribute("style");
  if (raw) {
    const { styles } = normalizeStyles(parseInlineStyle(raw));
    for (const [k, v] of Object.entries(styles)) if (SPAN_STYLE_KEYS.has(k)) out[k] = v;
  }
  if (el.tagName === "FONT" && el.getAttribute("color")) out.color = el.getAttribute("color")!;
  return out;
}

const BLOCK = new Set(["DIV", "P", "LI"]);

/** Reads text and spans from an editable element (or a fragment of it). */
export function readEditableDom(root: Node): RichState {
  const runs = ((root as HTMLElement & { __ofRuns?: TextSpan[] }).__ofRuns ?? []) as TextSpan[];
  const out: TextSpan[] = [];
  let text = "";
  const push = (s: string, styles: StyleMap | undefined) => {
    if (!s) return;
    text += s;
    out.push(styles && Object.keys(styles).length ? { text: s, styles } : { text: s });
  };
  const walk = (node: Node, styles: StyleMap | undefined, isLastChild: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      push((node.nodeValue ?? "").replace(/\r\n?/g, "\n").replace(/ /g, " "), styles);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    const el = node as Element;
    if (el.tagName === "BR") {
      // the placeholder <br> at the very end (ours or Chrome's) does not add a line
      if (!(isLastChild && el.parentNode === root)) push("\n", styles);
      return;
    }
    let own = styles;
    if (node !== root && el.tagName) {
      const idx = el.getAttribute?.(RUN_ATTR);
      const known = idx !== null && idx !== undefined ? runs[Number(idx)]?.styles : undefined;
      own = { ...(styles ?? {}), ...(known ?? foreignStyles(el)) };
      if (BLOCK.has(el.tagName) && text !== "" && !text.endsWith("\n")) push("\n", styles);
    }
    const kids = [...node.childNodes];
    kids.forEach((k, i) => walk(k, own, i === kids.length - 1));
  };
  const kids = [...root.childNodes];
  kids.forEach((k, i) => walk(k, undefined, i === kids.length - 1));
  return { text, spans: normalizeSpans(out) };
}

/** Character offset of a DOM point inside the editable element. */
export function offsetAt(root: HTMLElement, container: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  try {
    range.setEnd(container, offset);
  } catch {
    return 0;
  }
  const frag = range.cloneContents();
  (frag as unknown as { __ofRuns?: TextSpan[] }).__ofRuns = (root as HTMLElement & { __ofRuns?: TextSpan[] }).__ofRuns;
  return readEditableDom(frag).text.length;
}

/** DOM point for a character offset in a DOM built by buildEditableDom. */
export function pointAt(root: HTMLElement, offset: number): { node: Node; offset: number } {
  let left = offset;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const len = n.nodeValue?.length ?? 0;
    if (left <= len) return { node: n, offset: left };
    left -= len;
    last = n;
  }
  if (last) return { node: last, offset: last.nodeValue?.length ?? 0 };
  return { node: root, offset: 0 };
}

export function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  const a = offsetAt(root, r.startContainer, r.startOffset);
  const b = offsetAt(root, r.endContainer, r.endOffset);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

export function restoreSelection(root: HTMLElement, start: number, end: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const a = pointAt(root, start);
  const b = pointAt(root, end);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Replace the selection with plain text (typing Enter, pasting) at the model level. */
export function insertAtSelection(root: HTMLElement, insert: string): RichState | null {
  const sel = selectionOffsets(root);
  if (!sel) return null;
  const state = readEditableDom(root);
  const next = replaceRange(state.text, state.spans, sel.start, sel.end, insert);
  buildEditableDom(root, next);
  const caret = sel.start + insert.length;
  restoreSelection(root, caret, caret);
  return next;
}

/** Apply a style patch to a range of a state. */
export function styleState(state: RichState, start: number, end: number, patch: Record<string, StyleValue | null>): RichState {
  return { text: state.text, spans: styleRange(state.text, state.spans, start, end, patch) };
}

/** Effective value of a property over a range: run styles fall back to the node style. */
export function rangeStyle(state: RichState, nodeStyles: StyleMap, start: number, end: number, key: string): StyleValue | undefined | "mixed" {
  const runs = stylesInRange(state.text, state.spans, start, end);
  const values = runs.map((s) => s[key] ?? nodeStyles[key]);
  const first = values[0];
  return values.every((v) => v === first) ? first : "mixed";
}

/** Toggle helpers for ⌘B / ⌘I on a range: bold unless the whole range is already bold. */
export function isBold(v: StyleValue | undefined | "mixed"): boolean {
  if (v === undefined || v === "mixed") return false;
  if (v === "bold" || v === "bolder") return true;
  const n = Number(v);
  return Number.isFinite(n) && n >= 600;
}
