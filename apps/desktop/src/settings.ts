// Desktop preferences, stored as JSON in the app's user data folder (settings.json).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopSettings {
  /** current workspace folder (absolute) */
  workspace?: string;
  /** most recent first, without the current one */
  recentWorkspaces?: string[];
  /** server port; 29880 when unset */
  port?: number;
  /** generic update feed (electron-updater "generic" provider). Updates are off when unset. */
  updateFeedUrl?: string;
  windowBounds?: WindowBounds;
}

const MAX_RECENT = 8;

function isAbsolute(p: unknown): p is string {
  return typeof p === "string" && p.length > 0 && p.length < 4096 && (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\"));
}

/** Keep only well-formed values, so a hand-edited or old file never breaks start-up. */
export function sanitizeSettings(raw: unknown): DesktopSettings {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: DesktopSettings = {};
  if (isAbsolute(src.workspace)) out.workspace = src.workspace;
  if (Array.isArray(src.recentWorkspaces)) out.recentWorkspaces = [...new Set(src.recentWorkspaces.filter(isAbsolute))].slice(0, MAX_RECENT);
  if (Number.isInteger(src.port) && (src.port as number) > 0 && (src.port as number) < 65536) out.port = src.port as number;
  if (typeof src.updateFeedUrl === "string" && /^https:\/\/\S+$/.test(src.updateFeedUrl)) out.updateFeedUrl = src.updateFeedUrl;
  const b = src.windowBounds as Record<string, unknown> | undefined;
  if (b && ["x", "y", "width", "height"].every((k) => Number.isFinite(b[k]))) {
    const width = Math.round(b.width as number);
    const height = Math.round(b.height as number);
    if (width >= 400 && height >= 300) out.windowBounds = { x: Math.round(b.x as number), y: Math.round(b.y as number), width, height };
  }
  return out;
}

export function loadSettings(file: string): DesktopSettings {
  try {
    return sanitizeSettings(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return {};
  }
}

export function saveSettings(file: string, settings: DesktopSettings): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(sanitizeSettings(settings), null, 2) + "\n");
  renameSync(tmp, file);
}

/** Switch to `next`, moving the previous workspace to the front of the recent list. */
export function withWorkspace(s: DesktopSettings, next: string): DesktopSettings {
  const recent = [s.workspace, ...(s.recentWorkspaces ?? [])].filter((p): p is string => !!p && p !== next);
  return { ...s, workspace: next, recentWorkspaces: [...new Set(recent)].slice(0, MAX_RECENT) };
}
