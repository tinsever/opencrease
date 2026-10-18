// Pure helpers for exports: scale parsing, output sizes, file names, MIME types.
import type { ExportSetting } from "@opencrease/model";

export type ExportFormat = ExportSetting["format"];

export const DEFAULT_EXPORT: ExportSetting = { format: "png", scale: "2x" };
export const IMAGE_FORMATS: ReadonlySet<ExportFormat> = new Set(["png", "jpg", "webp", "avif"]);
export const VIDEO_FORMATS: ReadonlySet<ExportFormat> = new Set(["mp4", "webm"]);
/** Largest canvas side we render; browsers fail somewhere above 16k. */
export const MAX_EXPORT_SIDE = 16_384;

export const MIME: Record<ExportFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
};

/**
 * Pixel ratio for a scale string relative to a node of width x height:
 * "2x" multiplier, "512w" target width, "630h" target height, "720p" shortest side.
 */
export function parseExportScale(scale: string, width: number, height: number): number {
  const m = /^(\d+(?:\.\d+)?)(x|w|h|p)$/.exec(String(scale).trim());
  if (!m) throw new Error(`Invalid export scale "${scale}". Use "2x", "512w", "512h" or "720p".`);
  const n = Number(m[1]);
  if (!(n > 0)) throw new Error(`Export scale must be positive, got "${scale}"`);
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  switch (m[2]) {
    case "x":
      return n;
    case "w":
      return n / w;
    case "h":
      return n / h;
    default:
      return n / Math.min(w, h);
  }
}

/** Clamp a pixel ratio so the output stays under MAX_EXPORT_SIDE. */
export function clampRatio(ratio: number, width: number, height: number, maxSide = MAX_EXPORT_SIDE): number {
  const longest = Math.max(width, height, 1);
  return Math.min(ratio, maxSide / longest);
}

/** Output size in whole pixels. */
export function outputSize(width: number, height: number, ratio: number): { width: number; height: number } {
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/** "Hero, desktop" → "Hero, desktop"; strips characters that are unsafe in file names. */
export function safeFileStem(name: string): string {
  let s = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "-").trim();
  s = s.replace(/^\.+/, "").replace(/[. ]+$/, "");
  if (s.length > 100) s = s.slice(0, 100).trim();
  return s || "Export";
}

/** File name for an export: `<name><suffix>.<ext>`, suffix defaults to "@2x" style for non-1x scales. */
export function exportFileName(nodeName: string, setting: Pick<ExportSetting, "format" | "scale" | "suffix">): string {
  const suffix = setting.suffix ?? (setting.scale === "1x" || setting.format === "svg" || setting.format === "pdf" ? "" : `@${setting.scale}`);
  return `${safeFileStem(nodeName)}${suffix}.${setting.format}`;
}

/** Makes names unique within one export run: "Card.png", "Card (2).png", ... */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

// ------------------------------------------------------------------ video

export const VIDEO_FPS = [24, 30, 60] as const;
export const DEFAULT_VIDEO: ExportSetting = { format: "mp4", scale: "1x", durationSeconds: 10, fps: 30 };
export const MAX_VIDEO_SECONDS = 300;

/** Length, frame rate and frame count of a video setting, clamped to 1 to 300 s and 24/30/60 fps. */
export function videoTiming(setting: Pick<ExportSetting, "durationSeconds" | "fps">): { seconds: number; fps: number; frames: number } {
  const raw = Number(setting.durationSeconds ?? DEFAULT_VIDEO.durationSeconds);
  const seconds = Math.min(MAX_VIDEO_SECONDS, Math.max(1, Number.isFinite(raw) ? raw : 10));
  const fps = (VIDEO_FPS as readonly number[]).includes(Number(setting.fps)) ? Number(setting.fps) : 30;
  return { seconds, fps, frames: Math.max(1, Math.round(seconds * fps)) };
}

/** Video encoders want even dimensions (4:2:0 chroma). */
export function evenSize(width: number, height: number): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** Target bitrate: about 0.1 bits per pixel per frame, between 1 and 40 Mbit/s. */
export function videoBitrate(width: number, height: number, fps: number): number {
  return Math.round(Math.min(40e6, Math.max(1e6, width * height * fps * 0.1)));
}

/** Largest video frame we encode (4K on the longest side). */
export const MAX_VIDEO_SIDE = 3840;

// ------------------------------------------------------------------ display

/** "1.4 MB", "820 KB", "512 B" */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Output size of a setting for a node of width x height, as shown in the Export section. */
export function settingOutputSize(setting: ExportSetting, width: number, height: number): { width: number; height: number } | null {
  if (setting.format === "svg") return { width: Math.round(width), height: Math.round(height) };
  let ratio: number;
  try {
    ratio = parseExportScale(setting.scale, width, height);
  } catch {
    return null;
  }
  if (VIDEO_FORMATS.has(setting.format)) {
    const r = Math.min(ratio, MAX_VIDEO_SIDE / Math.max(width, height, 1));
    const s = outputSize(width, height, r);
    return evenSize(s.width, s.height);
  }
  if (setting.format === "pdf") return { width: Math.round(width), height: Math.round(height) };
  return outputSize(width, height, clampRatio(ratio, width, height));
}

/**
 * Pixel size an image should have in a PDF: its displayed size times 2 ("detailed") or 1 ("basic").
 * Null when the image is already small enough.
 */
export function resampleTarget(natural: { width: number; height: number }, shown: { width: number; height: number }, resampling: "detailed" | "basic"): { width: number; height: number } | null {
  const factor = resampling === "basic" ? 1 : 2;
  const maxW = Math.max(1, Math.round(shown.width * factor));
  const maxH = Math.max(1, Math.round(shown.height * factor));
  const scale = Math.min(1, maxW / Math.max(1, natural.width), maxH / Math.max(1, natural.height));
  if (scale > 0.95) return null;
  return { width: Math.max(1, Math.round(natural.width * scale)), height: Math.max(1, Math.round(natural.height * scale)) };
}

/** JPEG quality inside PDFs. */
export function pdfJpegQuality(q: "low" | "medium" | "high" | undefined): number {
  return q === "low" ? 0.6 : q === "medium" ? 0.8 : 0.92;
}

/** Order for combined PDFs: top to bottom, then left to right (rows within 1px). */
export function canvasOrder<T extends { x: number; y: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (Math.abs(a.y - b.y) > 1 ? a.y - b.y : a.x - b.x));
}
