// REST client for /api/ai and a small cached store of the AI settings (providers and defaults).
// The browser never sees API keys: only "…abcd" hints come back from the server.
import { useEffect, useSyncExternalStore } from "react";
import {
  providerKindInfo,
  type AgentConversationView, type AiCapability, type AiImageRequest, type AiImageResult, type AiProviderInput, type AiProviderView,
  type AiSettingsView, type AiSvgRequest, type AiSvgResult,
} from "@opencrease/protocol";

export class AiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json), headers: { "content-type": "application/json", ...(rest.headers ?? {}) } } : {}),
  });
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | undefined)?.error ?? (text.slice(0, 200) || `${res.status} ${res.statusText}`);
    throw new AiApiError(msg, res.status);
  }
  return body as T;
}

export const aiApi = {
  settings: () => call<AiSettingsView>("/api/ai"),
  createProvider: (input: AiProviderInput) => call<AiProviderView>("/api/ai/providers", { method: "POST", json: input }),
  updateProvider: (id: string, input: AiProviderInput) => call<AiProviderView>(`/api/ai/providers/${encodeURIComponent(id)}`, { method: "PATCH", json: input }),
  deleteProvider: (id: string) => call<{ ok: boolean }>(`/api/ai/providers/${encodeURIComponent(id)}`, { method: "DELETE" }),
  testProvider: (id: string) => call<{ ok: boolean; message: string; models?: string[] }>(`/api/ai/providers/${encodeURIComponent(id)}/test`, { method: "POST" }),
  setDefaults: (d: { image?: string | null; chat?: string | null }) => call<AiSettingsView["defaults"]>("/api/ai/defaults", { method: "PUT", json: d }),
  image: (req: AiImageRequest, signal?: AbortSignal) => call<AiImageResult>("/api/ai/image", { method: "POST", json: req, signal }),
  svg: (req: AiSvgRequest, signal?: AbortSignal) => call<AiSvgResult>("/api/ai/svg", { method: "POST", json: req, signal }),
  conversation: (fileId: string) => call<AgentConversationView>(`/api/ai/agent/${encodeURIComponent(fileId)}`),
  clearConversation: (fileId: string) => call<{ ok: boolean }>(`/api/ai/agent/${encodeURIComponent(fileId)}`, { method: "DELETE" }),
  stopAgent: (fileId: string) => call<{ stopped: boolean }>(`/api/ai/agent/${encodeURIComponent(fileId)}/stop`, { method: "POST" }),
};

// ------------------------------------------------------------------------------------- settings store

interface SettingsState {
  settings: AiSettingsView | null;
  error: string | null;
  loading: boolean;
}

let state: SettingsState = { settings: null, error: null, loading: false };
const listeners = new Set<() => void>();
let inflight: Promise<AiSettingsView | null> | null = null;

function set(next: Partial<SettingsState>) {
  state = { ...state, ...next };
  for (const l of [...listeners]) l();
}

export function getAiSettings(): AiSettingsView | null {
  return state.settings;
}

/** Load (or reload) the settings from the server. */
export function refreshAiSettings(): Promise<AiSettingsView | null> {
  if (inflight) return inflight;
  set({ loading: true });
  inflight = aiApi
    .settings()
    .then((s) => {
      set({ settings: s, error: null, loading: false });
      return s;
    })
    .catch((e: unknown) => {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function ensureAiSettings(): Promise<AiSettingsView | null> {
  return state.settings ? Promise.resolve(state.settings) : refreshAiSettings();
}

export function useAiSettings(): SettingsState {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
  useEffect(() => {
    if (!state.settings && !state.loading && !state.error) void refreshAiSettings();
  }, []);
  return s;
}

export function capable(p: AiProviderView, cap: AiCapability): boolean {
  return providerKindInfo(p.kind)?.capabilities.includes(cap) ?? false;
}

/** The provider used for a capability: the default, else the first capable one. Mirrors the server. */
export function defaultProvider(s: AiSettingsView | null, cap: AiCapability): AiProviderView | undefined {
  if (!s) return undefined;
  const id = s.defaults[cap];
  return s.providers.find((p) => p.id === id && capable(p, cap)) ?? s.providers.find((p) => capable(p, cap));
}

export function openAiSettings(): void {
  window.dispatchEvent(new CustomEvent("opencrease:settings", { detail: { page: "ai" } }));
}
