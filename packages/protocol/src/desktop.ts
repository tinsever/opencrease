// The preload bridge the desktop app (apps/desktop) exposes to the editor as `window.opencreaseDesktop`.
// It is absent in a normal browser tab; the editor must feature-detect it.

export type DesktopPlatform = "darwin" | "win32" | "linux";

/** MCP clients the desktop app can configure automatically. */
export type AgentClientId = "claude-code" | "codex" | "cursor" | "vscode" | "zed" | "opencode";

/** What "Add automatically" would change in one agent's config file. Nothing is written yet. */
export interface AgentConfigPreview {
  client: AgentClientId;
  /** absolute path of the config file */
  path: string;
  /** the file does not exist yet and will be created */
  creates: boolean;
  /** the file already contains exactly this OpenCrease entry */
  upToDate: boolean;
  /** where the current file is copied before it is changed (null when it is created) */
  backupPath: string | null;
  /** changed region with up to 3 lines of context */
  diff: AgentConfigDiffLine[];
  /** opaque id to pass to apply(); stale when the file changes in between */
  planId: string;
  /** what the agent needs afterwards, e.g. "Restart Cursor to load it." */
  note: string;
}

export interface AgentConfigDiffLine {
  kind: "context" | "add" | "remove" | "skip";
  text: string;
}

export type AgentConfigApplyResult =
  | { status: "written"; path: string; backupPath: string | null }
  /** the file changed since the preview; show the new preview and ask again */
  | { status: "changed"; preview: AgentConfigPreview }
  | { status: "error"; message: string };

export interface DesktopBridge {
  version: string;
  platform: DesktopPlatform;
  /** Pick another workspace folder. Resolves to the new folder, or null when cancelled. Windows reload afterwards. */
  openFolder(): Promise<string | null>;
  /** Font families installed on this computer, sorted. Empty when they cannot be listed. */
  listSystemFonts(): Promise<string[]>;
  previewAgentConfig(client: AgentClientId): Promise<AgentConfigPreview>;
  applyAgentConfig(planId: string): Promise<AgentConfigApplyResult>;
  /** Native menu items that run editor commands (see apps/editor/src/desktop/commands.ts). */
  onMenuCommand(listener: (command: string) => void): () => void;
  /** Deep links and window requests: an editor path such as "/file/<id>/<page>". */
  onNavigate(listener: (path: string) => void): () => void;
  /** macOS full screen hides the traffic lights, so the title bar drops its inset. */
  onFullScreenChange(listener: (fullScreen: boolean) => void): () => void;
  isFullScreen(): Promise<boolean>;
}
