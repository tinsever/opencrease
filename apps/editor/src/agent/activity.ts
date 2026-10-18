// Agent activity log: one entry per tool call, per file. Feeds the right panel's Agent tab.
import { useSyncExternalStore } from "react";

export interface AgentLogEntry {
  id: number;
  fileId: string;
  /** MCP client name, e.g. "claude-code" */
  client: string;
  /** tool name, e.g. "write_html" */
  tool: string;
  /** short human label, e.g. "Writing into \"Hero\"" */
  label: string;
  /** ms since epoch when the call started */
  time: number;
  durationMs: number;
  ok: boolean;
  /** error message when ok is false */
  error?: string;
  /** true for tools that changed the document */
  write: boolean;
}

export const LOG_LIMIT = 200;
const EMPTY: AgentLogEntry[] = [];

let nextId = 1;
const logs = new Map<string, AgentLogEntry[]>();
const listeners = new Set<() => void>();

export function logAgentCall(entry: Omit<AgentLogEntry, "id">): AgentLogEntry {
  const full: AgentLogEntry = { ...entry, id: nextId++ };
  const prev = logs.get(entry.fileId) ?? EMPTY;
  const next = prev.length >= LOG_LIMIT ? [...prev.slice(prev.length - LOG_LIMIT + 1), full] : [...prev, full];
  logs.set(entry.fileId, next);
  for (const l of [...listeners]) l();
  return full;
}

/** Entries for a file, oldest first. The array identity changes only when the log changes. */
export function getAgentLog(fileId: string): AgentLogEntry[] {
  return logs.get(fileId) ?? EMPTY;
}

export function subscribeAgentLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearAgentLog(fileId: string): void {
  if (!logs.has(fileId)) return;
  logs.delete(fileId);
  for (const l of [...listeners]) l();
}

/** React hook: the agent activity log of a file, oldest first. */
export function useAgentLog(fileId: string | null | undefined): AgentLogEntry[] {
  return useSyncExternalStore(subscribeAgentLog, () => (fileId ? getAgentLog(fileId) : EMPTY));
}
