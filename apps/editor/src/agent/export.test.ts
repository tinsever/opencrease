import { describe, expect, it } from "vitest";
import { uniqueNames, evenSize, formatBytes, resampleTarget, settingOutputSize, videoBitrate, videoTiming } from "./export-settings";
import { EXPORT_PRESETS, getPreset, presetWarnings } from "./export-presets";
import { slotPlaceholder } from "./shader-frames";
import { alphaPlaneI420, splitTemplate } from "./video";

describe("video settings", () => {
  it("clamps length and frame rate", () => {
    expect(videoTiming({})).toEqual({ seconds: 10, fps: 30, frames: 300 });
    expect(videoTiming({ durationSeconds: 0.2, fps: 60 })).toEqual({ seconds: 1, fps: 60, frames: 60 });
    expect(videoTiming({ durationSeconds: 1000, fps: 24 })).toEqual({ seconds: 300, fps: 24, frames: 7200 });
    expect(videoTiming({ durationSeconds: 2.5, fps: 50 })).toEqual({ seconds: 2.5, fps: 30, frames: 75 });
  });

  it("rounds frames to even sizes and picks a sane bitrate", () => {
    expect(evenSize(481, 271)).toEqual({ width: 482, height: 272 });
    expect(evenSize(1, 1)).toEqual({ width: 2, height: 2 });
    expect(videoBitrate(1920, 1080, 30)).toBe(6_220_800);
    expect(videoBitrate(64, 64, 24)).toBe(1_000_000);
    expect(videoBitrate(7680, 4320, 60)).toBe(40_000_000);
  });

  it("computes the output size shown in the Export section", () => {
    expect(settingOutputSize({ format: "png", scale: "2x" }, 1440, 640)).toEqual({ width: 2880, height: 1280 });
    expect(settingOutputSize({ format: "mp4", scale: "1080p" }, 1440, 641)).toEqual({ width: 2426, height: 1080 });
    expect(settingOutputSize({ format: "webm", scale: "8x" }, 1920, 1080)).toEqual({ width: 3840, height: 2160 });
    expect(settingOutputSize({ format: "pdf", scale: "3x" }, 300, 200)).toEqual({ width: 300, height: 200 });
    expect(settingOutputSize({ format: "png", scale: "nope" }, 10, 10)).toBeNull();
  });

  it("formats byte counts", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.4 * 1024 * 1024)).toBe("1.4 MB");
    expect(formatBytes(42 * 1024 * 1024)).toBe("42 MB");
  });
});

describe("PDF image resampling", () => {
  it("keeps images up to 2x (detailed) or 1x (basic) their displayed size", () => {
    expect(resampleTarget({ width: 4000, height: 2000 }, { width: 400, height: 200 }, "detailed")).toEqual({ width: 800, height: 400 });
    expect(resampleTarget({ width: 4000, height: 2000 }, { width: 400, height: 200 }, "basic")).toEqual({ width: 400, height: 200 });
    expect(resampleTarget({ width: 800, height: 400 }, { width: 400, height: 200 }, "detailed")).toBeNull();
  });
});

describe("export presets", () => {
  it("has the required presets with valid settings", () => {
    for (const id of ["youtube-thumbnail", "og-image", "app-icons", "favicons"]) expect(getPreset(id), id).toBeDefined();
    for (const p of EXPORT_PRESETS) {
      expect(p.settings.length, p.id).toBeGreaterThan(0);
      for (const s of p.settings) expect(settingOutputSize(s, 1280, 720), `${p.id} ${s.scale}`).not.toBeNull();
      const suffixes = p.settings.map((s) => `${s.suffix ?? s.scale}.${s.format}`);
      expect(new Set(suffixes).size, p.id).toBe(suffixes.length);
    }
    expect(getPreset("Open Graph image")?.id).toBe("og-image");
  });

  it("warns about frames with the wrong shape", () => {
    expect(presetWarnings(getPreset("app-icons")!, 512, 512)).toEqual([]);
    expect(presetWarnings(getPreset("app-icons")!, 512, 300)).toHaveLength(1);
    expect(presetWarnings(getPreset("youtube-thumbnail")!, 1280, 720)).toEqual([]);
    expect(presetWarnings(getPreset("og-image")!, 1000, 1000)).toHaveLength(1);
  });
});

describe("video frame template", () => {
  it("splits markup at shader placeholders", () => {
    const markup = `<svg><img src="${slotPlaceholder("s2")}"/><p/><img src="${slotPlaceholder("s1")}"/></svg>`;
    expect(splitTemplate(markup, ["s1", "s2"])).toEqual(['<svg><img src="', { slot: "s2" }, '"/><p/><img src="', { slot: "s1" }, '"/></svg>']);
    expect(splitTemplate("<svg/>", ["s1"])).toEqual(["<svg/>"]);
  });

  it("puts alpha in the luma plane with neutral chroma", () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 0, 1, 2, 3, 255, 0, 0, 0, 128]); // 3x1
    const out = alphaPlaneI420(rgba, 3, 1);
    expect([...out]).toEqual([0, 255, 128, 128, 128, 128, 128]);
  });
});

it("keeps every export name unique even when a layer already has a numbered name", () => {
  expect(uniqueNames(["Card.png", "Card (2).png", "card.png", "Card.png"])).toEqual(["Card.png", "Card (2).png", "card (3).png", "Card (4).png"]);
});
