// Sandboxed preload: exposes a small, typed API as window.opencreaseDesktop. No Node APIs, no raw
// ipcRenderer; every call is a fixed channel with validated arguments on the main side.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AgentClientId, DesktopBridge, DesktopPlatform } from "@opencrease/protocol";

const versionArg = process.argv.find((a) => a.startsWith("--opencrease-version="));

function listen<T>(channel: string, check: (v: unknown) => v is T, listener: (v: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: unknown) => {
    if (check(value)) listener(value);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const isString = (v: unknown): v is string => typeof v === "string";
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

const bridge: DesktopBridge = {
  version: versionArg ? versionArg.slice("--opencrease-version=".length) : "",
  platform: process.platform as DesktopPlatform,
  openFolder: () => ipcRenderer.invoke("opencrease:open-folder"),
  listSystemFonts: () => ipcRenderer.invoke("opencrease:system-fonts"),
  previewAgentConfig: (client: AgentClientId) => ipcRenderer.invoke("opencrease:agent-config-preview", String(client)),
  applyAgentConfig: (planId: string) => ipcRenderer.invoke("opencrease:agent-config-apply", String(planId)),
  onMenuCommand: (listener) => listen("opencrease:menu", isString, listener),
  onNavigate: (listener) => listen("opencrease:navigate", isString, listener),
  onFullScreenChange: (listener) => listen("opencrease:fullscreen", isBoolean, listener),
  isFullScreen: () => ipcRenderer.invoke("opencrease:is-fullscreen"),
};

contextBridge.exposeInMainWorld("opencreaseDesktop", bridge);
