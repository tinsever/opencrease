// Review nudges (SPEC 8.5): after REVIEW_THRESHOLD writes to the same artboard without a
// get_screenshot of it, write tools append a checkpoint reminder. Pure, no DOM.

export const REVIEW_THRESHOLD = 5;

export function reviewReminder(artboardName: string): string {
  return `Review checkpoint: take a screenshot of "${artboardName}" and check spacing, type, contrast, alignment and clipping before continuing.`;
}

export class ReviewTracker {
  #counts = new Map<string, number>();

  constructor(readonly threshold = REVIEW_THRESHOLD) {}

  #key(fileId: string, artboardId: string): string {
    return `${fileId}\u0000${artboardId}`;
  }

  /** Count one write per artboard. Returns the artboards that are due for a review. */
  recordWrite(fileId: string, artboardIds: Iterable<string>): string[] {
    const due: string[] = [];
    for (const id of new Set(artboardIds)) {
      const key = this.#key(fileId, id);
      const n = (this.#counts.get(key) ?? 0) + 1;
      this.#counts.set(key, n);
      if (n >= this.threshold) due.push(id);
    }
    return due;
  }

  /** A screenshot of (something inside) the artboard resets its counter. */
  recordScreenshot(fileId: string, artboardId: string): void {
    this.#counts.delete(this.#key(fileId, artboardId));
  }

  count(fileId: string, artboardId: string): number {
    return this.#counts.get(this.#key(fileId, artboardId)) ?? 0;
  }
}
