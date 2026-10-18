import { describe, expect, it } from "vitest";
import { cardMeta, editedAgo } from "./time";

describe("editedAgo", () => {
  const now = new Date(2026, 9, 17, 15, 0, 0).getTime();
  it("formats recent times", () => {
    expect(editedAgo(now - 10_000, now)).toBe("just now");
    expect(editedAgo(now - 2 * 60_000, now)).toBe("2 min ago");
    expect(editedAgo(now - 3 * 3_600_000, now)).toBe("3 hours ago");
  });
  it("formats days", () => {
    expect(editedAgo(new Date(2026, 9, 16, 9).getTime(), now)).toBe("yesterday");
    expect(editedAgo(new Date(2026, 9, 13, 9).getTime(), now)).toBe("Tuesday");
    expect(editedAgo(new Date(2026, 9, 2, 9).getTime(), now)).toBe("Oct 2");
    expect(editedAgo(new Date(2025, 0, 2, 9).getTime(), now)).toBe("Jan 2, 2025");
  });
});

describe("cardMeta", () => {
  const now = new Date(2026, 9, 17, 15, 0, 0).getTime();
  it("puts the time first and the relative folder after", () => {
    expect(cardMeta(now - 120_000, "Kiln / Web", now)).toBe("Edited 2 min ago, Kiln / Web");
    expect(cardMeta(now - 120_000, "", now)).toBe("Edited 2 min ago");
  });
});
