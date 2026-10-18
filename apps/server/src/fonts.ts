// Google Fonts proxy with an offline cache under ~/.opencrease/fonts:
//   GET /api/fonts/css2?...   and /api/fonts/css?...   stylesheet (font URLs rewritten to the proxy)
//   GET /api/fonts/files/<path>                          font file from fonts.gstatic.com
//   GET /api/fonts/families                              compact family list with variable axes
// Stylesheets and the family list are refreshed after a week; when the network is down the cached copy
// is served, so fonts used before keep working offline. Font files never change and are kept forever.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const CSS_HOST = "https://fonts.googleapis.com";
const FILE_HOST = "https://fonts.gstatic.com";
const METADATA_URL = "https://fonts.google.com/metadata/fonts";
const WEEK = 7 * 24 * 3600 * 1000;
/** A current Chrome user agent, so Google serves woff2 with unicode-range subsets. */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const FONT_MIME: Record<string, string> = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" };

export interface FontFamilyInfo {
  family: string;
  category: string;
  /** "400", "700i", ... */
  styles: string[];
  axes: Array<{ tag: string; min: number; max: number; defaultValue: number }>;
  popularity: number;
}

type Fetch = typeof fetch;

export class FontCache {
  constructor(
    readonly dir: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async write(path: string, data: Buffer | string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, path);
  }

  private async cached(path: string): Promise<{ data: Buffer; age: number } | null> {
    try {
      const [data, info] = await Promise.all([readFile(path), stat(path)]);
      return { data, age: Date.now() - info.mtimeMs };
    } catch {
      return null;
    }
  }

  /** Stylesheet for a css2 (or css v1) query, with gstatic URLs pointing at the proxy. */
  async stylesheet(api: "css" | "css2", query: string): Promise<{ css: string; offline: boolean } | null> {
    const key = createHash("sha1").update(`${api}?${query}`).digest("hex");
    const path = join(this.dir, "css", `${key}.css`);
    const hit = await this.cached(path);
    if (hit && hit.age < WEEK) return { css: hit.data.toString("utf8"), offline: false };
    try {
      const res = await this.fetchImpl(`${CSS_HOST}/${api}?${query}`, { headers: { "user-agent": UA } });
      if (!res.ok) {
        if (res.status === 400 || res.status === 404) return null;
        throw new Error(`HTTP ${res.status}`);
      }
      const css = (await res.text()).replaceAll(`${FILE_HOST}/`, "/api/fonts/files/");
      await this.write(path, css);
      return { css, offline: false };
    } catch {
      return hit ? { css: hit.data.toString("utf8"), offline: true } : null;
    }
  }

  /**
   * A font file, from the cache or fetched once from gstatic. Subset files (`/l/font?kit=...`, used for
   * `text=` requests) carry a query; it is part of the cache key.
   */
  async file(rel: string, query = ""): Promise<Buffer | null> {
    const clean = normalize(rel).replace(/^([/\\])+/, "");
    if (!clean || clean.startsWith("..") || clean.includes(`${sep}..${sep}`)) return null;
    const q = query.replace(/^\?/, "");
    const path = join(this.dir, "files", q ? join(clean, createHash("sha1").update(q).digest("hex")) : clean);
    const hit = await this.cached(path);
    if (hit) return hit.data;
    try {
      const res = await this.fetchImpl(`${FILE_HOST}/${rel.split("/").map(encodeURIComponent).join("/")}${q ? `?${q}` : ""}`, { headers: { "user-agent": UA } });
      if (!res.ok) return null;
      const data = Buffer.from(await res.arrayBuffer());
      await this.write(path, data);
      return data;
    } catch {
      return null;
    }
  }

  /** Every Google family with styles and variable axes (about 2 MB upstream, ~300 KB here). */
  async families(): Promise<FontFamilyInfo[] | null> {
    const path = join(this.dir, "families.json");
    const hit = await this.cached(path);
    if (hit && hit.age < WEEK) return JSON.parse(hit.data.toString("utf8")) as FontFamilyInfo[];
    try {
      const res = await this.fetchImpl(METADATA_URL, { headers: { "user-agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = compactMetadata(JSON.parse((await res.text()).replace(/^\)\]\}'\s*/, "")));
      await this.write(path, JSON.stringify(list));
      return list;
    } catch {
      return hit ? (JSON.parse(hit.data.toString("utf8")) as FontFamilyInfo[]) : null;
    }
  }
}

/** Reduces fonts.google.com metadata to what the editor needs. */
export function compactMetadata(raw: unknown): FontFamilyInfo[] {
  const list = (raw as { familyMetadataList?: unknown[] })?.familyMetadataList;
  if (!Array.isArray(list)) return [];
  const out: FontFamilyInfo[] = [];
  for (const item of list) {
    const f = item as Record<string, unknown>;
    if (typeof f.family !== "string") continue;
    const axes = Array.isArray(f.axes)
      ? (f.axes as Array<Record<string, unknown>>)
          .filter((a) => typeof a.tag === "string" && typeof a.min === "number" && typeof a.max === "number")
          .map((a) => ({ tag: a.tag as string, min: a.min as number, max: a.max as number, defaultValue: typeof a.defaultValue === "number" ? a.defaultValue : (a.min as number) }))
      : [];
    out.push({
      family: f.family,
      category: typeof f.category === "string" ? f.category : "",
      styles: f.fonts && typeof f.fonts === "object" ? Object.keys(f.fonts as object) : ["400"],
      axes,
      popularity: typeof f.popularity === "number" ? f.popularity : 0,
    });
  }
  return out;
}

/** Handles /api/fonts/*. Returns false when the path is not a font route. */
export async function handleFontRoute(cache: FontCache, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/api/fonts/")) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "content-type": "application/json" }).end(JSON.stringify({ error: "Method not allowed" }));
    return true;
  }
  const send = (status: number, type: string, body: Buffer | string, cache = "no-cache", extra: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": type, "cache-control": cache, ...extra });
    res.end(req.method === "HEAD" ? undefined : body);
  };
  if (path === "/api/fonts/css2" || path === "/api/fonts/css") {
    const sheet = await cache.stylesheet(path.endsWith("css2") ? "css2" : "css", url.search.slice(1));
    if (!sheet) return send(404, "text/css; charset=utf-8", "/* font not available (offline or unknown family) */\n"), true;
    send(200, "text/css; charset=utf-8", sheet.css, "max-age=3600", sheet.offline ? { "x-opencrease-offline": "1" } : {});
    return true;
  }
  if (path.startsWith("/api/fonts/files/")) {
    let rel: string;
    try {
      rel = decodeURIComponent(path.slice("/api/fonts/files/".length));
    } catch {
      return send(400, "text/plain", "bad path"), true;
    }
    const data = await cache.file(rel, url.search);
    if (!data) return send(404, "text/plain", "font file not available"), true;
    const ext = rel.split(".").pop()?.toLowerCase() ?? "";
    send(200, FONT_MIME[ext] ?? (url.search ? "font/woff2" : "application/octet-stream"), data, "public, max-age=31536000, immutable");
    return true;
  }
  if (path === "/api/fonts/families") {
    const list = await cache.families();
    if (!list) return send(503, "application/json", JSON.stringify({ error: "Google Fonts metadata is not available offline yet." })), true;
    send(200, "application/json", JSON.stringify(list), "max-age=3600");
    return true;
  }
  send(404, "application/json", JSON.stringify({ error: "Not found" }));
  return true;
}
