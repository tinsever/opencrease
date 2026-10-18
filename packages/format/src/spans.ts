// Rich text runs of Text nodes. Pure helpers: a node's `spans` always cover its whole `text`, and
// a node whose runs carry no styles is stored as plain text (no `spans` field).
import type { StyleMap, StyleValue, TextSpan } from "./types";

function sameStyles(a: StyleMap | undefined, b: StyleMap | undefined): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => b !== undefined && a![k] === b[k]);
}

function cleanStyles(styles: StyleMap | undefined): StyleMap | undefined {
  if (!styles) return undefined;
  const out: StyleMap = {};
  for (const [k, v] of Object.entries(styles)) {
    if (typeof v === "string" ? v !== "" : typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Concatenated text of the runs. */
export function spansText(spans: readonly TextSpan[]): string {
  return spans.map((s) => s.text).join("");
}

/**
 * Canonical form: empty runs dropped, adjacent runs with equal styles merged, empty style maps removed.
 * Returns undefined when no run has styles (the node is plain text).
 */
export function normalizeSpans(spans: readonly TextSpan[] | undefined): TextSpan[] | undefined {
  if (!spans || !Array.isArray(spans)) return undefined;
  const out: TextSpan[] = [];
  for (const raw of spans) {
    if (!raw || typeof raw.text !== "string" || raw.text === "") continue;
    const styles = cleanStyles(raw.styles);
    const last = out[out.length - 1];
    if (last && sameStyles(last.styles, styles)) {
      last.text += raw.text;
      continue;
    }
    out.push(styles ? { text: raw.text, styles } : { text: raw.text });
  }
  return out.some((s) => s.styles) ? out : undefined;
}

/** Runs covering `text`: the node's spans when they match it, else one unstyled run. */
export function toRuns(text: string, spans: readonly TextSpan[] | undefined): TextSpan[] {
  if (spans && spans.length && spansText(spans) === text) return spans.map((s) => (s.styles ? { text: s.text, styles: { ...s.styles } } : { text: s.text }));
  return text ? [{ text }] : [];
}

/** Splits runs so that `at` falls on a run boundary. */
function splitAt(runs: TextSpan[], at: number): TextSpan[] {
  const out: TextSpan[] = [];
  let pos = 0;
  for (const run of runs) {
    const end = pos + run.text.length;
    if (at > pos && at < end) {
      const cut = at - pos;
      out.push({ ...run, text: run.text.slice(0, cut) }, { ...run, text: run.text.slice(cut) });
    } else out.push(run);
    pos = end;
  }
  return out;
}

function clampRange(length: number, start: number, end: number): [number, number] {
  const a = Math.max(0, Math.min(length, Math.trunc(Math.min(start, end))));
  const b = Math.max(0, Math.min(length, Math.trunc(Math.max(start, end))));
  return [a, b];
}

/**
 * Applies a style patch to the characters in [start, end). A null or "" value removes that property
 * from the runs (they fall back to the node's own style). Returns the normalised spans.
 */
export function styleRange(
  text: string,
  spans: readonly TextSpan[] | undefined,
  start: number,
  end: number,
  patch: Record<string, StyleValue | null>,
): TextSpan[] | undefined {
  const [a, b] = clampRange(text.length, start, end);
  if (a === b) return normalizeSpans(toRuns(text, spans));
  let runs = splitAt(splitAt(toRuns(text, spans), a), b);
  let pos = 0;
  runs = runs.map((run) => {
    const from = pos;
    pos += run.text.length;
    if (from < a || from >= b) return run;
    const styles: StyleMap = { ...(run.styles ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") delete styles[k];
      else styles[k] = v;
    }
    return { text: run.text, styles };
  });
  return normalizeSpans(runs);
}

/**
 * Replaces the characters in [start, end) with `insert`. The inserted text takes the styles of the run
 * it is typed into (the run before the caret, like a word processor).
 */
export function replaceRange(
  text: string,
  spans: readonly TextSpan[] | undefined,
  start: number,
  end: number,
  insert: string,
): { text: string; spans: TextSpan[] | undefined } {
  const [a, b] = clampRange(text.length, start, end);
  const nextText = text.slice(0, a) + insert + text.slice(b);
  if (!spans) return { text: nextText, spans: undefined };
  const runs = splitAt(splitAt(toRuns(text, spans), a), b);
  const out: TextSpan[] = [];
  let pos = 0;
  let inserted = insert === "";
  let before: TextSpan | undefined;
  for (const run of runs) {
    const from = pos;
    pos += run.text.length;
    if (from >= a && pos <= b && run.text.length && a < b) {
      before ??= run; // replacing a selection keeps the style of its first character
      continue; // removed
    }
    if (!inserted && from >= a) {
      const styleFrom = before ?? out[out.length - 1] ?? run;
      out.push({ text: insert, ...(styleFrom.styles ? { styles: { ...styleFrom.styles } } : {}) });
      inserted = true;
    }
    out.push(run);
  }
  if (!inserted) {
    const styleFrom = before ?? out[out.length - 1];
    out.push({ text: insert, ...(styleFrom?.styles ? { styles: { ...styleFrom.styles } } : {}) });
  }
  return { text: nextText, spans: normalizeSpans(out) };
}

/** Style maps of the runs overlapping [start, end) (a collapsed range reads the run before the caret). */
export function stylesInRange(text: string, spans: readonly TextSpan[] | undefined, start: number, end: number): StyleMap[] {
  const [a, b] = clampRange(text.length, start, end);
  const runs = toRuns(text, spans);
  const out: StyleMap[] = [];
  let pos = 0;
  for (const run of runs) {
    const from = pos;
    const to = pos + run.text.length;
    pos = to;
    const hit = a === b ? (a > from && a <= to) || (a === 0 && from === 0) : from < b && to > a;
    if (hit) out.push(run.styles ?? {});
  }
  return out.length ? out : [{}];
}

/** Common value of a property over the runs in a range: the value, undefined (unset everywhere) or "mixed". */
export function rangeValue(styles: readonly StyleMap[], key: string): StyleValue | undefined | "mixed" {
  const first = styles[0]?.[key];
  for (const s of styles) if (s[key] !== first) return "mixed";
  return first;
}
