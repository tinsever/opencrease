// Required steps of the design quality layer (SPEC §8.5). They are written as a markdown list under
// "## Required steps" in the design guide layers (built-in, user, file). The last layer that has the
// heading decides the whole list, so a file can switch steps off that the built-in guide turns on.
// A heading with no items switches every step off.

export const REQUIRED_STEPS = ["brief", "review", "tokens", "small-steps"] as const;
export type RequiredStep = (typeof REQUIRED_STEPS)[number];

/** The list item text for each step, as written in the guide. */
export const REQUIRED_STEP_LABELS: Record<RequiredStep, string> = {
  brief: "Post a design brief first",
  review: "Screenshot and self-review each section",
  tokens: "Use file tokens, never raw values",
  "small-steps": "Build in small, visible steps",
};

export const REQUIRED_STEPS_HEADING = "## Required steps";

/** A single write_html that creates more layers than this gets a small-steps warning. */
export const SMALL_STEP_LAYER_LIMIT = 60;

/** Policy the server attaches to every editor-side tool call. */
export interface CallPolicy {
  steps: RequiredStep[];
}

const HEADING_RE = /^\s*##\s+required steps\s*$/i;
const ITEM_RE = /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/;

function stepForLabel(text: string): RequiredStep | undefined {
  const t = text.trim().toLowerCase();
  return REQUIRED_STEPS.find((s) => REQUIRED_STEP_LABELS[s].toLowerCase() === t);
}

/**
 * Steps listed under "## Required steps" in one guide layer, in canonical order.
 * Returns null when the layer has no such heading (it inherits from earlier layers).
 */
export function parseRequiredSteps(markdown: string): RequiredStep[] | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => HEADING_RE.test(l));
  if (start === -1) return null;
  const found = new Set<RequiredStep>();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*#{1,2}\s/.test(line)) break;
    const m = ITEM_RE.exec(line);
    if (!m) continue;
    // "- [ ] Step" is an unchecked task item: listed, but off
    if (/^\s*[-*]\s+\[ \]/.test(line)) continue;
    const step = stepForLabel(m[1]!);
    if (step) found.add(step);
  }
  return REQUIRED_STEPS.filter((s) => found.has(s));
}

/** Effective steps for a list of layer contents ordered from general to specific. */
export function effectiveRequiredSteps(layers: string[]): RequiredStep[] {
  let steps: RequiredStep[] = [...REQUIRED_STEPS];
  for (const content of layers) {
    const parsed = parseRequiredSteps(content);
    if (parsed) steps = parsed;
  }
  return steps;
}

/**
 * Turn one step on or off in a layer. A layer without the heading first copies the inherited list,
 * so the change only affects this layer and the ones after it. The heading stays even when empty.
 */
export function setRequiredStep(markdown: string, step: RequiredStep, on: boolean, inherited: RequiredStep[]): string {
  const current = parseRequiredSteps(markdown);
  const next = new Set(current ?? inherited);
  if (on) next.add(step);
  else next.delete(step);
  const items = REQUIRED_STEPS.filter((s) => next.has(s)).map((s) => `- ${REQUIRED_STEP_LABELS[s]}`);
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => HEADING_RE.test(l));
  if (start === -1) {
    const base = markdown.replace(/\s+$/, "");
    return `${base}${base ? "\n\n" : ""}${REQUIRED_STEPS_HEADING}\n${items.join("\n")}${items.length ? "\n" : ""}`;
  }
  // replace the recognised step items in the section, keep any other lines (notes, unknown items)
  let end = start + 1;
  while (end < lines.length && !/^\s*#{1,2}\s/.test(lines[end]!)) end++;
  const section = lines.slice(start + 1, end).filter((l) => {
    const m = ITEM_RE.exec(l);
    return !(m && stepForLabel(m[1]!));
  });
  // put the step items where the first list started (right after the heading and any intro text)
  const firstItem = section.findIndex((l) => ITEM_RE.test(l));
  let insertAt = firstItem === -1 ? section.length : firstItem;
  while (insertAt > 0 && section[insertAt - 1] === "" && firstItem === -1) insertAt--;
  section.splice(insertAt, 0, ...items);
  return [...lines.slice(0, start + 1), ...section, ...lines.slice(end)].join("\n");
}
