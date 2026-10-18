/** Track start/end offsets from resolved track sizes ("100px 100px") and a gap. */
export function trackEdges(template: string, gap: number): Array<[number, number]> {
  const sizes = template
    .split(/\s+/)
    .map((t) => Number.parseFloat(t))
    .filter((n) => Number.isFinite(n));
  const out: Array<[number, number]> = [];
  let at = 0;
  for (const size of sizes) {
    out.push([at, at + size]);
    at += size + gap;
  }
  return out;
}

