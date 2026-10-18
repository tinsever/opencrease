// "Test connection" in Settings: one cheap, read-only request per provider kind.
import { providerKindInfo } from "@opencrease/protocol";
import { joinUrl, ProviderError, requestJson, type FetchLike } from "./http-util";
import type { StoredProvider } from "./secrets";

export interface ConnectionResult {
  ok: boolean;
  message: string;
  /** model ids the provider reports, when it lists them */
  models?: string[];
}

export async function testConnection(p: StoredProvider, fetchImpl: FetchLike = fetch): Promise<ConnectionResult> {
  const info = providerKindInfo(p.kind);
  if (!info) return { ok: false, message: "Unknown provider." };
  if (info.key === "required" && !p.apiKey) return { ok: false, message: "Add an API key first." };
  const signal = AbortSignal.timeout(15_000);
  const bearer = p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : undefined;
  try {
    switch (p.kind) {
      case "anthropic": {
        const j = await requestJson<{ data?: Array<{ id: string }> }>(fetchImpl, "Anthropic", joinUrl(p.baseUrl, "v1/models"), {
          headers: { "x-api-key": p.apiKey, "anthropic-version": "2023-06-01" },
          signal,
        });
        const models = (j.data ?? []).map((m) => m.id);
        return { ok: true, message: `Connected. ${models.length} models available.`, models };
      }
      case "openai":
      case "openai-compatible":
      case "xai": {
        const j = await requestJson<{ data?: Array<{ id: string }> }>(fetchImpl, info.label, joinUrl(p.baseUrl, "models"), { headers: bearer, signal });
        const models = (j.data ?? []).map((m) => m.id);
        return { ok: true, message: models.length ? `Connected. ${models.length} models available.` : "Connected.", models };
      }
      case "gemini": {
        const j = await requestJson<{ models?: Array<{ name: string }> }>(fetchImpl, "Google Gemini", joinUrl(p.baseUrl, "models"), { headers: { "x-goog-api-key": p.apiKey }, signal });
        const models = (j.models ?? []).map((m) => m.name.replace(/^models\//, ""));
        return { ok: true, message: "Connected.", models };
      }
      case "replicate": {
        const j = await requestJson<{ username?: string }>(fetchImpl, "Replicate", joinUrl(p.baseUrl, "account"), { headers: bearer, signal });
        return { ok: true, message: j.username ? `Connected as ${j.username}.` : "Connected." };
      }
      case "fal":
        return { ok: true, message: "Key saved. fal has no read-only check, so the key is verified on the first image." };
      case "comfyui": {
        await requestJson(fetchImpl, "ComfyUI", joinUrl(p.baseUrl, "system_stats"), { signal });
        return { ok: true, message: "ComfyUI is running." };
      }
      case "automatic1111": {
        const j = await requestJson<Array<{ title: string }>>(fetchImpl, "Automatic1111", joinUrl(p.baseUrl, "sdapi/v1/sd-models"), { signal });
        const models = Array.isArray(j) ? j.map((m) => m.title) : [];
        return { ok: true, message: `Automatic1111 is running with ${models.length} models.`, models };
      }
    }
  } catch (err) {
    if ((err as Error).name === "TimeoutError") return { ok: false, message: `${info.label} did not answer within 15 s.` };
    return { ok: false, message: err instanceof ProviderError ? err.message : (err as Error).message };
  }
  return { ok: false, message: "Unknown provider." };
}
