# Desktop app

The Electron app runs the OpenCrease server in its main process and serves the built editor on loopback. No separate Node.js installation is needed. The default workspace is `~/Documents/OpenCrease`; **Open folder…** in Files or the native File menu switches the workspace and saves the choice. Every window switches together. File tabs remain per window.

## Develop and build

```sh
pnpm install
pnpm --filter @opencrease/desktop dev
pnpm --filter @opencrease/desktop build
```

Development bundles the main process, sandboxed preload and CLI with esbuild, and starts Vite. Changes to the main process need a manual restart; the runner never relaunches Electron automatically. The server defaults to 29880, or an available port if another app owns it. An explicit `OPENCREASE_PORT` fails if occupied. `OPENCREASE_VITE_PORT` defaults to 5180. For an isolated checkout:

```sh
OPENCREASE_PORT=29908 OPENCREASE_VITE_PORT=5208 pnpm --filter @opencrease/desktop dev /tmp/of-desktop/ws
```

`build` produces installers in `apps/desktop/release` for the current platform: macOS DMG and ZIP, Windows NSIS, Linux AppImage, deb and rpm. `pnpm --filter @opencrease/desktop pack` produces an unpacked app. Run platform builds on their respective operating systems. Flatpak, Windows signing, macOS signing and notarization remain release follow-ups. The macOS build explicitly uses `identity: null` for unsigned local builds; a signed release must override that setting, configure hardened runtime and entitlements, and supply signing/notarization credentials to electron-builder. Unsigned downloads may require the operating system's manual approval to open.

## Native features

- Native File, Edit, Layer, Tools, View, Window and Help menus use the editor's commands and shortcuts. File has **New window**; the application menu has **Install command line tool…**.
- macOS uses an inset hidden title bar. The preload flag enables the traffic-light spacing only in desktop, and removes it in full screen.
- The font picker adds **On this computer** using platform font enumeration. It requires no renderer permission prompt. Enumeration failures leave the regular font list available.
- `opencrease://file/<fileId>/<pageId>` opens a file and optional page. `opencrease://home` opens Files. Links reject paths, escapes, queries, credentials and ports. Packaged apps register the scheme; development does not change the installed handler.
- A single-instance lock routes subsequent launches and links to the running app. On macOS, closing the last window leaves the local server running until Quit.

## Connect an agent

In **Connect an agent**, expand a supported client and choose **Add automatically**. OpenCrease shows the target path and exact diff. **Create file** or **Write change** confirms that preview. Cancel writes nothing. Existing configs are backed up next to the original with a timestamp and unique suffix before the atomic replacement. JSON comments, other entries and permissions are preserved. New config files use owner-only permissions. If the file changes after preview, a new preview requires another confirmation; previews expire after 15 minutes. Invalid or unsupported TOML layouts are left untouched.

Supported user configs:

| Client | Default path |
|---|---|
| Claude Code | `~/.claude.json` |
| Codex | `~/.codex/config.toml` |
| Cursor | `~/.cursor/mcp.json` |
| VS Code | macOS `~/Library/Application Support/Code/User/mcp.json`, Linux `$XDG_CONFIG_HOME/Code/User/mcp.json`, Windows `%APPDATA%/Code/User/mcp.json` |
| Zed | `~/.config/zed/settings.json`, Windows `%APPDATA%/Zed/settings.json` |
| OpenCode | `~/.config/opencode/opencode.json`, or existing `opencode.jsonc` |

`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME` and `APPDATA` overrides are respected. The MCP entry uses an absolute launcher path and the running server's port, so installing the command on PATH is optional for agents. Client formats follow their official documentation, including [Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and [Zed](https://zed.dev/docs/ai/mcp).

The CLI installer links the launcher to `~/.local/bin/opencrease`. On macOS it also offers `/usr/local/bin/opencrease`, requesting administrator privileges only when needed. It asks before replacing another command. On Windows it writes `opencrease.cmd` into the app data `bin` folder and shows the exact folder to add to user PATH. Moving the app requires launching it once to refresh the launcher.

## Updates and exports

Updates stay off unless a packaged app has an HTTPS generic feed configured through `OPENCREASE_UPDATE_URL` or `updateFeedUrl` in `settings.json`. Without a feed, no check or update menu is installed. A feed enables background checks every six hours and a manual menu command. It must host electron-builder metadata and artifacts; macOS installation also needs signed builds. No production update feed is supplied.

Canvas exports use the existing editor exporter. Native `capturePage`/`printToPDF` export integration is deferred. The packaged app does not ship a separate Playwright browser or runtime: its PDF export falls back to the editor's raster PDF, and the bundled CLI's browser-dependent headless export commands require the source CLI with Playwright installed. Normal desktop MCP calls, image exports and token export do not need it.

## Hidden verification

Never open visible windows during automated checks. `OPENCREASE_DESKTOP_TEST=1` creates every editor window with `show: false`, offscreen rendering and background throttling disabled. It blocks show/focus/restore on deep links, disables external URL opening, update dialogs and protocol registration, and hides the macOS dock icon with a prohibited activation policy. It suppresses JavaScript dialogs and native CLI installation dialogs. `OPENCREASE_DESKTOP_TEST_FOLDER` supplies a throwaway folder instead of displaying a folder picker.

The smoke script sets that flag, redirects HOME and all client config overrides to a temporary directory, and uses one app launch. It checks preload isolation, native commands, multiple hidden windows, deep links, system fonts, the config preview/confirmation/backup flow and workspace persistence. Screenshots come from `webContents.capturePage()`; it never brings a page to the front.

```sh
node apps/desktop/scripts/smoke.mjs /tmp/of-desktop-shots \
  --packaged apps/desktop/release/mac-arm64/OpenCrease.app/Contents/MacOS/OpenCrease
node apps/desktop/scripts/browser-smoke.mjs /tmp/of-desktop-shots
```

The browser check starts its own temporary workspace server on 29908 and Vite on 5208, verifies that native-only controls stay disabled or absent in headless Chromium, and closes both services.

For unit tests of config writers, also set HOME to a temporary directory:

```sh
TASK_TEST_HOME=$(mktemp -d)
HOME="$TASK_TEST_HOME" pnpm exec vitest run apps/desktop/src
rm -r "$TASK_TEST_HOME"
```

`OPENCREASE_DESKTOP_USER_DATA` overrides the app data folder for isolated runs. The normal folders are `~/Library/Application Support/OpenCrease` on macOS, `%APPDATA%/OpenCrease` on Windows and `$XDG_CONFIG_HOME/OpenCrease` on Linux; development uses `OpenCrease Dev`.
