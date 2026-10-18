// The `opencrease` command line tool of the desktop app.
//
// On every start the app writes a small launcher script into its user data folder. The launcher runs
// the bundled CLI with the app's own Electron binary in Node mode (ELECTRON_RUN_AS_NODE), so no
// separate Node.js install is needed. "Install command line tool" links that launcher into a folder
// on PATH. Because the launcher is rewritten on start, the link keeps working when the app moves.
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, readlink, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface LauncherSpec {
  /** Electron binary that runs the CLI in Node mode */
  exec: string;
  /** bundled CLI entry (cli.mjs) */
  cliEntry: string;
  /** how `opencrease mcp` starts the desktop app when it is not running */
  appLaunch: string[];
  editorDist: string;
  guidesDir: string;
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function cmdQuote(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

export function posixLauncher(spec: LauncherSpec): string {
  return [
    "#!/bin/sh",
    "# OpenCrease command line tool. The OpenCrease app rewrites this file on every start.",
    "ELECTRON_RUN_AS_NODE=1 \\",
    `OPENCREASE_DESKTOP_LAUNCH=${shQuote(JSON.stringify(spec.appLaunch))} \\`,
    `OPENCREASE_EDITOR_DIST=${shQuote(spec.editorDist)} \\`,
    `OPENCREASE_GUIDES_DIR=${shQuote(spec.guidesDir)} \\`,
    `OPENCREASE_CLI_ENTRY=${shQuote(spec.cliEntry)} \\`,
    `exec ${shQuote(spec.exec)} ${shQuote(spec.cliEntry)} "$@"`,
    "",
  ].join("\n");
}

export function windowsLauncher(spec: LauncherSpec): string {
  return [
    "@echo off",
    "rem OpenCrease command line tool. The OpenCrease app rewrites this file on every start.",
    "setlocal",
    "set ELECTRON_RUN_AS_NODE=1",
    `set "OPENCREASE_DESKTOP_LAUNCH=${JSON.stringify(spec.appLaunch).replace(/%/g, "%%")}"`,
    `set "OPENCREASE_EDITOR_DIST=${spec.editorDist}"`,
    `set "OPENCREASE_GUIDES_DIR=${spec.guidesDir}"`,
    `set "OPENCREASE_CLI_ENTRY=${spec.cliEntry}"`,
    `${cmdQuote(spec.exec)} ${cmdQuote(spec.cliEntry)} %*`,
    "",
  ].join("\r\n");
}

export function launcherName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "opencrease.cmd" : "opencrease";
}

/** Write the launcher into `dir` (atomically) and return its path. */
export async function writeLauncher(dir: string, spec: LauncherSpec, platform: NodeJS.Platform = process.platform): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, launcherName(platform));
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, platform === "win32" ? windowsLauncher(spec) : posixLauncher(spec), { mode: 0o755 });
  await chmod(tmp, 0o755);
  await rename(tmp, path);
  return path;
}

export type LinkState = "missing" | "ours" | "other";

/** What is at `linkPath` now: nothing, a link to our launcher, or something else (another opencrease install). */
export async function linkState(linkPath: string, launcher: string): Promise<LinkState> {
  try {
    const st = await lstat(linkPath);
    if (!st.isSymbolicLink()) return "other";
    return (await readlink(linkPath)) === launcher ? "ours" : "other";
  } catch {
    return "missing";
  }
}

/** Link `launcher` at `linkPath` without admin rights (e.g. ~/.local/bin/opencrease). Replaces what is there. */
export async function linkUserCli(launcher: string, linkPath: string): Promise<void> {
  await mkdir(dirname(linkPath), { recursive: true });
  const tmp = `${linkPath}.${process.pid}.tmp`;
  await unlink(tmp).catch(() => {});
  await symlink(launcher, tmp);
  await rename(tmp, linkPath);
}

/** The shell command run with administrator rights to link into a system folder. */
export function adminLinkCommand(launcher: string, linkPath: string): string {
  return `/bin/mkdir -p ${shQuote(dirname(linkPath))} && /bin/ln -sfn ${shQuote(launcher)} ${shQuote(linkPath)}`;
}

/** AppleScript that asks for an administrator password, then links the launcher. */
export function adminAppleScript(launcher: string, linkPath: string): string {
  const cmd = adminLinkCommand(launcher, linkPath).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `do shell script "${cmd}" with administrator privileges`;
}

/** macOS: link with an admin prompt. Rejects with code "cancelled" when the user cancels the prompt. */
export function linkWithAdminPrompt(launcher: string, linkPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/osascript", ["-e", adminAppleScript(launcher, linkPath)], (err, _out, stderr) => {
      if (!err) return resolve();
      const e = new Error(/-128|cancel/i.test(String(stderr)) ? "cancelled" : String(stderr || err.message).trim());
      (e as NodeJS.ErrnoException).code = /-128|cancel/i.test(String(stderr)) ? "cancelled" : "failed";
      reject(e);
    });
  });
}

/** True when `dir` is listed in a PATH string. */
export function onPath(dir: string, pathEnv: string | undefined, platform: NodeJS.Platform = process.platform): boolean {
  const sep = platform === "win32" ? ";" : ":";
  const norm = (p: string) => p.replace(/[\\/]+$/, "");
  return (pathEnv ?? "").split(sep).some((p) => p && norm(p) === norm(dir));
}
