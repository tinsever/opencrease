// Stroke expansion in SVG user units. PaperOffset keeps cubic curves; dashes are cut by arc length.
import paper from "paper";
import { PaperOffset } from "paperjs-offset";
import type { Paint } from "./svg-geom";

function portion(path: paper.Path, start: number, end: number): paper.Path {
  let part = path.clone({ insert: false }) as paper.Path;
  if (part.closed) part.splitAt(0);
  if (end < path.length - 1e-7) part.splitAt(end)?.remove();
  if (start > 1e-7) {
    const tail = part.splitAt(start);
    part.remove();
    part = tail;
  }
  return part;
}

function dashParts(path: paper.Path, paint: Paint): paper.Path[] {
  const raw = paint.strokeDasharray;
  if (!raw || raw === "none") return [path];
  const pattern = raw.trim().split(/[\s,]+/).map(Number);
  if (pattern.some((n) => !Number.isFinite(n) || n < 0)) throw new Error("Stroke dashes must use non-negative lengths.");
  if (pattern.length % 2) pattern.push(...pattern);
  const period = pattern.reduce((a, b) => a + b, 0);
  if (period <= 1e-9) return [path];
  let phase = ((paint.strokeDashoffset ?? 0) % period + period) % period;
  let index = 0;
  while (phase > 0 && phase >= pattern[index]) {
    phase -= pattern[index];
    index = (index + 1) % pattern.length;
  }
  let at = 0;
  let remaining = pattern[index] - phase;
  const ranges: Array<[number, number]> = [];
  for (let steps = 0; at < path.length - 1e-7; steps++) {
    if (steps > 10000) throw new Error("This stroke has too many dashes to outline.");
    const end = Math.min(path.length, at + remaining);
    if (index % 2 === 0) ranges.push([at, end]);
    at = end;
    index = (index + 1) % pattern.length;
    remaining = pattern[index];
  }
  if (path.closed && ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === path.length) return [path];
  const parts = ranges.map(([a, b]) => b - a > 1e-7 ? portion(path, a, b) : new paper.Path({ segments: [path.getPointAt(a)], insert: false }));
  // A dash crossing a closed path's seam has a join there, rather than two end caps.
  if (path.closed && ranges.length > 1 && ranges[0][0] === 0 && ranges.at(-1)![1] === path.length) {
    const last = parts.pop()!;
    last.join(parts[0]);
    parts[0] = last;
  }
  return parts;
}

function squareCap(path: paper.Path, end: boolean, radius: number): paper.Path | null {
  const tangent = path.getTangentAt(end ? path.length : 0);
  if (!tangent) return null;
  const along = tangent.normalize(radius).multiply(end ? 1 : -1);
  const normal = along.rotate(90, new paper.Point(0, 0));
  const p = end ? path.lastSegment.point : path.firstSegment.point;
  return new paper.Path({ segments: [p.add(normal), p.add(along).add(normal), p.add(along).subtract(normal), p.subtract(normal)], closed: true, insert: false });
}

export function expandStroke(item: paper.PathItem, paint: Paint): paper.PathItem {
  const paths = item instanceof paper.CompoundPath ? item.children as paper.Path[] : [item as paper.Path];
  const radius = paint.strokeWidth / 2;
  let result: paper.PathItem | null = null;
  const append = (part: paper.PathItem) => { result = result ? result.unite(part, { insert: false }) : part; };
  const join = paint.strokeLinejoin === "round" ? "round" : paint.strokeLinejoin === "bevel" ? "bevel" : "miter";
  for (const path of paths) {
    if (path.length < 1e-7) continue;
    for (const part of dashParts(path, paint)) {
      if (part.length < 1e-7) {
        if (paint.strokeLinecap === "round") append(new paper.Path.Circle({ center: part.firstSegment.point, radius, insert: false }));
        else if (paint.strokeLinecap === "square") append(new paper.Path.Rectangle({ point: part.firstSegment.point.subtract([radius, radius]), size: [radius * 2, radius * 2], insert: false }));
        continue;
      }
      append(PaperOffset.offsetStroke(part, radius, { cap: paint.strokeLinecap === "round" ? "round" : "butt", join, limit: paint.strokeMiterlimit ?? 4, insert: false }));
      if (!part.closed && paint.strokeLinecap === "square") {
        for (const end of [false, true]) {
          const cap = squareCap(part, end, radius);
          if (cap) append(cap);
        }
      }
    }
  }
  return result ?? new paper.Path({ insert: false });
}
