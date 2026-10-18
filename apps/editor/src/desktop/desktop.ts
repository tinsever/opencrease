// The desktop app's preload bridge (apps/desktop). Undefined in a normal browser tab, so every
// desktop-only feature checks `desktop` first and stays hidden or disabled without it.
import { useEffect, useSyncExternalStore } from "react";
import type { DesktopBridge } from "@opencrease/protocol";

declare global {
  interface Window {
    opencreaseDesktop?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | undefined = typeof window !== "undefined" ? window.opencreaseDesktop : undefined;

// ---------------------------------------------------------------- system fonts

let systemFonts: string[] = [];
let systemFontsLower = new Set<string>();
let fontsRequested = false;
const fontListeners = new Set<() => void>();

export function loadSystemFonts(): void {
  if (!desktop || fontsRequested) return;
  fontsRequested = true;
  void desktop
    .listSystemFonts()
    .then((list) => {
      systemFonts = list;
      systemFontsLower = new Set(list.map((f) => f.toLowerCase()));
      fontListeners.forEach((l) => l());
    })
    .catch(() => {
      fontsRequested = false;
    });
}

/** True when `family` is installed on this computer (desktop app only). */
export function isSystemFamily(family: string): boolean {
  return systemFontsLower.has(family.toLowerCase());
}

/** Font families installed on this computer; empty in the browser. */
export function useSystemFonts(): string[] {
  useEffect(loadSystemFonts, []);
  return useSyncExternalStore(
    (l) => {
      fontListeners.add(l);
      return () => fontListeners.delete(l);
    },
    () => systemFonts,
  );
}
