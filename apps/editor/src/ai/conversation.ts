// Conversation state survives panel switches; persisted history is owned by the local server.
import { useEffect, useSyncExternalStore } from "react";
import type { AgentMessageRequest, AgentTurn } from "@opencrease/protocol";
import { aiApi } from "./api";
import { applyAgentEvent, readAgentStream } from "./agent-stream";

interface ConversationState {
  turns: AgentTurn[];
  running: boolean;
  loading: boolean;
  loaded: boolean;
  error: string | null;
}
const EMPTY: ConversationState = { turns: [], running: false, loading: false, loaded: false, error: null };
const states = new Map<string, ConversationState>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
const get = (id: string) => states.get(id) ?? EMPTY;
function update(id: string, patch: Partial<ConversationState>) {
  states.set(id, { ...get(id), ...patch });
  for (const listener of listeners) listener();
}

export async function loadConversation(fileId: string): Promise<void> {
  if (get(fileId).loading || controllers.has(fileId)) return;
  update(fileId, { loading: true });
  try {
    const view = await aiApi.conversation(fileId);
    if (!controllers.has(fileId)) update(fileId, { turns: view.turns, running: view.running, loaded: true, error: null });
  } catch (e) {
    update(fileId, { error: e instanceof Error ? e.message : String(e), loaded: true });
  } finally {
    update(fileId, { loading: false });
  }
}

export function useConversation(fileId: string): ConversationState {
  const state = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => get(fileId));
  useEffect(() => { if (!get(fileId).loaded) void loadConversation(fileId); }, [fileId]);
  // A run started in another tab, or recovered after refresh, has no local stream to subscribe to.
  useEffect(() => {
    if (!state.running || controllers.has(fileId)) return;
    const timer = setInterval(() => void loadConversation(fileId), 1200);
    return () => clearInterval(timer);
  }, [fileId, state.running]);
  return state;
}

export async function sendAgentMessage(fileId: string, request: AgentMessageRequest): Promise<boolean> {
  if (get(fileId).running) return false;
  const controller = new AbortController();
  controllers.set(fileId, controller);
  update(fileId, { running: true, error: null });
  let accepted = false;
  let finished = false;
  try {
    const response = await fetch(`/api/ai/agent/${encodeURIComponent(fileId)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json() as { error?: string };
      throw new Error(body.error ?? `The agent answered ${response.status}.`);
    }
    if (!response.body) throw new Error("The agent response has no stream.");
    accepted = true;
    await readAgentStream(response.body, (event) => {
      if (event.type === "done" || event.type === "error") finished = true;
      update(fileId, { turns: applyAgentEvent(get(fileId).turns, event), ...(event.type === "error" ? { error: event.message } : {}) });
    });
    if (!finished) throw new Error("The agent connection closed before the reply finished. Send another message to continue.");
  } catch (e) {
    if (!controller.signal.aborted) update(fileId, { error: e instanceof Error ? e.message : String(e) });
  } finally {
    controllers.delete(fileId);
    update(fileId, { running: false });
    // Reconcile stopped turns and any final persisted server state.
    if (accepted) {
      const error = get(fileId).error;
      await loadConversation(fileId);
      if (error) update(fileId, { error });
    }
  }
  return accepted;
}

export async function stopAgent(fileId: string): Promise<void> {
  try { await aiApi.stopAgent(fileId); }
  catch (e) { update(fileId, { error: e instanceof Error ? e.message : String(e) }); }
  controllers.get(fileId)?.abort();
  await loadConversation(fileId);
}

export async function clearConversation(fileId: string): Promise<void> {
  try {
    await aiApi.clearConversation(fileId);
    update(fileId, { turns: [], error: null });
  } catch (e) { update(fileId, { error: e instanceof Error ? e.message : String(e) }); }
}
