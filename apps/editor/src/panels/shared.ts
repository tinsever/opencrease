// Panel-local UI state and hooks shared by the left and right panels (no document data here).
import { useSyncExternalStore } from "react";
import { useWorkspace } from "../state/hooks";

interface PanelState {
  /** token id selected in the Theme tab (shown in the right panel) */
  selectedTokenId: string | null;
  /** per file: expanded layer ids */
  expanded: Record<string, Record<string, boolean>>;
}

let state: PanelState = { selectedTokenId: null, expanded: {} };
const listeners = new Set<() => void>();

function set(patch: Partial<PanelState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function usePanelState<T>(selector: (s: PanelState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
  );
}

export function selectToken(id: string | null) {
  set({ selectedTokenId: id });
}

export function setExpanded(fileId: string, ids: string[], value: boolean) {
  const forFile = { ...(state.expanded[fileId] ?? {}) };
  for (const id of ids) forFile[id] = value;
  set({ expanded: { ...state.expanded, [fileId]: forFile } });
}

export function getExpanded(fileId: string): Record<string, boolean> {
  return state.expanded[fileId] ?? {};
}

const TEN_MINUTES = 10 * 60_000;

/** Agent clients seen over the bridge in the last 10 minutes, most recent first. Re-evaluated every 30 s. */
export function useRecentAgents(): Array<{ name: string; lastSeen: number }> {
  const clients = useWorkspace((s) => s.agentClients);
  const tick = useMinuteTick();
  const now = Date.now() + tick * 0;
  return Object.entries(clients)
    .filter(([, t]) => now - t < TEN_MINUTES)
    .sort((a, b) => b[1] - a[1])
    .map(([name, lastSeen]) => ({ name, lastSeen }));
}

let tickValue = 0;
const tickListeners = new Set<() => void>();
setInterval(() => {
  tickValue++;
  for (const l of tickListeners) l();
}, 30_000);

/** A counter that changes every 30 s, to refresh relative times. */
export function useMinuteTick(): number {
  return useSyncExternalStore(
    (l) => {
      tickListeners.add(l);
      return () => tickListeners.delete(l);
    },
    () => tickValue,
  );
}

export function openConnectDialog() {
  window.dispatchEvent(new CustomEvent("opencrease:connect-agent"));
}

export function openSettings(page?: "general" | "agents" | "guide" | "shortcuts") {
  window.dispatchEvent(new CustomEvent("opencrease:settings", { detail: { page } }));
}

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent("opencrease:command-palette"));
}
