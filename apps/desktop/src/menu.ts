// The native application menu. Items that belong to the editor send a command id to the focused
// window (apps/editor/src/desktop/commands.ts runs it). Shortcuts are the editor's own: modifier
// shortcuts are registered with the OS (the page still sees the key first and handles it), single
// keys like V or F are only displayed, so typing in a text field is never taken over by the menu.
import { app, Menu, type MenuItemConstructorOptions } from "electron";

export interface MenuActions {
  send(command: string): void;
  newWindow(): void;
  openFolder(): void;
  installCli(): void;
  checkForUpdates: (() => void) | null;
  isDev: boolean;
}

const isMac = process.platform === "darwin";

export function buildMenu(a: MenuActions): Menu {
  const cmd = (label: string, command: string, accelerator?: string, register = true): MenuItemConstructorOptions => ({
    id: command,
    label,
    click: () => a.send(command),
    ...(accelerator ? { accelerator, registerAccelerator: register } : {}),
  });
  const sep: MenuItemConstructorOptions = { type: "separator" };

  const appMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: "about" },
      ...(a.checkForUpdates ? [{ label: "Check for updates…", click: a.checkForUpdates }] : []),
      sep,
      cmd("Settings…", "settings", "Cmd+,"),
      { label: "Install command line tool…", click: a.installCli },
      sep,
      { role: "services" },
      sep,
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      sep,
      { role: "quit" },
    ],
  };

  const file: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      cmd("New file", "new-file", "CmdOrCtrl+N"),
      { id: "new-window", label: "New window", accelerator: "CmdOrCtrl+Shift+N", click: a.newWindow },
      sep,
      { id: "open-folder", label: "Open folder…", accelerator: "CmdOrCtrl+O", click: a.openFolder },
      cmd("All files", "home", "CmdOrCtrl+Shift+H"),
      sep,
      cmd("Export selection…", "export-selection", "CmdOrCtrl+Shift+E"),
      sep,
      cmd("Close tab", "close-tab", "CmdOrCtrl+W"),
      { role: "close", label: "Close window", accelerator: "CmdOrCtrl+Shift+W" },
      ...(isMac ? [] : [sep, { ...cmd("Settings…", "settings", "Ctrl+,"), id: "settings-file-menu" }, { label: "Install command line tool…", click: a.installCli }, sep, { role: "quit" as const }]),
    ],
  };

  const edit: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      cmd("Undo", "undo", "CmdOrCtrl+Z"),
      cmd("Redo", "redo", "CmdOrCtrl+Shift+Z"),
      sep,
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      cmd("Duplicate", "duplicate", "CmdOrCtrl+D"),
      cmd("Delete", "delete", "Backspace", false),
      cmd("Select all", "select-all", "CmdOrCtrl+A"),
      sep,
      cmd("Command palette…", "palette", "CmdOrCtrl+K"),
    ],
  };

  const layer: MenuItemConstructorOptions = {
    label: "Layer",
    submenu: [
      cmd("Wrap in frame", "wrap-frame", "CmdOrCtrl+G"),
      cmd("Add flex layout", "add-flex", "Shift+A", false),
      sep,
      cmd("Bring forward", "bring-forward", "CmdOrCtrl+]"),
      cmd("Send backward", "send-backward", "CmdOrCtrl+["),
      cmd("Bring to front", "bring-to-front", "CmdOrCtrl+Alt+]"),
      cmd("Send to back", "send-to-back", "CmdOrCtrl+Alt+["),
    ],
  };

  const tools: MenuItemConstructorOptions = {
    label: "Tools",
    submenu: [
      cmd("Move", "tool-move", "V", false),
      cmd("Frame", "tool-frame", "F", false),
      cmd("Rectangle", "tool-rect", "R", false),
      cmd("Text", "tool-text", "T", false),
      cmd("Hand", "tool-hand", "H", false),
      sep,
      cmd("Place image…", "insert-image", "I", false),
    ],
  };

  const view: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      cmd("Zoom in", "zoom-in", "CmdOrCtrl+="),
      cmd("Zoom out", "zoom-out", "CmdOrCtrl+-"),
      cmd("Zoom to 100%", "zoom-100", "CmdOrCtrl+0"),
      cmd("Zoom to fit", "zoom-fit", "Shift+1", false),
      cmd("Zoom to selection", "zoom-selection", "Shift+2", false),
      sep,
      cmd("Show or hide interface", "toggle-ui", "CmdOrCtrl+\\"),
      sep,
      { role: "togglefullscreen" },
      ...(a.isDev ? [sep, { role: "reload" as const }, { role: "toggleDevTools" as const }] : []),
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    role: "windowMenu",
    submenu: isMac ? [{ role: "minimize" }, { role: "zoom" }, sep, { role: "front" }] : [{ role: "minimize" }, { role: "close" }],
  };

  const help: MenuItemConstructorOptions = {
    role: "help",
    submenu: [
      cmd("Connect an agent…", "connect"),
      cmd("Design guide…", "guide"),
      cmd("Keyboard shortcuts", "shortcuts"),
      ...(isMac ? [] : [sep, { role: "about" as const }, ...(a.checkForUpdates ? [{ label: "Check for updates…", click: a.checkForUpdates }] : [])]),
    ],
  };

  return Menu.buildFromTemplate([...(isMac ? [appMenu] : []), file, edit, layer, tools, view, windowMenu, help]);
}
