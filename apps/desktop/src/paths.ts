// Where the desktop app finds its parts, in development (running from the repository) and packaged.
//
// Packaged layout (electron-builder extraResources, outside app.asar so the CLI can read them in Node mode):
//   <resources>/editor/     the built editor (apps/editor/dist)
//   <resources>/guides/     built-in design guides (apps/server/guides)
//   <resources>/cli/opencrease-cli.mjs  the bundled `opencrease` CLI
import { app } from "electron";
import { join } from "node:path";

export interface AppPaths {
  editorDist: string;
  guidesDir: string;
  cliEntry: string;
  preload: string;
  /** user data folder of this app (settings, CLI launcher) */
  userData: string;
  /** how another process starts this app (used by `opencrease mcp` when the app is not running) */
  appLaunch: string[];
}

export function resolvePaths(): AppPaths {
  const dist = __dirname; // apps/desktop/dist in development, app.asar/dist when packaged
  const userData = app.getPath("userData");
  if (app.isPackaged) {
    const res = process.resourcesPath;
    return {
      editorDist: join(res, "editor"),
      guidesDir: join(res, "guides"),
      cliEntry: join(res, "cli", "opencrease-cli.mjs"),
      preload: join(dist, "preload.cjs"),
      userData,
      appLaunch: [process.execPath],
    };
  }
  const appDir = app.getAppPath(); // apps/desktop
  return {
    editorDist: process.env.OPENCREASE_EDITOR_DIST || join(appDir, "..", "editor", "dist"),
    guidesDir: join(appDir, "..", "server", "guides"),
    cliEntry: join(dist, "opencrease-cli.mjs"),
    preload: join(dist, "preload.cjs"),
    userData,
    appLaunch: [process.execPath, appDir],
  };
}
