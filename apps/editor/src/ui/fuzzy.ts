// Small fuzzy matcher for the command palette, layer search and token search.

export interface FuzzyMatch {
  score: number;
  /** indices of matched characters in the candidate */
  indices: number[];
}

/**
 * Subsequence match, case-insensitive. Higher score is better; null when the query does not match.
 * Rewards consecutive runs, word starts and prefix matches; penalises gaps and long candidates.
 */
export function fuzzyMatch(query: string, candidate: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const c = candidate.toLowerCase();

  // exact substring gets a strong bonus and contiguous indices
  const sub = c.indexOf(q);
  if (sub >= 0) {
    const atWord = sub === 0 || /[\s\-_/.]/.test(c[sub - 1]);
    const score = 1000 - sub * 2 - (c.length - q.length) * 0.5 + (sub === 0 ? 200 : 0) + (atWord ? 100 : 0);
    return { score, indices: Array.from({ length: q.length }, (_, k) => sub + k) };
  }

  const indices: number[] = [];
  let score = 0;
  let ci = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    let found = -1;
    while (ci < c.length) {
      if (c[ci] === ch) {
        found = ci;
        break;
      }
      ci++;
    }
    if (found < 0) return null;
    const wordStart = found === 0 || /[\s\-_/.]/.test(c[found - 1]) || (candidate[found] !== c[found] && candidate[found - 1] === c[found - 1]);
    score += 10;
    if (found === prev + 1) score += 15;
    if (wordStart) score += 12;
    score -= Math.min(found - prev - 1, 10);
    indices.push(found);
    prev = found;
    ci = found + 1;
  }
  score -= (c.length - indices.length) * 0.2;
  return { score, indices };
}

/** Filters and sorts items by fuzzy score (stable for equal scores). Empty query keeps the input order. */
export function fuzzyFilter<T>(items: readonly T[], query: string, key: (item: T) => string | string[]): T[] {
  if (!query.trim()) return [...items];
  const scored: Array<{ item: T; score: number; order: number }> = [];
  items.forEach((item, order) => {
    const keys = key(item);
    let best: number | null = null;
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      const m = fuzzyMatch(query, k);
      if (m && (best === null || m.score > best)) best = m.score;
    }
    if (best !== null) scored.push({ item, score: best, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.item);
}
