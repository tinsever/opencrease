// OpenCrease desktop: Electron main process.
//
// It runs the OpenCrease server in-process (same code as the `opencrease` CLI, bundled by esbuild),
// opens editor windows on it, and adds what a browser tab cannot do: native menus, choosing a
// workspace folder, system fonts, deep links, the CLI installer and writing agent MCP configs.
import { cookieName } from "../../server/src/auth";
import { app, BrowserWindow, dialog, ipcMain, Menu, session, type IpcMainInvokeEvent } from "electron";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AgentConfigWriter, isAgentClient, type StdioCommand } from "./agent-config";
import { linkState, linkUserCli, linkWithAdminPrompt, onPath, writeLauncher } from "./cli-install";
import { deepLinkFromArgv, parseDeepLink, PROTOCOL } from "./deep-link";
import { buildMenu } from "./menu";
import { resolvePaths } from "./paths";
import { ServerHost } from "./server-host";
import { loadSettings, saveSettings, withWorkspace, type DesktopSettings } from "./settings";
import { listSystemFonts } from "./system-fonts";
import { setupUpdater, updateFeed, type Updater } from "./updater";
import { createWindow, initWindows, isEditorUrl, isTrustedSender, openPath, reloadAll, targetWindow } from "./windows";
import { desktopTest } from "./test-mode";
import { DEFAULT_PORT } from "../../server/src/config";

const isMac = process.platform === "darwin";
const isDev = !app.isPackaged;
if (desktopTest && isMac) app.setActivationPolicy("prohibited");

// ------------------------------------------------------------------ identity and single instance

// Development builds keep their own settings and CLI launcher, apart from an installed app.
app.setName(isDev ? "OpenCrease Dev" : "OpenCrease");
app.setPath("userData", process.env.OPENCREASE_DESKTOP_USER_DATA ? resolve(process.env.OPENCREASE_DESKTOP_USER_DATA) : join(app.getPath("appData"), app.getName()));

function argValue(name: string, argv = process.argv): string | undefined {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const background = process.argv.includes("--background");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void run();
}

async function run(): Promise<void> {
  const paths = resolvePaths();
  const settingsFile = join(paths.userData, "settings.json");
  let settings: DesktopSettings = loadSettings(settingsFile);
  const persist = (next: DesktopSettings) => {
    settings = next;
    try {
      saveSettings(settingsFile, settings);
    } catch (err) {
      console.warn("[opencrease] could not save settings:", err);
    }
  };

  const explicitPort = argValue("port") ?? process.env.OPENCREASE_PORT;
  const port = explicitPort !== undefined && /^\d+$/.test(explicitPort) ? Number(explicitPort) : (settings.port ?? DEFAULT_PORT);
  const envWorkspace = process.env.OPENCREASE_WORKSPACE ? resolve(process.env.OPENCREASE_WORKSPACE) : undefined;
  const workspace = envWorkspace || settings.workspace || join(app.getPath("documents"), "OpenCrease");

  let ready = false;
  const pending: string[] = [];
  const navigate = (path: string) => (ready ? openPath(path) : pending.push(path));

  // Deep links: macOS delivers them as open-url (also before ready), Windows and Linux as argv.
  app.on("open-url", (e, url) => {
    e.preventDefault();
    const path = parseDeepLink(url);
    if (path) navigate(path);
  });
  app.on("second-instance", (_e, argv) => {
    const path = deepLinkFromArgv(argv);
    if (path) return navigate(path);
    if (argv.includes("--background")) return;
    const win = targetWindow();
    if (win) {
      if (!desktopTest) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    } else if (ready) createWindow();
  });
  if (!isDev && !desktopTest) app.setAsDefaultProtocolClient(PROTOCOL);

  await app.whenReady();
  if (desktopTest) app.dock?.hide();

  const host = new ServerHost({
    workspace,
    port,
    strictPort: explicitPort !== undefined,
    editorDist: paths.editorDist,
    guidesDir: paths.guidesDir,
    ...(process.env.OPENCREASE_EDITOR_URL ? { editorBaseUrl: process.env.OPENCREASE_EDITOR_URL } : {}),
    openEditor: (url) => {
      if (!isEditorUrl(url)) return;
      const u = new URL(url);
      openPath(u.pathname + u.search);
    },
  });

  initWindows({
    preload: paths.preload,
    version: app.getVersion(),
    editorUrl: () => host.editorUrl,
    savedBounds: () => settings.windowBounds,
    saveBounds: (b) => persist({ ...settings, windowBounds: b }),
  });

  try {
    const server = await host.start();
    await session.defaultSession.cookies.set({ url: host.editorUrl, name: cookieName(server.port), value: server.token, httpOnly: true, sameSite: "strict" });
    if (!envWorkspace && settings.workspace !== server.workspace.root) persist(withWorkspace(settings, server.workspace.root));
    console.log(`[opencrease] server ${server.url} workspace ${server.workspace.root}`);
  } catch (err) {
    if (desktopTest) console.error("[opencrease] server startup failed:", err);
    else dialog.showErrorBox("OpenCrease could not start", `The local server did not start: ${(err as Error).message}`);
    app.exit(1);
    return;
  }

  // ---------------------------------------------------------------- command line launcher
  let launcher: string | null = null;
  try {
    launcher = await writeLauncher(join(paths.userData, "bin"), {
      exec: process.execPath,
      cliEntry: paths.cliEntry,
      appLaunch: paths.appLaunch,
      editorDist: paths.editorDist,
      guidesDir: paths.guidesDir,
    });
  } catch (err) {
    console.warn("[opencrease] could not write the CLI launcher:", err);
  }

  const stdioCommand = (): StdioCommand => {
    const args = host.mcpArgs();
    if (process.platform === "win32" || !launcher) {
      // Windows clients spawn without a shell, which cannot run .cmd files: call the app in Node mode.
      return {
        command: process.execPath,
        args: [paths.cliEntry, ...args],
        env: { ELECTRON_RUN_AS_NODE: "1", OPENCREASE_DESKTOP_LAUNCH: JSON.stringify(paths.appLaunch) },
      };
    }
    return { command: launcher, args };
  };
  const agentConfig = new AgentConfigWriter({ home: homedir(), platform: process.platform, env: process.env }, stdioCommand);

  // ---------------------------------------------------------------- security
  const editorOrigin = () => new URL(host.editorUrl).origin;
  const allowedPermissions = new Set(["clipboard-read", "clipboard-sanitized-write", "fullscreen", "local-fonts"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done, details) => {
    done(allowedPermissions.has(permission) && isEditorUrl(details.requestingUrl));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => allowedPermissions.has(permission) && origin === editorOrigin());

  const handle = (channel: string, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, (e, ...args) => {
      const frame = e.senderFrame;
      if (!frame || !isTrustedSender(e.sender, frame.url, frame === e.sender.mainFrame)) throw new Error("Not allowed");
      return fn(e, ...args);
    });
  };

  // ---------------------------------------------------------------- workspace
  const openFolder = async (win?: BrowserWindow | null): Promise<string | null> => {
    const opts: Electron.OpenDialogOptions = {
      title: "Open folder",
      message: "Choose a folder to use as your OpenCrease workspace. Its .fold files appear in Files.",
      buttonLabel: "Open",
      defaultPath: host.workspace,
      properties: ["openDirectory", "createDirectory"],
    };
    // Tests provide a throwaway folder instead of showing a native picker.
    const testFolder = process.env.OPENCREASE_DESKTOP_TEST_FOLDER;
    const res = desktopTest
      ? { canceled: !testFolder, filePaths: testFolder ? [resolve(testFolder)] : [] }
      : win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const dir = res.canceled ? undefined : res.filePaths[0];
    if (!dir) return null;
    if (resolve(dir) === host.workspace) return dir;
    try {
      const server = await host.restart(dir);
      await session.defaultSession.cookies.set({ url: host.editorUrl, name: cookieName(server.port), value: server.token, httpOnly: true, sameSite: "strict" });
      persist(withWorkspace(settings, server.workspace.root));
      reloadAll();
      return server.workspace.root;
    } catch (err) {
      if (desktopTest) console.error("[opencrease] folder switch failed:", err);
      else dialog.showErrorBox("Could not open the folder", (err as Error).message);
      // try to get back to the previous workspace
      await host.restart(settings.workspace ?? workspace).catch(() => {});
      reloadAll();
      return null;
    }
  };

  // ---------------------------------------------------------------- CLI install
  const installCli = async () => {
    if (desktopTest) return;
    const win = targetWindow() ?? undefined;
    const show = (o: Electron.MessageBoxOptions) => (win ? dialog.showMessageBox(win, o) : dialog.showMessageBox(o));
    if (!launcher) {
      await show({ type: "error", message: "The command line tool is not available", detail: "OpenCrease could not write its launcher script into the app data folder." });
      return;
    }
    if (process.platform === "win32") {
      await show({
        type: "info",
        message: "Add OpenCrease to your PATH",
        detail: `The opencrease command is in:\n${join(paths.userData, "bin")}\n\nAdd that folder to your user PATH (System settings, Environment variables), then open a new terminal and run "opencrease --help".`,
      });
      return;
    }
    const userLink = join(homedir(), ".local", "bin", "opencrease");
    const systemLink = "/usr/local/bin/opencrease";
    const done = async (link: string) => {
      const dir = join(link, "..");
      const hint = onPath(dir, process.env.PATH) || link === systemLink ? "" : `\n\n${dir} may not be on your PATH yet. Add it in your shell profile.`;
      await show({ type: "info", message: "Command line tool installed", detail: `opencrease is linked at ${link}.\nOpen a new terminal and run "opencrease --help". Agents can use "opencrease mcp".${hint}` });
    };
    const confirmReplace = async (link: string) => {
      if ((await linkState(link, launcher!)) !== "other") return true;
      const r = await show({ type: "question", message: `Replace ${link}?`, detail: "Another opencrease command is installed there, for example from npm.", buttons: ["Replace", "Cancel"], defaultId: 1, cancelId: 1 });
      return r.response === 0;
    };
    const toUser = async () => {
      if (!(await confirmReplace(userLink))) return;
      await linkUserCli(launcher!, userLink);
      await done(userLink);
    };
    try {
      if (!isMac) return await toUser();
      if ((await linkState(systemLink, launcher)) === "ours") return await done(systemLink);
      const r = await show({
        type: "question",
        message: "Install the opencrease command",
        detail: `Links opencrease into /usr/local/bin so terminals and agents can run "opencrease mcp". macOS asks for an administrator password.\n\nYou can also install it for your account only, in ~/.local/bin.`,
        buttons: ["Install", "Install in ~/.local/bin", "Cancel"],
        defaultId: 0,
        cancelId: 2,
      });
      if (r.response === 2) return;
      if (r.response === 1) return await toUser();
      if (!(await confirmReplace(systemLink))) return;
      const writable = await access("/usr/local/bin", constants.W_OK).then(
        () => true,
        () => false,
      );
      if (writable) await linkUserCli(launcher, systemLink);
      else await linkWithAdminPrompt(launcher, systemLink);
      await done(systemLink);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "cancelled") return;
      await show({ type: "error", message: "Could not install the command line tool", detail: (err as Error).message });
    }
  };

  // ---------------------------------------------------------------- IPC
  handle("opencrease:open-folder", (e) => openFolder(BrowserWindow.fromWebContents(e.sender)));
  handle("opencrease:system-fonts", () => listSystemFonts());
  handle("opencrease:agent-config-preview", (_e, client) => {
    if (!isAgentClient(client)) throw new Error("Unknown agent");
    return agentConfig.preview(client);
  });
  handle("opencrease:agent-config-apply", (_e, planId) => {
    if (typeof planId !== "string" || planId.length > 64) throw new Error("Bad plan");
    return agentConfig.apply(planId);
  });
  handle("opencrease:is-fullscreen", (e) => BrowserWindow.fromWebContents(e.sender)?.isFullScreen() ?? false);

  // ---------------------------------------------------------------- menu, updates, windows
  let updater: Updater | null = null;
  const setMenu = () =>
    Menu.setApplicationMenu(
      buildMenu({
        send: (command) => {
          const win = targetWindow();
          if (win) win.webContents.send("opencrease:menu", command);
          else if (command === "new-file" || command === "home") createWindow();
        },
        newWindow: () => createWindow(),
        openFolder: () => void openFolder(targetWindow()),
        installCli: () => void installCli(),
        checkForUpdates: updater ? () => updater!.check(true) : null,
        isDev,
      }),
    );
  setMenu();
  void setupUpdater(desktopTest ? null : updateFeed(settings.updateFeedUrl)).then((u) => {
    updater = u;
    if (u) setMenu();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on("window-all-closed", () => {
    // macOS apps stay running (agents can still reach the server); elsewhere closing the last window quits.
    if (!isMac) app.quit();
  });
  let quitting = false;
  app.on("before-quit", (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    void host.stop().finally(() => app.quit());
    setTimeout(() => app.exit(0), 3000).unref();
  });

  ready = true;
  const first = deepLinkFromArgv(process.argv);
  if (first) pending.unshift(first);
  if (pending.length) pending.splice(0).forEach(openPath);
  else if (!background) createWindow();
}
