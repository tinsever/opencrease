// Small matching helpers shared by the agent tools. Pure, no DOM.

/** Case-insensitive glob anchored to the whole value, "*" is the only wildcard. */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "is");
}

export function hasWildcard(pattern: string): boolean {
  return pattern.includes("*");
}

export function globMatch(pattern: string, value: string): boolean {
  return globToRegExp(pattern).test(value);
}

/** Parses "120px", "120", 120 to a number; anything else to undefined. */
export function pxNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const m = /^\s*(-?\d+(?:\.\d+)?)(px)?\s*$/i.exec(value);
  return m ? Number(m[1]) : undefined;
}

/** Rounds to 2 decimals so results stay readable. */
export function round(n: number): number {
  return Math.round(n * 100) / 100;
}
