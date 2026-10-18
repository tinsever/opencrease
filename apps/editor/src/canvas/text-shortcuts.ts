// Paper-compatible typography hotkeys. They style the selected text range while editing, otherwise
// the whole of every selected Text node:
//   ⇧⌘, ⇧⌘.  font size -1 / +1        ⌥⌘, ⌥⌘.  weight -100 / +100
//   ⌥, ⌥.    letter spacing -/+1%     ⇧⌥, ⇧⌥.  line height -1 / +1 px
//   ⌘B bold   ⌘I italic   ⌘U underline
import { resolveToken, styleRange, type FoldDocument, type OFNode, type StyleMap, type StyleValue } from "@opencrease/model";
import { getActiveFile, getState } from "../state/workspace";
import { getNodeElement } from "./registry";
import { isBold, rangeStyle, type RichState } from "./rich-edit";
import { activeTextRange, editingElement, formatTextRange } from "./text-edit";

type Step = { key: string; label: string; next: (current: StyleValue | undefined, computed: CSSStyleDeclaration | null, doc: FoldDocument) => StyleValue | null };

function px(doc: FoldDocument, v: StyleValue | undefined): number | null {
  if (v === undefined) return null;
  let value: StyleValue | undefined = v;
  if (typeof v === "string" && v.trim().startsWith("var(")) value = resolveToken(doc, v.trim());
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && /^-?[\d.]+(px)?$/.test(value.trim()) ? n : null;
}

function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

const size = (delta: number): Step => ({
  key: "fontSize",
  label: "Font size",
  next: (cur, cs, doc) => Math.max(1, (px(doc, cur) ?? (cs ? Number.parseFloat(cs.fontSize) : 16)) + delta),
});

const weight = (delta: number): Step => ({
  key: "fontWeight",
  label: "Font weight",
  next: (cur, cs, doc) => {
    let w = cur === undefined ? Number(cs?.fontWeight ?? 400) : cur === "bold" ? 700 : cur === "normal" ? 400 : Number(px(doc, cur) ?? cur);
    if (!Number.isFinite(w)) w = 400;
    return Math.min(900, Math.max(100, Math.round(w / 100) * 100 + delta));
  },
});

const tracking = (delta: number): Step => ({
  key: "letterSpacing",
  label: "Letter spacing",
  next: (cur, cs, doc) => {
    let em = 0;
    let value: StyleValue | undefined = cur;
    if (typeof cur === "string" && cur.trim().startsWith("var(")) value = resolveToken(doc, cur.trim());
    if (typeof value === "string" && /em$/.test(value)) em = Number.parseFloat(value);
    else {
      const fontSize = cs ? Number.parseFloat(cs.fontSize) : 16;
      const p = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : cs && cs.letterSpacing !== "normal" ? Number.parseFloat(cs.letterSpacing) : 0;
      em = Number.isFinite(p) && fontSize ? p / fontSize : 0;
    }
    const next = round(em + delta, 3);
    return next === 0 ? null : `${next}em`;
  },
});

const leading = (delta: number): Step => ({
  key: "lineHeight",
  label: "Line height",
  next: (cur, cs, doc) => {
    const fontSize = cs ? Number.parseFloat(cs.fontSize) : 16;
    let current: number | null = null;
    const resolved = typeof cur === "string" && cur.trim().startsWith("var(") ? resolveToken(doc, cur.trim()) : cur;
    if (typeof resolved === "number") current = resolved < 4 ? resolved * fontSize : resolved;
    else if (typeof resolved === "string") current = /px$/.test(resolved) ? Number.parseFloat(resolved) : Number.parseFloat(resolved) * (/%$/.test(resolved) ? fontSize / 100 : fontSize);
    if (current === null || !Number.isFinite(current)) current = cs && cs.lineHeight !== "normal" ? Number.parseFloat(cs.lineHeight) : Math.round(fontSize * 1.2);
    return `${Math.max(0, Math.round(current) + delta)}px`;
  },
});

function computedFor(id: string): CSSStyleDeclaration | null {
  const el = getNodeElement(id) ?? editingElement(id);
  return el instanceof HTMLElement ? getComputedStyle(el) : null;
}

/** Applies a style to whole Text nodes and clears the same property from their runs. */
function styleNodes(label: string, nodes: OFNode[], value: (node: OFNode) => StyleValue | null, mergeKey?: string) {
  const file = getActiveFile();
  if (!file || !nodes.length) return;
  file.store.transact(
    label,
    (tx) => {
      for (const n of nodes) {
        if (n.locked) continue;
        const key = stepKey(label);
        tx.setStyles(n.id, { [key]: value(n) });
        if (n.spans) {
          const spans = styleRange(n.text ?? "", n.spans, 0, (n.text ?? "").length, { [key]: null });
          tx.updateNode(n.id, { spans });
        }
      }
    },
    { mergeKey },
  );
}

const LABEL_KEYS: Record<string, string> = {
  "Font size": "fontSize", "Font weight": "fontWeight", "Letter spacing": "letterSpacing", "Line height": "lineHeight",
  Bold: "fontWeight", Italic: "fontStyle", Underline: "textDecoration",
};
function stepKey(label: string): string {
  return LABEL_KEYS[label];
}

function targets(): { doc: FoldDocument; nodes: OFNode[] } | null {
  const file = getActiveFile();
  if (!file) return null;
  const doc = file.store.doc;
  const editing = getState().editingTextId;
  const ids = editing ? [editing] : file.selection;
  const nodes = ids.map((id) => doc.nodes[id]).filter((n): n is OFNode => n?.type === "Text");
  return nodes.length ? { doc, nodes } : null;
}

function runStep(step: Step): boolean {
  const t = targets();
  if (!t) return false;
  const mergeKey = `hotkey:${step.key}`;
  const range = activeTextRange();
  if (range) {
    const cs = computedFor(range.id);
    return formatTextRange(step.label, (state: RichState, start, end, nodeStyles: StyleMap) => {
      const cur = rangeStyle(state, nodeStyles, start, end, step.key);
      return { [step.key]: step.next(cur === "mixed" ? undefined : cur, cs, t.doc) };
    }, mergeKey);
  }
  styleNodes(step.label, t.nodes, (n) => step.next(n.styles[step.key], computedFor(n.id), t.doc), `${mergeKey}:${t.nodes.map((n) => n.id).join(",")}`);
  return true;
}

function toggle(label: "Bold" | "Italic" | "Underline"): boolean {
  const t = targets();
  if (!t) return false;
  const key = stepKey(label);
  const isOn = (v: StyleValue | undefined | "mixed") =>
    label === "Bold" ? isBold(v) : label === "Italic" ? v === "italic" : typeof v === "string" && v.includes("underline");
  const on = label === "Bold" ? 700 : label === "Italic" ? "italic" : "underline";
  const off = label === "Bold" ? 400 : label === "Italic" ? "normal" : "none";
  const range = activeTextRange();
  if (range) {
    return formatTextRange(label, (state, start, end, nodeStyles) => {
      const cur = rangeStyle(state, nodeStyles, start, end, key);
      const computed = label === "Bold" && cur === undefined ? computedFor(range.id)?.fontWeight : undefined;
      return { [key]: isOn(cur ?? computed) ? off : on };
    });
  }
  const allOn = t.nodes.every((n) => isOn(n.styles[key] ?? (label === "Bold" ? computedFor(n.id)?.fontWeight : undefined)));
  styleNodes(label, t.nodes, () => (allOn ? (label === "Bold" ? 400 : null) : on));
  return true;
}

/** Handles a typography hotkey. Returns true when it was one (the caller prevents the default). */
export function handleTextShortcut(e: KeyboardEvent): boolean {
  const meta = e.metaKey || e.ctrlKey;
  const code = e.code;
  const dir = code === "Period" ? 1 : code === "Comma" ? -1 : 0;
  if (dir) {
    if (meta && e.shiftKey && !e.altKey) return runStep(size(dir));
    if (meta && e.altKey && !e.shiftKey) return runStep(weight(dir * 100));
    if (!meta && e.altKey && e.shiftKey) return runStep(leading(dir));
    if (!meta && e.altKey && !e.shiftKey) return runStep(tracking(dir * 0.01));
    return false;
  }
  if (meta && !e.altKey && !e.shiftKey) {
    if (code === "KeyB") return toggle("Bold");
    if (code === "KeyI") return toggle("Italic");
    if (code === "KeyU") return toggle("Underline");
  }
  return false;
}

function isTypingTarget(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/** Window listener for when Text nodes are selected (editing handles its own keys). Returns uninstall. */
export function installTextShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || getState().route.kind !== "file") return;
    if (e.target instanceof Element && e.target.closest("[role=dialog], [role=menu], .of-panel, .of-titlebar")) return;
    if (isTypingTarget(document.activeElement)) return;
    if (handleTextShortcut(e)) e.preventDefault();
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}
