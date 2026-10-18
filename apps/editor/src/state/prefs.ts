// Editor preferences kept in localStorage: theme, canvas wheel behaviour, motion and panel widths.
// A tiny external store; read with usePrefs(selector) and change with setPrefs(patch).
import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark";

export interface Prefs {
  theme: ThemePref;
  /** the mouse wheel zooms (hold ⌘ or Ctrl to pan instead) */
  scrollZoom: boolean;
  /** flip the zoom direction of the wheel and pinch */
  invertZoom: boolean;
  /** no pulsing outlines or moving dots while an agent works */
  reduceAgentMotion: boolean;
  leftWidth: number;
  rightWidth: number;
}

export const PANEL_LIMITS = { left: { min: 200, max: 480, default: 248 }, right: { min: 240, max: 520, default: 264 } } as const;

const KEY = "opencrease.prefs";
const DEFAULTS: Prefs = {
  theme: "system",
  scrollZoom: false,
  invertZoom: false,
  reduceAgentMotion: false,
  leftWidth: PANEL_LIMITS.left.default,
  rightWidth: PANEL_LIMITS.right.default,
};

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

export function parsePrefs(raw: unknown): Prefs {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    theme: v.theme === "light" || v.theme === "dark" ? v.theme : "system",
    scrollZoom: v.scrollZoom === true,
    invertZoom: v.invertZoom === true,
    reduceAgentMotion: v.reduceAgentMotion === true,
    leftWidth: clamp(v.leftWidth, PANEL_LIMITS.left.min, PANEL_LIMITS.left.max, DEFAULTS.leftWidth),
    rightWidth: clamp(v.rightWidth, PANEL_LIMITS.right.min, PANEL_LIMITS.right.max, DEFAULTS.rightWidth),
  };
}

function load(): Prefs {
  try {
    const s = globalThis.localStorage?.getItem(KEY);
    return parsePrefs(s ? JSON.parse(s) : {});
  } catch {
    return { ...DEFAULTS };
  }
}

let prefs: Prefs = load();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return prefs;
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = parsePrefs({ ...prefs, ...patch });
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable: keep the in-memory value
  }
  for (const l of [...listeners]) l();
}

export function subscribePrefs(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePrefs<T>(selector: (p: Prefs) => T): T {
  return useSyncExternalStore(subscribePrefs, () => selector(prefs));
}

// ---------------------------------------------------------------- theme and motion

const darkQuery = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
const motionQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

export function resolvedTheme(p: Prefs = prefs): "light" | "dark" {
  if (p.theme === "system") return darkQuery?.matches ? "dark" : "light";
  return p.theme;
}

/** True when agent animations should not run (the setting or the OS reduced-motion preference). */
export function reduceMotion(p: Prefs = prefs): boolean {
  return p.reduceAgentMotion || !!motionQuery?.matches;
}

function applyToDocument() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme();
  root.dataset.agentMotion = reduceMotion() ? "reduced" : "full";
  root.style.setProperty("--of-left-panel", `${prefs.leftWidth}px`);
  root.style.setProperty("--of-right-panel", `${prefs.rightWidth}px`);
}

/** Apply prefs to <html> (theme, motion, panel widths) now and whenever they or the OS settings change. */
export function installPrefs() {
  applyToDocument();
  subscribePrefs(applyToDocument);
  darkQuery?.addEventListener?.("change", () => {
    applyToDocument();
    for (const l of [...listeners]) l();
  });
  motionQuery?.addEventListener?.("change", applyToDocument);
}
