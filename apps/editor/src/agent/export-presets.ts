// Export presets: named sets of export settings for common targets (inspector Presets menu).
import type { ExportSetting } from "@opencrease/model";

export interface ExportPreset {
  id: string;
  label: string;
  /** one line shown under the label */
  detail: string;
  settings: ExportSetting[];
}

const icon = (px: number, suffix = `-${px}`): ExportSetting => ({ format: "png", scale: `${px}w`, suffix });

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: "retina",
    label: "1x, 2x and 3x",
    detail: "PNG at three densities",
    settings: [
      { format: "png", scale: "1x" },
      { format: "png", scale: "2x" },
      { format: "png", scale: "3x" },
    ],
  },
  {
    id: "youtube-thumbnail",
    label: "YouTube thumbnail",
    detail: "JPG, 1280 wide (1280 × 720 for a 16:9 frame)",
    settings: [{ format: "jpg", scale: "1280w", suffix: "-youtube" }],
  },
  {
    id: "og-image",
    label: "Open Graph image",
    detail: "PNG, 1200 wide (1200 × 630 for a 1.91:1 frame)",
    settings: [{ format: "png", scale: "1200w", suffix: "-og" }],
  },
  {
    id: "app-icons",
    label: "App icon set",
    detail: "PNG at 1024, 512, 256, 192, 180, 167, 152, 120, 87, 80, 76, 60, 58, 40 and 29",
    settings: [1024, 512, 256, 192, 180, 167, 152, 120, 87, 80, 76, 60, 58, 40, 29].map((px) => icon(px)),
  },
  {
    id: "favicons",
    label: "Favicon set",
    detail: "PNG at 16, 32 and 48, Apple touch icon at 180, Android at 192 and 512",
    settings: [icon(16), icon(32), icon(48), icon(180, "-apple-touch-icon"), icon(192, "-android-192"), icon(512, "-android-512")],
  },
  {
    id: "social-video",
    label: "Social video",
    detail: "MP4, 1080p, 10 s at 30 fps",
    settings: [{ format: "mp4", scale: "1080p", durationSeconds: 10, fps: 30 }],
  },
];

export function getPreset(id: string): ExportPreset | undefined {
  const key = id.trim().toLowerCase();
  return EXPORT_PRESETS.find((p) => p.id === key || p.label.toLowerCase() === key);
}

/** Warnings about a preset applied to a node of the given size (e.g. a non-square app icon). */
export function presetWarnings(preset: ExportPreset, width: number, height: number): string[] {
  const out: string[] = [];
  const ratio = width / Math.max(1, height);
  if ((preset.id === "app-icons" || preset.id === "favicons") && Math.abs(ratio - 1) > 0.01) out.push("Icons should be square. This layer is not, so the icons will not be square either.");
  if (preset.id === "youtube-thumbnail" && Math.abs(ratio - 16 / 9) > 0.02) out.push("YouTube thumbnails are 16:9. Resize the frame to 1280 × 720 for an exact fit.");
  if (preset.id === "og-image" && Math.abs(ratio - 1200 / 630) > 0.02) out.push("Open Graph images are 1200 × 630. Resize the frame for an exact fit.");
  return out;
}
