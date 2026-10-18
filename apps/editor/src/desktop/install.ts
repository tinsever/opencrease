// Wires the editor to the desktop app when it runs inside it (no-op in a browser tab).
import "./desktop.css";
import { goHome, openFile } from "../state/workspace";
import { runMenuCommand } from "./commands";
import { desktop, loadSystemFonts } from "./desktop";

/** "/file/<id>/<page>" or "/" from the main process (deep links, agent requests). */
function navigate(path: string): void {
  const m = /^\/file\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?\/?$/.exec(path);
  if (m) void openFile(m[1]!, m[2]).catch((e: unknown) => alert(`Could not open the file: ${e instanceof Error ? e.message : String(e)}`));
  else if (path === "/") goHome();
}

export function installDesktop(): void {
  if (!desktop) return;
  const root = document.documentElement;
  root.dataset.ofDesktop = desktop.platform;
  const setFullScreen = (on: boolean) => {
    if (on) root.dataset.ofFullscreen = "";
    else delete root.dataset.ofFullscreen;
  };
  void desktop.isFullScreen().then(setFullScreen);
  desktop.onFullScreenChange(setFullScreen);
  desktop.onMenuCommand(runMenuCommand);
  desktop.onNavigate(navigate);
  loadSystemFonts();
}
