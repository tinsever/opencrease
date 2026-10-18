// Background script (Chrome service worker, Firefox event page). Injects the content script, downloads
// images for inlining (host permissions make this independent of the page's CORS rules) and delivers
// snapshots to the local OpenCrease server.
import { loadSettings, type DeliverResult, type StatusMessage, type ToBackground, type ToContent } from "./shared/messages";
import { postSnapshot, type SnapshotRequest } from "./shared/server";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

function guessMime(url: string): string {
  const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
  const map: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml" };
  return (ext && map[ext]) || "image/png";
}

async function fetchImage(url: string): Promise<string | null> {
  try {
    if (!/^(https?|blob):/i.test(url)) return null;
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_BYTES) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const mime = type.startsWith("image/") ? type : guessMime(url);
    return `data:${mime};base64,${toBase64(buf)}`;
  } catch {
    return null;
  }
}

async function fetchImages(urls: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  const queue = [...urls];
  const workers = Array.from({ length: 6 }, async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) out[url] = await fetchImage(url);
  });
  await Promise.all(workers);
  return out;
}

function broadcast(msg: StatusMessage): void {
  chrome.runtime.sendMessage(msg).catch(() => undefined);
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "state" } satisfies ToContent);
    return;
  } catch {
    // not injected yet
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

async function deliver(msg: Extract<ToBackground, { type: "deliver" }>): Promise<DeliverResult> {
  const { payload, settings } = msg;
  const d = settings.destination;
  const target: SnapshotRequest["target"] =
    d === "new" ? { kind: "new", name: payload.name } : d.startsWith("file:") ? { kind: "file", fileId: d.slice(5) } : { kind: "active" };
  broadcast({ type: "status", phase: "sending", text: "Sending to OpenCrease" });
  try {
    const token = (await loadSettings()).token;
    const res = await postSnapshot(settings.port, { html: payload.html, name: payload.name, url: payload.url, target, colorTokens: settings.colorTokens }, token);
    const where = res.delivered === "editor" ? `Added to ${res.fileName}` : `Saved to ${res.fileName}. Open it in OpenCrease to see it.`;
    const message = `${where}. ${res.layers} layers.`;
    broadcast({ type: "status", phase: "done", text: message });
    return { ok: true, message, fileName: res.fileName, url: res.url };
  } catch (err) {
    const reason = err instanceof TypeError ? `OpenCrease is not running on port ${settings.port}.` : (err as Error).message;
    broadcast({ type: "status", phase: "error", text: reason });
    return { ok: false, message: reason };
  }
}

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const msg = raw as ToBackground;
  if (msg.type === "fetch-images") {
    fetchImages(msg.urls).then(sendResponse, () => sendResponse({}));
    return true;
  }
  if (msg.type === "deliver") {
    deliver(msg).then(sendResponse);
    return true;
  }
  if (msg.type === "capture") {
    (async () => {
      const { token: _token, ...settings } = await loadSettings();
      await ensureContentScript(msg.tabId);
      await chrome.tabs.sendMessage(msg.tabId, { type: "start", mode: msg.mode, settings } satisfies ToContent);
      return { ok: true };
    })().then(sendResponse, (err: Error) => sendResponse({ ok: false, message: err.message || "This page cannot be captured." }));
    return true;
  }
  return false;
});
