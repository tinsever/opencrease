// Turns measured boxes into OpenCrease layout: flex columns and rows wherever the measured positions can be
// reproduced with padding, gap and alignment, absolute positions where they cannot.
//
// Margins do not exist in OpenCrease. Spacing between siblings becomes `gap`; uneven spacing is absorbed by
// growing a neighbour that paints nothing (its padding grows, it looks the same), or by a transparent spacer.
// Cross-axis offsets become alignment, padding on paintless children, or a relative offset.
import type { StyleMap } from "@opencrease/model";
import { round2 } from "./styles";
import type { CapNode, OutNode, Rect } from "./types";

/** Measurement tolerance in px. Sub-pixel layout makes exact comparisons useless. */
const TOL = 0.75;

type Axis = "column" | "row";
type AlignValue = "stretch" | "flex-start" | "center" | "flex-end";

interface Placement {
  /** Styles the parent's layout puts on the child (alignSelf, position, offsets, flexShrink). */
  styles: StyleMap;
  width: "fixed" | "auto";
  height: "fixed" | "auto";
  /** Single-line text that must not wrap. */
  nowrap?: boolean;
}

export interface LayoutStats {
  absolute: number;
  spacers: number;
}

interface Ctx {
  stats: LayoutStats;
}

/** Lays out a captured tree. The root becomes an artboard with a fixed size. */
export function layoutSnapshot(root: CapNode): { node: OutNode; stats: LayoutStats } {
  const ctx: Ctx = { stats: { absolute: 0, spacers: 0 } };
  const node = build(ctx, root, { styles: {}, width: "fixed", height: "fixed" });
  return { node, stats: ctx.stats };
}

// ---------------------------------------------------------------------------------------------
// helpers

function inner(n: CapNode): { l: number; t: number; r: number; b: number } {
  return {
    l: n.rect.x + n.border.l,
    t: n.rect.y + n.border.t,
    r: n.rect.x + n.rect.w - n.border.r,
    b: n.rect.y + n.rect.h - n.border.b,
  };
}

function hasInFlowContent(n: CapNode): boolean {
  if (n.kind === "text") return true;
  return n.kind === "frame" && n.children.some((c) => c.flow === "in");
}

function canGrow(n: CapNode): boolean {
  return n.paintless && (n.kind === "frame" || n.kind === "text") && !n.styles.transform;
}

type Side = "t" | "r" | "b" | "l";

/** Grow a paintless node's box on one side; its padding grows by the same amount so its content stays put. */
function grow(n: CapNode, side: Side, e: number): void {
  if (e <= 0) return;
  n.padding[side] += e;
  if (side === "t") {
    n.rect.y -= e;
    n.rect.h += e;
  } else if (side === "b") n.rect.h += e;
  else if (side === "l") {
    n.rect.x -= e;
    n.rect.w += e;
  } else n.rect.w += e;
}

export function setPadding(styles: StyleMap, t: number, r: number, b: number, l: number): void {
  const v = [t, r, b, l].map((x) => Math.max(0, round2(x)));
  if (v.every((x) => x === 0)) return;
  if (v.every((x) => x === v[0])) {
    styles.padding = v[0];
    return;
  }
  const keys = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
  v.forEach((x, i) => {
    if (x !== 0) styles[keys[i]] = x;
  });
}

/** Single-line text whose box is no wider than its glyphs plus padding: it can hug its content. */
function hugsText(n: CapNode): boolean {
  if (n.kind !== "text" || !n.text || n.text.lines !== 1) return false;
  const glyphs = n.text.right - n.text.left;
  const box = n.rect.w - n.border.l - n.border.r - n.padding.l - n.padding.r;
  return box - glyphs <= 1.5;
}

function singleLine(n: CapNode): boolean {
  return n.kind === "text" && n.text?.lines === 1 && !n.text.text.includes("\n");
}

// ---------------------------------------------------------------------------------------------
// node building

function build(ctx: Ctx, n: CapNode, place: Placement): OutNode {
  const styles: StyleMap = { ...n.styles };
  const out: OutNode = { kind: n.kind, styles };
  if (n.name) out.name = n.name;
  if (place.width === "fixed" || n.kind === "image" || n.kind === "svg") styles.width = round2(n.rect.w);
  if (place.height === "fixed" || n.kind === "image" || n.kind === "svg") styles.height = round2(n.rect.h);
  Object.assign(styles, place.styles);

  switch (n.kind) {
    case "image":
      out.src = n.src ?? "";
      break;
    case "svg":
      out.svg = n.svg ?? "";
      break;
    case "text":
      textBox(n, styles, place);
      out.text = n.text?.text ?? "";
      if (n.text?.pre) out.pre = true;
      break;
    case "frame":
      out.children = layoutFrame(ctx, n, styles);
      break;
  }
  return out;
}

function textBox(n: CapNode, styles: StyleMap, place: Placement): void {
  const t = n.text;
  if (!t) return;
  const box = inner(n);
  const padT = t.top - box.t;
  const padB = box.b - t.bottom;
  const padL = n.padding.l;
  const padR = n.padding.r;
  if (t.lines === 1 && (styles.textAlign === undefined || styles.textAlign === "left")) {
    // flex centring in buttons and badges: the glyphs sit in the middle of a wider box
    const l = t.left - (box.l + padL);
    const r = box.r - padR - t.right;
    if (l > 1 && Math.abs(l - r) <= 1.5) styles.textAlign = "center";
    else if (l > 1 && r <= 1) styles.textAlign = "right";
  }
  setPadding(styles, padT, padR, padB, padL);
  if (t.pre) styles.whiteSpace = t.lines > t.text.split("\n").length ? "pre-wrap" : "pre";
  else if (place.nowrap) styles.whiteSpace = "nowrap";
}

function layoutFrame(ctx: Ctx, n: CapNode, styles: StyleMap): OutNode[] {
  const inflow = n.children.filter((c) => c.flow === "in");
  const abs = n.children.filter((c) => c.flow === "abs");
  const out: OutNode[] = [];
  let needsRelative = abs.length > 0;

  if (inflow.length) {
    const flex = layoutFlex(ctx, n, inflow, styles);
    if (flex) out.push(...flex);
    else {
      // nothing flex can express: keep the measured positions
      styles.width = round2(n.rect.w);
      styles.height = round2(n.rect.h);
      needsRelative = true;
      for (const c of inflow) out.push(absChild(ctx, n, c));
    }
  } else if (!styles.width || !styles.height) {
    styles.width = round2(n.rect.w);
    styles.height = round2(n.rect.h);
  }
  for (const c of abs) out.push(absChild(ctx, n, c));
  if (needsRelative && styles.position === undefined) styles.position = "relative";
  return out;
}

function absChild(ctx: Ctx, parent: CapNode, c: CapNode): OutNode {
  ctx.stats.absolute++;
  const box = inner(parent);
  const s: StyleMap = { position: "absolute", left: round2(c.rect.x - box.l), top: round2(c.rect.y - box.t) };
  if (c.zIndex !== undefined) s.zIndex = c.zIndex;
  const text = c.kind === "text";
  return build(ctx, c, { styles: s, width: "fixed", height: text ? "auto" : "fixed", nowrap: singleLine(c) });
}

// ---------------------------------------------------------------------------------------------
// flex

function stacks(items: CapNode[], axis: Axis): boolean {
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1].rect;
    const b = items[i].rect;
    if (axis === "column" ? b.y < a.y + a.h - TOL : b.x < a.x + a.w - TOL) return false;
  }
  return true;
}

/** Groups items into visual lines (rows that wrap), or null when they do not form clean lines. */
export function groupLines(items: CapNode[]): CapNode[][] | null {
  const sorted = [...items].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const lines: { top: number; bottom: number; items: CapNode[] }[] = [];
  for (const c of sorted) {
    const line = lines.find((l) => c.rect.y < l.bottom - TOL && c.rect.y + c.rect.h > l.top + TOL);
    if (line) {
      line.items.push(c);
      line.top = Math.min(line.top, c.rect.y);
      line.bottom = Math.max(line.bottom, c.rect.y + c.rect.h);
    } else lines.push({ top: c.rect.y, bottom: c.rect.y + c.rect.h, items: [c] });
  }
  lines.sort((a, b) => a.top - b.top);
  for (let i = 1; i < lines.length; i++) if (lines[i].top < lines[i - 1].bottom - TOL) return null;
  for (const l of lines) {
    l.items.sort((a, b) => a.rect.x - b.rect.x);
    if (!stacks(l.items, "row")) return null;
  }
  return lines.map((l) => l.items);
}

function union(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const r = Math.max(...rects.map((q) => q.x + q.w));
  const b = Math.max(...rects.map((q) => q.y + q.h));
  return { x, y, w: r - x, h: b - y };
}

function layoutFlex(ctx: Ctx, n: CapNode, items: CapNode[], styles: StyleMap): OutNode[] | null {
  const byY = [...items].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const byX = [...items].sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y);
  const colOk = stacks(byY, "column");
  const rowOk = stacks(byX, "row");
  const order: Axis[] = [];
  if (colOk && rowOk) order.push(n.hint === "row" ? "row" : "column", n.hint === "row" ? "column" : "row");
  else if (colOk) order.push("column");
  else if (rowOk) order.push("row");
  for (const axis of order) {
    const r = flexAxis(ctx, n, axis === "column" ? byY : byX, axis, styles);
    if (r) return r;
  }
  // wrapped rows (grids, flex-wrap, inline content): a column of synthetic rows
  const lines = groupLines(items);
  if (lines && lines.length > 1) {
    const box = inner(n);
    const contentL = box.l + n.padding.l;
    const contentR = box.r - n.padding.r;
    const rows: CapNode[] = lines.map((line) => {
      const u = union(line.map((c) => c.rect));
      const fits = u.x >= contentL - TOL && u.x + u.w <= contentR + TOL;
      const rect = fits ? { x: contentL, y: u.y, w: contentR - contentL, h: u.h } : u;
      return {
        kind: "frame", name: "Row", rect, styles: {}, border: { t: 0, r: 0, b: 0, l: 0 },
        padding: { t: 0, r: 0, b: 0, l: 0 }, flow: "in", children: line, paintless: true, hint: "row",
      };
    });
    return flexAxis(ctx, n, rows, "column", styles);
  }
  return null;
}

interface MainPlan {
  gap: number;
  /** extra space before item i (i ≥ 1) that needs a spacer, by index */
  spacers: Map<number, number>;
  grows: Array<{ item: CapNode; side: Side; e: number }>;
}

function planMain(items: CapNode[], axis: Axis, gaps: number[], forceZeroGap: boolean): MainPlan | null {
  const plan: MainPlan = { gap: 0, spacers: new Map(), grows: [] };
  if (!gaps.length) return plan;
  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  if (!forceZeroGap && max - min <= 0.5) {
    plan.gap = round2(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    return plan;
  }
  plan.gap = forceZeroGap ? 0 : round2(min);
  const startSide: Side = axis === "column" ? "t" : "l";
  const endSide: Side = axis === "column" ? "b" : "r";
  for (let i = 0; i < gaps.length; i++) {
    const e = round2(gaps[i] - plan.gap);
    if (e <= 0.25) continue;
    const prev = items[i];
    const next = items[i + 1];
    if (canGrow(next)) plan.grows.push({ item: next, side: startSide, e });
    else if (canGrow(prev)) plan.grows.push({ item: prev, side: endSide, e });
    else {
      const size = round2(e - plan.gap);
      if (size < 0) return null;
      plan.spacers.set(i + 1, size);
    }
  }
  return plan;
}

function flexAxis(ctx: Ctx, n: CapNode, items: CapNode[], axis: Axis, styles: StyleMap): OutNode[] | null {
  const col = axis === "column";
  const box = inner(n);
  const pos = (c: CapNode) => (col ? c.rect.y : c.rect.x);
  const size = (c: CapNode) => (col ? c.rect.h : c.rect.w);
  const start = col ? box.t : box.l;
  const end = col ? box.b : box.r;

  const padStart = pos(items[0]) - start;
  if (padStart < -TOL) return null;
  const gaps = items.slice(1).map((c, i) => Math.max(0, pos(c) - (pos(items[i]) + size(items[i]))));
  const plan = planMain(items, axis, gaps, false) ?? planMain(items, axis, gaps, true);
  if (!plan) return null;
  for (const g of plan.grows) grow(g.item, g.side, g.e);

  const last = items[items.length - 1];
  let padEnd = end - (pos(last) + size(last));
  const overflow = padEnd < -TOL;
  padEnd = Math.max(0, padEnd);

  // cross axis
  const cStart = col ? box.l + n.padding.l : box.t + n.padding.t;
  const cEnd = col ? box.r - n.padding.r : box.b - n.padding.b;
  const cpos = (c: CapNode) => (col ? c.rect.x : c.rect.y);
  const csize = (c: CapNode) => (col ? c.rect.w : c.rect.h);

  interface ItemPlan {
    item: CapNode;
    align: AlignValue;
    offset: number;
  }
  const plans: ItemPlan[] = items.map((c) => {
    const a = cpos(c) - cStart;
    const b = cEnd - (cpos(c) + csize(c));
    const fixedBox = c.kind === "image" || c.kind === "svg";
    const stretchable = !fixedBox && (col || hasInFlowContent(c));
    if (Math.abs(a) <= TOL && Math.abs(b) <= TOL && stretchable) return { item: c, align: "stretch", offset: 0 };
    if (a > TOL && Math.abs(a - b) <= 1) return { item: c, align: "center", offset: 0 };
    if (Math.abs(a) <= TOL) return { item: c, align: "flex-start", offset: 0 };
    if (Math.abs(b) <= TOL) return { item: c, align: "flex-end", offset: 0 };
    if (a > 0 && canGrow(c)) {
      grow(c, col ? "l" : "t", a);
      return { item: c, align: "flex-start", offset: 0 };
    }
    return { item: c, align: "flex-start", offset: round2(a) };
  });

  const aligns = new Set(plans.map((p) => p.align));
  const shared: AlignValue | null = aligns.size === 1 ? plans[0].align : null;

  // container
  styles.display = "flex";
  styles.flexDirection = axis;
  if (plan.gap > 0) styles.gap = plan.gap;
  if (shared && shared !== "stretch") styles.alignItems = shared;
  const pad = col
    ? { t: padStart, r: n.padding.r, b: padEnd, l: n.padding.l }
    : { t: n.padding.t, r: padEnd, b: n.padding.b, l: padStart };
  setPadding(styles, pad.t, pad.r, pad.b, pad.l);
  if (overflow) {
    if (col) styles.height = round2(n.rect.h);
    else styles.width = round2(n.rect.w);
  }
  if (!col && plans.some((p) => p.align === "stretch")) styles.height = round2(n.rect.h);

  // children
  const out: OutNode[] = [];
  plans.forEach((p, i) => {
    const spacer = plan.spacers.get(i);
    if (spacer !== undefined && spacer > 0) {
      ctx.stats.spacers++;
      out.push({ kind: "frame", name: "Spacer", styles: col ? { height: spacer, flexShrink: 0 } : { width: spacer, flexShrink: 0 } });
    }
    const c = p.item;
    const s: StyleMap = {};
    if (!shared && p.align !== "stretch") s.alignSelf = p.align;
    if (p.offset !== 0) {
      s.position = "relative";
      s[col ? "left" : "top"] = p.offset;
    }
    const text = c.kind === "text";
    const hug = hugsText(c);
    let width: Placement["width"];
    let height: Placement["height"];
    if (col) {
      width = p.align === "stretch" || hug ? "auto" : "fixed";
      height = hasInFlowContent(c) ? "auto" : "fixed";
    } else {
      width = hug ? "auto" : "fixed";
      height = p.align === "stretch" ? "auto" : text ? "auto" : hasInFlowContent(c) ? "auto" : "fixed";
    }
    const mainFixed = col ? height === "fixed" : width === "fixed";
    if (mainFixed) s.flexShrink = 0;
    out.push(build(ctx, c, { styles: s, width, height, nowrap: singleLine(c) && (hug || !col || p.align !== "stretch") }));
  });
  return out;
}
