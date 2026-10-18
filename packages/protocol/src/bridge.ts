// Messages exchanged over the WebSocket at /bridge between the editor tab and the server.
import type { CallPolicy } from "./quality";
import type { ToolResult } from "./results";

export interface OpenFileInfo {
  id: string;
  name: string;
  activePageId: string;
}

/** From the MCP initialize clientInfo ("claude-code", "codex", "cursor", ...). */
export interface AgentClientInfo {
  name: string;
  version?: string;
}

export type EditorToServer =
  | { type: "hello"; editorId: string; version: string; openFiles: OpenFileInfo[]; activeFileId: string | null }
  | { type: "state"; openFiles: OpenFileInfo[]; activeFileId: string | null }
  | { type: "result"; callId: string; result: ToolResult }
  /** the user's answer to a permission-request */
  | { type: "permission-response"; requestId: string; allow: boolean };

export type ServerToEditor =
  | { type: "call"; callId: string; tool: string; args: Record<string, unknown>; client: AgentClientInfo; policy?: CallPolicy }
  /** ask the user whether an agent client may use OpenCrease (first connection per client) */
  | { type: "permission-request"; requestId: string; client: AgentClientInfo }
  | { type: "open-file"; fileId: string; pageId?: string }
  | { type: "file-changed-on-disk"; fileId: string }
  | { type: "import-html"; callId: string; request: ImportHtmlRequest };

/**
 * Import of external HTML (Snapshot browser extension) into a file open in the editor. The editor answers
 * with a "result" message whose first text block is JSON `{ nodeId, name, layers }`.
 */
export interface ImportHtmlRequest {
  fileId: string;
  /** OpenCrease HTML for one artboard. Images already point at the file's assets. */
  html: string;
  name: string;
  /** Turn repeated colours into colour tokens. */
  colorTokens?: boolean;
}

export const BRIDGE_PATH = "/bridge";
