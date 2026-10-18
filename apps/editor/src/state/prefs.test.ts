import { describe, expect, it } from "vitest";
import { parsePrefs } from "./prefs";
describe("editor preferences", () => {
  it("repairs stale preferences and clamps panel sizes", () => {
    expect(parsePrefs({ theme: "sepia", leftWidth: -500, rightWidth: 9000, scrollZoom: "yes" })).toMatchObject({ theme: "system", leftWidth: 200, rightWidth: 520, scrollZoom: false });
    expect(parsePrefs({ theme: "dark", invertZoom: true, reduceAgentMotion: true })).toMatchObject({ theme: "dark", invertZoom: true, reduceAgentMotion: true });
  });
});
