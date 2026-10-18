import { describe, expect, it } from "vitest";
import { inheritedSteps, overridingLayer, stepsAtLayer, toggleStep } from "./guide";

const BUILTIN = "# Craft\n\n## Required steps\n- Post a design brief first\n- Screenshot and self-review each section\n- Use file tokens, never raw values\n- Build in small, visible steps\n\n## Colour\nOne accent.";

describe("guide required steps", () => {
  it("inherits until a layer writes its own list", () => {
    const layers = [BUILTIN, "# Me", ""];
    expect(stepsAtLayer(layers, 2)).toEqual(["brief", "review", "tokens", "small-steps"]);
    expect(inheritedSteps(layers, 1)).toEqual(["brief", "review", "tokens", "small-steps"]);
  });

  it("turning a step off in a file copies the inherited list without it", () => {
    const layers = [BUILTIN, "", "# Kiln\n\nMood: dusk."];
    const out = toggleStep(layers, 2, "brief", false);
    expect(out).toBe("# Kiln\n\nMood: dusk.\n\n## Required steps\n- Screenshot and self-review each section\n- Use file tokens, never raw values\n- Build in small, visible steps\n");
    expect(stepsAtLayer([BUILTIN, "", out], 2)).toEqual(["review", "tokens", "small-steps"]);
  });

  it("keeps an empty heading so every step can be off, and is idempotent", () => {
    let file = "";
    for (const s of ["brief", "review", "tokens", "small-steps"] as const) file = toggleStep([BUILTIN, file], 1, s, false);
    expect(file).toBe("## Required steps\n");
    expect(stepsAtLayer([BUILTIN, file], 1)).toEqual([]);
    const on = toggleStep([BUILTIN, file], 1, "review", true);
    expect(toggleStep([BUILTIN, on], 1, "review", true)).toBe(on);
    expect(stepsAtLayer([BUILTIN, on], 1)).toEqual(["review"]);
  });

  it("keeps notes inside the section and stops at the next heading", () => {
    const file = "## Required steps\nWe skip briefs here.\n- Build in small, visible steps\n\n## Voice\n- Short";
    const out = toggleStep([BUILTIN, file], 1, "review", true);
    expect(out).toContain("We skip briefs here.");
    expect(out).toContain("## Voice\n- Short");
    expect(stepsAtLayer([BUILTIN, out], 1)).toEqual(["review", "small-steps"]);
  });

  it("reports a later layer that overrides the list", () => {
    expect(overridingLayer([BUILTIN, "", "## Required steps\n"], 1)).toBe(2);
    expect(overridingLayer([BUILTIN, "", "# no list"], 1)).toBe(-1);
  });
});
