// Equal-spacing snapping and distance measurements, on top of the edge and centre snapping in
// snapping.ts. All values are world units.
import type { Rect } from "./geometry";
import { snapMove, type Guide } from "./snapping";

/** A measured distance drawn as a line with a label, world space. */
export interface Measure {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  value: number;
}

export interface SmartSnap {
  dx: number;
  dy: number;
  guides: Guide[];
  measures: Measure[];
}

type Axis = "x" | "y";

interface Span {
  start: number;
  end: number;
}

const main = (r: Rect, a: Axis): Span => (a === "x" ? { start: r.x, end: r.x + r.width } : { start: r.y, end: r.y + r.height });
const cross = (r: Rect, a: Axis): Span => (a === "x" ? { start: r.y, end: r.y + r.height } : { start: r.x, end: r.x + r.width });

function overlap(a: Span, b: Span): Span | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

/** Line between `from` and `to` along `axis`, drawn halfway across the shared cross range of a and b. */
function measureLine(axis: Axis, from: number, to: number, a: Rect, b: Rect): Measure {
  const o = overlap(cross(a, axis), cross(b, axis)) ?? cross(a, axis);
  const at = (o.start + o.end) / 2;
  return axis === "x" ? { x1: from, y1: at, x2: to, y2: at, value: to - from } : { x1: at, y1: from, x2: at, y2: to, value: to - from };
}

interface Candidate {
  offset: number;
  measures: (snapped: Rect) => Measure[];
}

/** Gaps between neighbouring targets in a row (or column), with the pair that makes each gap. */
function existingGaps(rects: Rect[], axis: Axis): Array<{ a: Rect; b: Rect; gap: number }> {
  const out: Array<{ a: Rect; b: Rect; gap: number }> = [];
  const sorted = [...rects].sort((a, b) => main(a, axis).start - main(b, axis).start);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const ae = main(a, axis).end;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const bs = main(b, axis).start;
      if (bs < ae - 0.01 || !overlap(cross(a, axis), cross(b, axis))) continue;
      out.push({ a, b, gap: bs - ae });
      break;
    }
  }
  return out;
}

/**
 * Best equal-spacing offset along one axis for `moving` among `targets`: centred between its two
 * neighbours, or next to a neighbour at a gap that already exists between other layers.
 */
export function equalSpacingAxis(moving: Rect, targets: Rect[], axis: Axis, threshold: number): Candidate | null {
  const m = main(moving, axis);
  const size = m.end - m.start;
  const centre = (m.start + m.end) / 2;
  const row = targets.filter((t) => overlap(cross(t, axis), cross(moving, axis)));
  let before: Rect | null = null;
  let after: Rect | null = null;
  for (const t of row) {
    const s = main(t, axis);
    if (s.end <= centre && (s.start + s.end) / 2 < centre && (!before || s.end > main(before, axis).end)) before = t;
    if (s.start >= centre && (s.start + s.end) / 2 > centre && (!after || s.start < main(after, axis).start)) after = t;
  }
  const candidates: Candidate[] = [];

  if (before && after) {
    const b = before;
    const a = after;
    const free = main(a, axis).start - main(b, axis).end - size;
    if (free >= 0) {
      const start = main(b, axis).end + free / 2;
      candidates.push({
        offset: start - m.start,
        measures: (s) => [measureLine(axis, main(b, axis).end, main(s, axis).start, s, b), measureLine(axis, main(s, axis).end, main(a, axis).start, s, a)],
      });
    }
  }

  const gaps = existingGaps(row, axis).filter((g) => g.gap > 0.5);
  for (const g of gaps) {
    const ref = () => [measureLine(axis, main(g.a, axis).end, main(g.b, axis).start, g.a, g.b)];
    if (before) {
      const b = before;
      const start = main(b, axis).end + g.gap;
      candidates.push({ offset: start - m.start, measures: (s) => [measureLine(axis, main(b, axis).end, main(s, axis).start, s, b), ...ref()] });
    }
    if (after) {
      const a = after;
      const start = main(a, axis).start - g.gap - size;
      candidates.push({ offset: start - m.start, measures: (s) => [measureLine(axis, main(s, axis).end, main(a, axis).start, s, a), ...ref()] });
    }
  }

  let best: Candidate | null = null;
  for (const c of candidates) {
    if (Math.abs(c.offset) > threshold) continue;
    if (!best || Math.abs(c.offset) < Math.abs(best.offset) - 0.01) best = c;
  }
  return best;
}

function dedupe(measures: Measure[]): Measure[] {
  const seen = new Set<string>();
  return measures.filter((m) => {
    const k = [m.x1, m.y1, m.x2, m.y2].map((n) => Math.round(n * 10)).join(",");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Snap a moving rect to edges, centres and equal spacing. Per axis the closer match wins; edge
 * alignment wins ties. Returns the correction, alignment guides and spacing measurements.
 */
export function smartSnapMove(moving: Rect, targets: Rect[], threshold: number): SmartSnap {
  const edge = snapMove(moving, targets, threshold);
  const edgeX = edge.guides.some((g) => g.orientation === "vertical");
  const edgeY = edge.guides.some((g) => g.orientation === "horizontal");
  const eqX = equalSpacingAxis(moving, targets, "x", threshold);
  const eqY = equalSpacingAxis(moving, targets, "y", threshold);
  const useEqX = !!eqX && (!edgeX || Math.abs(eqX.offset) < Math.abs(edge.dx) - 0.01);
  const useEqY = !!eqY && (!edgeY || Math.abs(eqY.offset) < Math.abs(edge.dy) - 0.01);
  const dx = useEqX ? eqX!.offset : edge.dx;
  const dy = useEqY ? eqY!.offset : edge.dy;
  const snapped: Rect = { ...moving, x: moving.x + dx, y: moving.y + dy };
  // guides for whatever is now aligned (a spacing snap can also line up edges)
  const guides = snapMove(snapped, targets, 0.5).guides;
  const measures = [...(useEqX ? eqX!.measures(snapped) : []), ...(useEqY ? eqY!.measures(snapped) : [])];
  return { dx, dy, guides, measures: dedupe(measures) };
}

/**
 * Distances between a selection and another layer (the Alt-hover measurement). When one contains the
 * other, the four insets; otherwise the horizontal and vertical gaps between them.
 */
export function measureBetween(a: Rect, b: Rect): Measure[] {
  const contains = (o: Rect, i: Rect) => i.x >= o.x - 0.01 && i.y >= o.y - 0.01 && i.x + i.width <= o.x + o.width + 0.01 && i.y + i.height <= o.y + o.height + 0.01;
  const out: Measure[] = [];
  if (contains(b, a) || contains(a, b)) {
    const [inner, outer] = contains(b, a) ? [a, b] : [b, a];
    const cy = inner.y + inner.height / 2;
    const cx = inner.x + inner.width / 2;
    const push = (m: Measure) => m.value > 0.01 && out.push(m);
    push({ x1: outer.x, y1: cy, x2: inner.x, y2: cy, value: inner.x - outer.x });
    push({ x1: inner.x + inner.width, y1: cy, x2: outer.x + outer.width, y2: cy, value: outer.x + outer.width - inner.x - inner.width });
    push({ x1: cx, y1: outer.y, x2: cx, y2: inner.y, value: inner.y - outer.y });
    push({ x1: cx, y1: inner.y + inner.height, x2: cx, y2: outer.y + outer.height, value: outer.y + outer.height - inner.y - inner.height });
    return out;
  }
  for (const axis of ["x", "y"] as Axis[]) {
    const ma = main(a, axis);
    const mb = main(b, axis);
    if (mb.start >= ma.end) out.push(measureLine(axis, ma.end, mb.start, a, b));
    else if (ma.start >= mb.end) out.push(measureLine(axis, mb.end, ma.start, a, b));
  }
  return out;
}
