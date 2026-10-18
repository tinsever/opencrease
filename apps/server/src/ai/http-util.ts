// Small helpers for provider HTTP calls: JSON requests with readable errors, image downloads, MIME sniffing.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Pull a human message out of a provider error body (OpenAI, Anthropic, Google, Replicate, fal shapes). */
export function errorText(body: string): string {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const e = j.error as Record<string, unknown> | string | undefined;
    if (typeof e === "string") return e;
    if (e && typeof e.message === "string") return e.message;
    if (typeof j.detail === "string") return j.detail;
    if (Array.isArray(j.detail) && j.detail[0] && typeof (j.detail[0] as Record<string, unknown>).msg === "string") return String((j.detail[0] as Record<string, unknown>).msg);
    if (typeof j.message === "string") return j.message;
    if (typeof j.title === "string") return j.title;
  } catch {
    // not JSON
  }
  return body.replace(/\s+/g, " ").trim().slice(0, 300);
}

export async function checkResponse(res: Response, who: string): Promise<void> {
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  const msg = errorText(text);
  const hint = res.status === 401 || res.status === 403 ? " Check the API key in Settings, AI providers." : "";
  throw new ProviderError(`${who} answered ${res.status}${msg ? `: ${msg}` : ""}.${hint}`, res.status);
}

export async function requestJson<T = Record<string, unknown>>(
  fetchImpl: FetchLike,
  who: string,
  url: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      ...rest,
      headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(headers as Record<string, string> | undefined) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError" || (err as Error).name === "TimeoutError") throw err;
    throw new ProviderError(`Could not reach ${who} at ${new URL(url).origin}: ${(err as Error).message}`);
  }
  await checkResponse(res, who);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError(`${who} sent a response that is not JSON.`);
  }
}

export function sniffMime(data: Uint8Array, fallback = "image/png"): string {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8) return "image/jpeg";
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 && data[8] === 0x57 && data[9] === 0x45) return "image/webp";
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "image/gif";
  return fallback;
}

export interface ImageBytes {
  data: Buffer;
  mime: string;
}

export function fromBase64(b64: string, mime?: string): ImageBytes {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(b64);
  if (m) {
    const data = m[2] ? Buffer.from(m[3]!, "base64") : Buffer.from(decodeURIComponent(m[3]!), "utf8");
    return { data, mime: sniffMime(data, m[1]) };
  }
  const data = Buffer.from(b64, "base64");
  return { data, mime: sniffMime(data, mime) };
}

/** Download a generated image (http(s) or data: URL). */
export async function downloadImage(fetchImpl: FetchLike, who: string, url: string, headers?: Record<string, string>): Promise<ImageBytes> {
  if (url.startsWith("data:")) return fromBase64(url);
  let res: Response;
  try {
    res = await fetchImpl(url, headers ? { headers } : undefined);
  } catch (err) {
    throw new ProviderError(`Could not download the image from ${who}: ${(err as Error).message}`);
  }
  await checkResponse(res, who);
  const data = Buffer.from(await res.arrayBuffer());
  return { data, mime: sniffMime(data, (res.headers.get("content-type") ?? "image/png").split(";")[0]) };
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}
