import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "0.1.0";
export const DEFAULT_PORT = 29880;
export const HOST = "127.0.0.1";

export function defaultWorkspaceDir(): string {
  return process.env.OPENCREASE_WORKSPACE || join(homedir(), "Documents", "OpenCrease");
}

/** Per-user config directory (~/.opencrease), overridable with OPENCREASE_HOME. */
export function userConfigDir(): string {
  return process.env.OPENCREASE_HOME || join(homedir(), ".opencrease");
}

// The env overrides are for bundled builds (the desktop app ships the CLI as one file next to the
// editor build and the guides), where these paths are not relative to the source tree.
export const SERVER_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const BUILTIN_GUIDES_DIR = process.env.OPENCREASE_GUIDES_DIR || fileURLToPath(new URL("../guides", import.meta.url));
export const EDITOR_DIST_DIR = process.env.OPENCREASE_EDITOR_DIST || fileURLToPath(new URL("../../editor/dist", import.meta.url));
export const BIN_PATH = process.env.OPENCREASE_CLI_ENTRY || fileURLToPath(new URL("../bin/opencrease.mjs", import.meta.url));
