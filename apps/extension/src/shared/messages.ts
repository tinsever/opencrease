// Messages between the popup, the background script and the content script, and the stored settings.
import type { CaptureMode, SnapshotPayload } from "../snapshot/types";

export const DEFAULT_PORT = 29880;

/** "active" = the file open in the editor, "new" = a new file, "clipboard", or "file:<id>". */
export type Destination = "active" | "new" | "clipboard" | `file:${string}`;

export interface Settings {
  port: number;
  /** Credential stays in extension storage/background; never sent to content scripts. */
  token?: string;
  destination: Destination;
  keepFonts: boolean;
  colorTokens: boolean;
}

export const DEFAULT_SETTINGS: Settings = { port: DEFAULT_PORT, destination: "active", keepFonts: true, colorTokens: true };

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get("settings")) as { settings?: Partial<Settings> };
  return { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export type ToBackground =
  | { type: "capture"; mode: CaptureMode; tabId: number }
  | { type: "fetch-images"; urls: string[] }
  | { type: "deliver"; payload: SnapshotPayload; settings: Settings };

export type ToContent =
  | { type: "start"; mode: CaptureMode; settings: Settings }
  | { type: "state" };

export type ContentState = { picking: boolean; busy: boolean };

/** Progress broadcast to the popup while it is open. */
export type StatusMessage = { type: "status"; phase: "picking" | "capturing" | "sending" | "done" | "error" | "idle"; text: string };

export interface DeliverResult {
  ok: boolean;
  message: string;
  fileName?: string;
  url?: string;
}
