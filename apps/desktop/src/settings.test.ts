import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSettings, sanitizeSettings, saveSettings, withWorkspace } from "./settings";

describe("settings", () => {
  it("drops malformed values", () => {
    expect(
      sanitizeSettings({
        workspace: "relative/dir",
        recentWorkspaces: ["/a", "/a", 3, "b"],
        port: 70000,
        updateFeedUrl: "http://insecure.example.com",
        windowBounds: { x: 0, y: 0, width: 10, height: 10 },
      }),
    ).toEqual({ recentWorkspaces: ["/a"] });
    expect(sanitizeSettings({ workspace: "C:\\Users\\me\\OpenCrease", port: 29881, updateFeedUrl: "https://example.com/updates" })).toEqual({
      workspace: "C:\\Users\\me\\OpenCrease",
      port: 29881,
      updateFeedUrl: "https://example.com/updates",
    });
    expect(sanitizeSettings(null)).toEqual({});
  });

  it("round-trips through disk and survives a broken file", () => {
    const dir = mkdtempSync(join(tmpdir(), "of-settings-"));
    try {
      const file = join(dir, "nested", "settings.json");
      expect(loadSettings(file)).toEqual({});
      saveSettings(file, { workspace: "/w", windowBounds: { x: 10, y: 20, width: 1200, height: 800 } });
      expect(loadSettings(file)).toEqual({ workspace: "/w", windowBounds: { x: 10, y: 20, width: 1200, height: 800 } });
      writeFileSync(file, "{ broken");
      expect(loadSettings(file)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps a recent list when switching workspaces", () => {
    let s = withWorkspace({}, "/a");
    s = withWorkspace(s, "/b");
    s = withWorkspace(s, "/a");
    expect(s).toEqual({ workspace: "/a", recentWorkspaces: ["/b"] });
  });
});
