// A recording fetch for unit tests of provider adapters: no network, inspectable requests.
import type { FetchLike } from "../http-util";

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** parsed JSON body, the FormData, or the raw string */
  body: unknown;
}

export type MockFetch = FetchLike & { calls: RecordedCall[] };

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

export function sseResponse(text: string): Response {
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

export function bytesResponse(data: Uint8Array, mime = "image/png"): Response {
  return new Response(new Uint8Array(data), { status: 200, headers: { "content-type": mime } });
}

function headersOf(h: RequestInit["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  new Headers(h as ConstructorParameters<typeof Headers>[0]).forEach((v, k) => (out[k.toLowerCase()] = v));
  return out;
}

export function mockFetch(handler: (call: RecordedCall, index: number) => Response | Promise<Response>): MockFetch {
  const calls: RecordedCall[] = [];
  const f = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // keep the string
      }
    }
    const call: RecordedCall = { url, method: (init?.method ?? "GET").toUpperCase(), headers: headersOf(init?.headers), body };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return Object.assign(f as FetchLike, { calls });
}
