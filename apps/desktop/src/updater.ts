// Auto-update with electron-updater. Off unless a feed is configured: set OPENCREASE_UPDATE_URL, or
// "updateFeedUrl" in the app's settings.json, to an https URL serving electron-builder's generic
// provider files (latest-mac.yml, latest.yml, latest-linux.yml and the artifacts). Only packaged
// builds update. macOS only installs updates for signed builds (Squirrel.Mac requirement).
import { app, dialog } from "electron";

export interface Updater {
  check(interactive: boolean): void;
}

const SIX_HOURS = 6 * 60 * 60 * 1000;

export function updateFeed(settingsFeed: string | undefined): string | null {
  const url = process.env.OPENCREASE_UPDATE_URL || settingsFeed;
  return url && /^https:\/\/\S+$/.test(url) ? url : null;
}

/** Returns null (and does nothing) when updates are not configured or the app is not packaged. */
export async function setupUpdater(feedUrl: string | null): Promise<Updater | null> {
  if (!feedUrl || !app.isPackaged) return null;
  const { autoUpdater } = await import("electron-updater");
  autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let interactive = false;

  autoUpdater.on("update-downloaded", (info) => {
    void dialog
      .showMessageBox({
        type: "info",
        message: `OpenCrease ${info.version} is ready to install`,
        detail: "Restart now to update, or it installs the next time you quit.",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });
  autoUpdater.on("update-not-available", () => {
    if (interactive) void dialog.showMessageBox({ type: "info", message: "OpenCrease is up to date", detail: `You have version ${app.getVersion()}.` });
    interactive = false;
  });
  autoUpdater.on("error", (err) => {
    console.warn("[opencrease] update check failed:", err?.message ?? err);
    if (interactive) void dialog.showMessageBox({ type: "warning", message: "Could not check for updates", detail: String(err?.message ?? err) });
    interactive = false;
  });

  const check = (isInteractive: boolean) => {
    interactive = isInteractive;
    autoUpdater.checkForUpdates().catch(() => {});
  };
  check(false);
  setInterval(() => check(false), SIX_HOURS).unref();
  return { check };
}
