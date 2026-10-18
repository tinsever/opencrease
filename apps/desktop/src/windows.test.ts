import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ windows: [] as unknown[], openExternal: vi.fn() }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class Window extends EventEmitter {
    static getAllWindows = () => state.windows;
    static getFocusedWindow = () => null;
    options: Record<string, unknown>;
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(), send: vi.fn(),
      isLoading: () => false, getURL: () => "http://127.0.0.1:29908/",
    });
    show = vi.fn();
    focus = vi.fn();
    restore = vi.fn();
    loadURL = vi.fn();
    isDestroyed = () => false;
    isMinimized = () => true;
    getBounds = () => ({ x: 0, y: 0, width: 900, height: 600 });
    constructor(options: Record<string, unknown>) {
      super();
      this.options = options;
      state.windows.push(this);
    }
  }
  return {
    BrowserWindow: Window,
    screen: { getAllDisplays: () => [] },
    shell: { openExternal: state.openExternal },
  };
});
afterEach(() => {
  state.windows = [];
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("keeps every test window offscreen through ready, deep links and new windows", async () => {
  vi.stubEnv("OPENCREASE_DESKTOP_TEST", "1");
  const windows = await import("./windows");
  windows.initWindows({
    preload: "/test/preload.cjs", version: "0.1.0", editorUrl: () => "http://127.0.0.1:29908",
    savedBounds: () => undefined, saveBounds: vi.fn(),
  });
  const first = windows.createWindow();
  first.emit("ready-to-show");
  windows.openPath("/file/abc/page");
  const second = windows.createWindow();
  second.emit("ready-to-show");
  for (const window of [first, second]) {
    const w = window as unknown as { options: { show: boolean; webPreferences: Record<string, unknown> }; show: unknown; focus: unknown; restore: unknown };
    expect(w.options.show).toBe(false);
    expect(w.options.webPreferences).toMatchObject({ offscreen: true, disableDialogs: true, contextIsolation: true, sandbox: true, nodeIntegration: false });
    expect(w.show).not.toHaveBeenCalled();
    expect(w.focus).not.toHaveBeenCalled();
    expect(w.restore).not.toHaveBeenCalled();
  }
  expect(first.webContents.send).toHaveBeenCalledWith("opencrease:navigate", "/file/abc/page");
});

it("shows normal app windows when they are ready", async () => {
  vi.stubEnv("OPENCREASE_DESKTOP_TEST", "0");
  const windows = await import("./windows");
  windows.initWindows({
    preload: "/test/preload.cjs", version: "0.1.0", editorUrl: () => "http://127.0.0.1:29908",
    savedBounds: () => undefined, saveBounds: vi.fn(),
  });
  const window = windows.createWindow();
  expect(window.show).not.toHaveBeenCalled();
  window.emit("ready-to-show");
  expect(window.show).toHaveBeenCalledOnce();
});
