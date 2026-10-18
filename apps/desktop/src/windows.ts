// Editor windows. Each window is a full editor (with its own file tabs) connected to the in-process server.
import { BrowserWindow, screen, shell, type WebContents } from "electron";
import { desktopTest } from "./test-mode";
import type { WindowBounds } from "./settings";

export interface WindowDeps {
  preload: string;
  version: string;
  /** origin + base the editor is served from, e.g. http://127.0.0.1:29880 */
  editorUrl(): string;
  savedBounds(): WindowBounds | undefined;
  saveBounds(b: WindowBounds): void;
}

const CHROME_BG = "#F4F4F2"; // --of-chrome, so a new window does not flash white
const isMac = process.platform === "darwin";

let deps: WindowDeps;
let lastFocused: BrowserWindow | null = null;

export function initWindows(d: WindowDeps): void {
  deps = d;
}

/** True when `url` belongs to the editor (same origin as the editor URL). */
export function isEditorUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).origin === new URL(deps.editorUrl()).origin;
  } catch {
    return false;
  }
}

/** Editor IPC is only answered for the top frame of our own windows on the editor origin. */
export function isTrustedSender(sender: WebContents, frameUrl: string | undefined, isMainFrame: boolean): boolean {
  return isMainFrame && BrowserWindow.fromWebContents(sender) !== null && isEditorUrl(frameUrl);
}

function visibleBounds(b: WindowBounds | undefined): WindowBounds | undefined {
  if (!b) return undefined;
  const fits = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 10 && b.y < a.y + a.height - 80;
  });
  return fits ? b : undefined;
}

function openExternal(url: string): void {
  if (desktopTest) return;
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:") void shell.openExternal(u.href);
  } catch {
    /* ignore */
  }
}

export function createWindow(path = "/"): BrowserWindow {
  const saved = BrowserWindow.getAllWindows().length === 0 ? visibleBounds(deps.savedBounds()) : undefined;
  const offset = lastFocused && !lastFocused.isDestroyed() ? lastFocused.getBounds() : undefined;
  const win = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    ...(saved ? { x: saved.x, y: saved.y } : offset ? { x: offset.x + 24, y: offset.y + 24 } : {}),
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: "OpenCrease",
    backgroundColor: CHROME_BG,
    ...(isMac ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 12 } } : {}),
    webPreferences: {
      preload: deps.preload,
      offscreen: desktopTest,
      disableDialogs: desktopTest,
      backgroundThrottling: !desktopTest,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      additionalArguments: [`--opencrease-version=${deps.version}`],
    },
  });

  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (!isEditorUrl(url)) openExternal(url);
    else createWindow(new URL(url).pathname);
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => {
    if (isEditorUrl(url)) return;
    e.preventDefault();
    openExternal(url);
  });
  wc.on("will-attach-webview", (e) => e.preventDefault());
  win.once("ready-to-show", () => {
    if (!desktopTest) win.show();
  });
  win.on("focus", () => (lastFocused = win));
  win.on("enter-full-screen", () => wc.send("opencrease:fullscreen", true));
  win.on("leave-full-screen", () => wc.send("opencrease:fullscreen", false));
  win.on("close", () => {
    if (!win.isFullScreen() && !win.isMinimized()) deps.saveBounds(win.getNormalBounds());
  });
  win.on("closed", () => {
    if (lastFocused === win) lastFocused = null;
  });

  void win.loadURL(`${deps.editorUrl()}${path.startsWith("/") ? path : `/${path}`}`);
  lastFocused = win;
  return win;
}

/** The window menu commands go to: the focused one, else the last focused one. */
export function targetWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused) return focused;
  if (lastFocused && !lastFocused.isDestroyed()) return lastFocused;
  return BrowserWindow.getAllWindows()[0] ?? null;
}

/** Show an editor path ("/file/<id>/<page>" or "/") in an existing window, or open one. */
export function openPath(path: string): void {
  const win = targetWindow();
  if (!win) {
    createWindow(path);
    return;
  }
  if (!desktopTest) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  if (win.webContents.isLoading() || !isEditorUrl(win.webContents.getURL())) void win.loadURL(`${deps.editorUrl()}${path}`);
  else win.webContents.send("opencrease:navigate", path);
}

/** Reload every window at the files home (after the workspace changed). */
export function reloadAll(): void {
  for (const w of BrowserWindow.getAllWindows()) void w.loadURL(`${deps.editorUrl()}/`);
}
