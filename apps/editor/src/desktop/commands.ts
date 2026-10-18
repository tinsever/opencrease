// Native menu commands from the desktop app (apps/desktop/src/menu.ts). Commands that have a keyboard
// shortcut replay that shortcut, so the menu and the keyboard run the same code in canvas/shortcuts.ts
// with the same guards (text editing, drags, focused inputs).
import { exportNodes } from "../agent/exporter";
import { closeFile, createAndOpenFile, getActiveFile, getState, goHome } from "../state/workspace";
import { openCommandPalette, openConnectDialog, openSettings } from "../panels/shared";

interface Shortcut {
  key: string;
  code: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

const SHORTCUTS: Record<string, Shortcut> = {
  undo: { key: "z", code: "KeyZ", mod: true },
  redo: { key: "z", code: "KeyZ", mod: true, shift: true },
  duplicate: { key: "d", code: "KeyD", mod: true },
  delete: { key: "Backspace", code: "Backspace" },
  "select-all": { key: "a", code: "KeyA", mod: true },
  "wrap-frame": { key: "g", code: "KeyG", mod: true },
  "add-flex": { key: "A", code: "KeyA", shift: true },
  "bring-forward": { key: "]", code: "BracketRight", mod: true },
  "send-backward": { key: "[", code: "BracketLeft", mod: true },
  "bring-to-front": { key: "]", code: "BracketRight", mod: true, alt: true },
  "send-to-back": { key: "[", code: "BracketLeft", mod: true, alt: true },
  "zoom-in": { key: "=", code: "Equal", mod: true },
  "zoom-out": { key: "-", code: "Minus", mod: true },
  "zoom-100": { key: "0", code: "Digit0", mod: true },
  "zoom-fit": { key: "!", code: "Digit1", shift: true },
  "zoom-selection": { key: "@", code: "Digit2", shift: true },
  "toggle-ui": { key: "\\", code: "Backslash", mod: true },
  "tool-move": { key: "v", code: "KeyV" },
  "tool-frame": { key: "f", code: "KeyF" },
  "tool-rect": { key: "r", code: "KeyR" },
  "tool-text": { key: "t", code: "KeyT" },
  "tool-hand": { key: "h", code: "KeyH" },
  "insert-image": { key: "i", code: "KeyI" },
};

/** Native editing commands for a focused text field (the canvas handlers ignore those). */
const TEXT_COMMANDS: Record<string, string> = { undo: "undo", redo: "redo", "select-all": "selectAll", delete: "delete" };

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

function isTyping(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

function replay(s: Shortcut): void {
  const init: KeyboardEventInit = {
    key: s.key,
    code: s.code,
    metaKey: !!s.mod && isMac,
    ctrlKey: !!s.mod && !isMac,
    shiftKey: !!s.shift,
    altKey: !!s.alt,
    bubbles: true,
    cancelable: true,
  };
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", init));
}

const ACTIONS: Record<string, () => void> = {
  "new-file": () => void createAndOpenFile().catch((e: unknown) => alert(`Could not create a file: ${e instanceof Error ? e.message : String(e)}`)),
  home: goHome,
  "close-tab": () => {
    const active = getState().route.kind === "file" ? getActiveFile() : undefined;
    if (active) closeFile(active.id);
    else window.close();
  },
  "export-selection": () => {
    const file = getActiveFile();
    if (!file || !file.selection.length) return;
    void exportNodes(file.id, file.selection).catch((e: unknown) => alert(String(e)));
  },
  palette: openCommandPalette,
  connect: openConnectDialog,
  settings: () => openSettings("general"),
  shortcuts: () => openSettings("shortcuts"),
  guide: () => openSettings("guide"),
};

export function runMenuCommand(command: string): void {
  const text = TEXT_COMMANDS[command];
  if (text && isTyping()) {
    document.execCommand(text);
    return;
  }
  const shortcut = SHORTCUTS[command];
  if (shortcut) return replay(shortcut);
  ACTIONS[command]?.();
}
