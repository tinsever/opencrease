// Required steps in the design guide layers, as shown in Settings, Design guide. The parsing and the
// "last layer with a list wins" rule live in @opencrease/protocol so the server enforces the same thing.
import { effectiveRequiredSteps, parseRequiredSteps, REQUIRED_STEP_LABELS, REQUIRED_STEPS, setRequiredStep, type RequiredStep } from "@opencrease/protocol";

export { REQUIRED_STEP_LABELS, REQUIRED_STEPS, type RequiredStep };

/** Steps in force at layer `index` (layers before it plus itself). */
export function stepsAtLayer(contents: string[], index: number): RequiredStep[] {
  return effectiveRequiredSteps(contents.slice(0, index + 1));
}

/** Steps a layer inherits from the layers before it. */
export function inheritedSteps(contents: string[], index: number): RequiredStep[] {
  return effectiveRequiredSteps(contents.slice(0, index));
}

/** Index of a later layer that sets its own list (so edits here do not take effect), or -1. */
export function overridingLayer(contents: string[], index: number): number {
  for (let i = contents.length - 1; i > index; i--) if (parseRequiredSteps(contents[i]) !== null) return i;
  return -1;
}

/** Turn a step on or off in the layer at `index`. */
export function toggleStep(contents: string[], index: number, step: RequiredStep, on: boolean): string {
  return setRequiredStep(contents[index] ?? "", step, on, inheritedSteps(contents, index));
}
