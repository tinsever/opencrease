// HTTP server: REST API, /mcp (Streamable HTTP), /bridge (WebSocket) and the editor's static files.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { watchFile, unwatchFile } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { BRIDGE_PATH, TOOLS } from "@opencrease/protocol";
import { BridgeHub } from "./bridge";
import { authorize, launchPage, loadOrCreateToken, readTokenSync, resetToken, tokenPath, removeSessionToken, writeSessionToken, safeNext, sessionCookie, TOKEN_HEADER, tokensEqual, writeLaunchFile } from "./auth";
import { DEFAULT_PORT, EDITOR_DIST_DIR, HOST, userConfigDir, VERSION } from "./config";
import { AgentApprovals } from "./agents";
import { FontCache, handleFontRoute } from "./fonts";
import { Guides } from "./guides";
import { VersionHistory, type HistoryOptions } from "./history";
import { Plugins } from "./plugins";
import { platformRoutes } from "./routes-platform";
import { McpHttpSessions } from "./mcp";
import { openBrowser as defaultOpenBrowser } from "./open-browser";
import { isExtensionOrigin, isExtensionPath, isLocalHostHeader, isLocalOrigin, isSameOrigin } from "./security";
import { createAiRoutes } from "./ai/routes";
import type { FetchLike } from "./ai/http-util";
import { Libraries } from "./libraries";
import { ChromiumUnavailable, closeRenderer, renderPdf, validatePages } from "./render";
import { importSnapshot, parseSnapshotBody, SnapshotError } from "./snapshot";
import { createToolExecutor, type CallTool } from "./tools";
import { MAX_ASSET_BYTES, Workspace, WorkspaceError, type WorkspaceOptions } from "./workspace";

const MB = 1024 * 1024;
const JSON_LIMIT = 50 * MB;
const TOOL_CALL_LIMIT = 50 * MB;
const THUMBNAIL_LIMIT = 20 * MB;
const GUIDE_LIMIT = 2 * MB;
const RENDER_LIMIT = 300 * MB;
/** exports include videos (up to 300 s) */
const EXPORT_LIMIT = 1024 * MB;
const SNAPSHOT_LIMIT = 200 * MB;

export interface StartOptions {
  workspaceDir: string;
  /** pinned files and export directory (headless mode) */
  workspaceOptions?: WorkspaceOptions;
  /** default 29880; 0 picks a free port */
  port?: number;
  host?: string;
  /** called when a tool needs an editor and none is connected */
  openBrowser?: (url: string) => void;
  editorDist?: string;
  /** where the editor UI lives when it is not served by this server, e.g. the Vite dev server (env OPENCREASE_EDITOR_URL) */
  editorBaseUrl?: string;
  /** directory holding the user guide (default ~/.opencrease) */
  userConfigDir?: string;
  builtinGuidesDir?: string;
  /** how long to wait for an editor to connect (default 15 s) */
  connectTimeoutMs?: number;
  /** fetch used for AI provider calls (tests inject a mock) */
  aiFetch?: FetchLike;
  /**
   * Require the local token on /api, /mcp and /bridge (default true). Tests turn it off; the
   * loopback Host and Origin checks apply either way.
   */
  auth?: boolean;
  /** Transport token override (default: persistent credential shared by this config directory). */
  token?: string;
  /** Ask the user in the editor before an agent client's first tool call (default true). */
  approveAgents?: boolean;
  history?: HistoryOptions;
  /** directory with built-in example plugins (default apps/server/plugins) */
  builtinPluginsDir?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  workspace: Workspace;
  bridge: BridgeHub;
  guides: Guides;
  history: VersionHistory;
  approvals: AgentApprovals;
  plugins: Plugins;
  callTool: CallTool;
  httpServer: Server;
  /** Session token clients must send (also set when auth is off). */
  token: string;
  authRequired: boolean;
  /** URL that signs a browser in and then shows `path` (for desktop shells and launchers). */
  authUrl(path?: string): string;
  /** Open the editor in the browser, signing it in when needed. */
  openEditor(path?: string): void;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const STATIC_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const NOT_BUILT_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>OpenCrease</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#111;color:#e8e8e8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
main{max-width:520px;padding:32px}h1{font-size:20px;font-weight:600}code{background:#222;padding:2px 6px;border-radius:4px;font-size:13px}</style></head>
<body><main><h1>The editor is not built yet</h1>
<p>The OpenCrease server is running, but there is no editor build to serve.</p>
<p>Run <code>pnpm build</code> in the repository and reload this page, or start the dev server with <code>pnpm dev</code> and open the URL it prints.</p>
</main></body></html>`;

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new HttpError(413, `Request body is larger than ${Math.round(limit / MB)} MB`));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (c: Buffer) => {
      if (tooLarge) return; // drain the rest so the 413 response can be delivered
      size += c.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, `Request body is larger than ${Math.round(limit / MB)} MB`));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage, limit = JSON_LIMIT): Promise<unknown> {
  const buf = await readBody(req, limit);
  if (!buf.length) return undefined;
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw new HttpError(400, "Body is not valid JSON");
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  sendJson(res, status, { error: message });
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const host = opts.host ?? HOST;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("OpenCrease must bind to loopback");
  const workspace = await Workspace.open(opts.workspaceDir, opts.workspaceOptions);
  const guidesOpts: ConstructorParameters<typeof Guides>[0] = { workspace };
  if (opts.userConfigDir) guidesOpts.userDir = opts.userConfigDir;
  if (opts.builtinGuidesDir) guidesOpts.builtinDir = opts.builtinGuidesDir;
  const guides = new Guides(guidesOpts);
  const fontCache = new FontCache(join(opts.userConfigDir ?? userConfigDir(), "fonts"));
  const libraries = new Libraries(workspace);
  const editorDist = resolve(opts.editorDist ?? EDITOR_DIST_DIR);
  const configDir = opts.userConfigDir ?? userConfigDir();
  const authRequired = opts.auth !== false;
  const override = opts.token ?? process.env.OPENCREASE_TOKEN?.trim();
  let token = override || await loadOrCreateToken(configDir);
  const currentToken = () => {
    const next = override || readTokenSync(configDir) || token;
    if (next !== token) {
      token = next;
      void sessions.close();
      bridge.disconnectClients();
    }
    return token;
  };
  const customOpen = opts.openBrowser;

  let baseUrl = "";
  const editorBase = (opts.editorBaseUrl ?? process.env.OPENCREASE_EDITOR_URL ?? "").replace(/\/$/, "");
  const editorUrl = (path: string) => `${editorBase || baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const editorOrigin = (() => {
    try {
      return editorBase ? new URL(editorBase).origin : "";
    } catch {
      return "";
    }
  })();
  const ownPort = () => Number(new URL(baseUrl).port);
  const authUrl = (path = "/") => `${baseUrl}/auth?token=${encodeURIComponent(currentToken())}&next=${encodeURIComponent(safeNext(path))}`;

  /**
   * Open the editor in a browser. When this server serves the editor and auth is on, the browser has
   * to sign in first: the default opener goes through a 0600 launch file, a custom opener gets /auth.
   */
  const open = (url: string): void => {
    const needsSignIn = authRequired && !editorBase && url.startsWith(baseUrl);
    if (!needsSignIn) return (customOpen ?? defaultOpenBrowser)(url);
    const path = url.slice(baseUrl.length) || "/";
    if (customOpen) return customOpen(authUrl(path));
    writeLaunchFile(configDir, ownPort(), launchPage(baseUrl, token, safeNext(path)))
      .then((file) => defaultOpenBrowser(file))
      .catch(() => defaultOpenBrowser(url));
  };

  const bridgeOpts: ConstructorParameters<typeof BridgeHub>[0] = { editorUrl, openBrowser: open };
  if (opts.connectTimeoutMs !== undefined) bridgeOpts.connectTimeoutMs = opts.connectTimeoutMs;
  const bridge = new BridgeHub(bridgeOpts);
  const history = new VersionHistory(workspace, opts.history);
  const approvals = new AgentApprovals(configDir);
  const plugins = new Plugins(join(configDir, "plugins"), opts.builtinPluginsDir);
  const callTool = createToolExecutor({ workspace, bridge, guides, editorUrl, ...(opts.approveAgents === false ? {} : { approvals }) });
  const sessions = new McpHttpSessions(callTool);
  const ai = createAiRoutes({ workspace, guides, callTool, configDir: opts.userConfigDir ?? userConfigDir(), fetch: opts.aiFetch });

  async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") return sendError(res, 405, "Method not allowed");
    const indexPath = join(editorDist, "index.html");
    if (!(await isFile(indexPath))) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : NOT_BUILT_PAGE);
      return;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return sendError(res, 400, "Bad path");
    }
    const target = resolve(editorDist, `.${decoded}`);
    const inside = target === editorDist || target.startsWith(editorDist + sep);
    let file = inside && (await isFile(target)) ? target : null;
    if (!file) {
      // SPA fallback for client routes; real missing files (with an extension) are 404s.
      if (extname(decoded) && !decoded.endsWith(".html")) return sendError(res, 404, "Not found");
      file = indexPath;
    }
    const data = await readFile(file);
    const isIndex = file === indexPath;
    res.writeHead(200, {
      "content-type": STATIC_MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": data.length,
      "cache-control": isIndex ? "no-cache" : file.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "public, max-age=300",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  }

  async function route(req: IncomingMessage, res: ServerResponse, url: URL, authed: boolean): Promise<void> {
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (path === "/auth") return signIn(req, res, url);

    if (path === "/mcp" || path.startsWith("/mcp/")) {
      const body = method === "POST" ? await readJson(req, TOOL_CALL_LIMIT) : undefined;
      await sessions.handle(req, res, body);
      return;
    }

    if (!path.startsWith("/api/")) return serveStatic(req, res, path);
    if (await handleFontRoute(fontCache, req, res, url)) return;
    if (await ai.handle(req, res, url)) return;

    if (path === "/api/session" && method === "GET") {
      return sendJson(res, 200, { ok: true, authRequired, token: currentToken(), header: TOKEN_HEADER, canResetToken: !override });
    }
    if (path === "/api/session/reset-token" && method === "POST") {
      if (override) throw new WorkspaceError("The token is overridden. Change OPENCREASE_TOKEN and restart the server.", 409);
      token = await resetToken(configDir);
      res.setHeader("set-cookie", sessionCookie(ownPort(), token));
      sendJson(res, 200, { ok: true });
      await sessions.close();
      bridge.disconnectClients();
      return;
    }

    if (path === "/api/status" && method === "GET") {
      if (!authed) return sendJson(res, 200, { app: "opencrease", version: VERSION, authRequired: true });
      return sendJson(res, 200, {
        app: "opencrease",
        version: VERSION,
        workspace: workspace.root,
        port: Number(new URL(baseUrl).port),
        mcpUrl: `${baseUrl}/mcp`,
        editorConnected: bridge.connected,
        openFiles: bridge.openFiles(),
        activeFileId: bridge.activeFileId,
      });
    }

    if (path === "/api/snapshot" && method === "POST") {
      const body = parseSnapshotBody(await readJson(req, SNAPSHOT_LIMIT));
      return sendJson(res, 200, await importSnapshot({ workspace, bridge, editorUrl, openBrowser: open }, body));
    }

    if (path === "/api/tools" && method === "GET") {
      return sendJson(res, 200, TOOLS.map((t) => ({ name: t.name, title: t.title, readOnly: t.readOnly, side: t.side })));
    }

    if (path === "/api/tools/call" && method === "POST") {
      const body = asObject(await readJson(req, TOOL_CALL_LIMIT));
      if (typeof body.tool !== "string") throw new HttpError(400, "tool is required");
      const c = asObject(body.client);
      const client = typeof c.name === "string" && c.name ? (typeof c.version === "string" ? { name: c.name, version: c.version } : { name: c.name }) : undefined;
      return sendJson(res, 200, await callTool(body.tool, body.args ?? {}, client));
    }

    if (path === "/api/files") {
      if (method === "GET") {
        const files = await workspace.list();
        files.sort((a, b) => b.updatedAt - a.updatedAt);
        return sendJson(res, 200, files);
      }
      if (method === "POST") {
        const body = asObject(await readJson(req));
        const createOpts: { name?: string; cloneFileId?: string; folder?: string } = {};
        if (typeof body.name === "string") createOpts.name = body.name;
        if (typeof body.cloneFileId === "string" && body.cloneFileId) createOpts.cloneFileId = body.cloneFileId;
        if (typeof body.folder === "string" && body.folder) createOpts.folder = body.folder;
        const entry = await workspace.create(createOpts);
        return sendJson(res, 201, { id: entry.id, name: entry.name, path: entry.path, folder: entry.folder, updatedAt: entry.updatedAt });
      }
      throw new HttpError(405, "Method not allowed");
    }

    let m = /^\/api\/files\/([^/]+)$/.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      if (method === "GET") return sendJson(res, 200, await workspace.readDocument(id));
      if (method === "PUT") {
        const { updatedAt, doc } = await workspace.writeDocument(id, await readJson(req));
        await history.noteSave(id, doc).catch((err: unknown) => console.warn("[opencrease] version snapshot failed", err));
        return sendJson(res, 200, { ok: true, updatedAt });
      }
      if (method === "PATCH") {
        const body = asObject(await readJson(req));
        if (typeof body.name !== "string") throw new HttpError(400, "name is required");
        const entry = await workspace.rename(id, body.name);
        return sendJson(res, 200, { ok: true, id: entry.id, name: entry.name, path: entry.path });
      }
      if (method === "DELETE") {
        await workspace.delete(id);
        return sendJson(res, 200, { ok: true });
      }
      throw new HttpError(405, "Method not allowed");
    }

    m = /^\/api\/files\/([^/]+)\/thumbnail$/.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      if (method === "GET") {
        const data = await workspace.readThumbnail(id);
        if (!data) throw new HttpError(404, "No thumbnail");
        res.writeHead(200, { "content-type": "image/png", "content-length": data.length, "cache-control": "no-cache" });
        res.end(data);
        return;
      }
      if (method === "PUT") {
        const data = await readBody(req, THUMBNAIL_LIMIT);
        if (!data.length) throw new HttpError(400, "Empty body");
        await workspace.writeThumbnail(id, data);
        return sendJson(res, 200, { ok: true });
      }
      throw new HttpError(405, "Method not allowed");
    }

    m = /^\/api\/files\/([^/]+)\/assets$/.exec(path);
    if (m) {
      if (method !== "POST") throw new HttpError(405, "Method not allowed");
      const id = decodeURIComponent(m[1]!);
      await workspace.require(id);
      const data = await readBody(req, MAX_ASSET_BYTES);
      if (!data.length) throw new HttpError(400, "Empty body");
      const rawName = req.headers["x-filename"];
      let filename: string | undefined;
      if (typeof rawName === "string" && rawName) {
        try {
          filename = decodeURIComponent(rawName);
        } catch {
          filename = rawName;
        }
      }
      const mime = req.headers["content-type"] || "application/octet-stream";
      return sendJson(res, 200, await workspace.addAsset(id, data, mime, filename));
    }

    m = /^\/api\/files\/([^/]+)\/exports$/.exec(path);
    if (m) {
      if (method !== "POST") throw new HttpError(405, "Method not allowed");
      const id = decodeURIComponent(m[1]!);
      await workspace.require(id);
      const rawName = req.headers["x-filename"];
      if (typeof rawName !== "string" || !rawName) throw new HttpError(400, "x-filename is required");
      let filename: string;
      try {
        filename = decodeURIComponent(rawName);
      } catch {
        filename = rawName;
      }
      const data = await readBody(req, EXPORT_LIMIT);
      if (!data.length) throw new HttpError(400, "Empty body");
      return sendJson(res, 200, { path: await workspace.writeExport(id, filename, data) });
    }

    m = /^\/api\/files\/([^/]+)\/assets\/([^/]+)$/.exec(path);
    if (m) {
      if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "Method not allowed");
      const id = decodeURIComponent(m[1]!);
      const hash = decodeURIComponent(m[2]!).replace(/\.[a-z0-9]+$/i, "").toLowerCase();
      const asset = await workspace.readAsset(id, hash);
      if (!asset) throw new HttpError(404, "Asset not found");
      res.writeHead(200, {
        "content-type": asset.mime,
        // Uploaded SVG/HTML must never acquire editor privileges when navigated to directly.
        "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        "x-content-type-options": "nosniff",
        "content-length": asset.data.length,
        "cache-control": "public, max-age=31536000, immutable",
      });
      res.end(method === "HEAD" ? undefined : asset.data);
      return;
    }

    if (path === "/api/render/pdf" && method === "POST") {
      const body = asObject(await readJson(req, RENDER_LIMIT));
      let pages;
      try {
        pages = validatePages(body.pages);
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
      let pdf: Buffer;
      try {
        pdf = await renderPdf(pages, typeof body.title === "string" ? { title: body.title } : {});
      } catch (err) {
        if (err instanceof ChromiumUnavailable) throw new HttpError(501, err.message);
        throw err;
      }
      res.writeHead(200, { "content-type": "application/pdf", "content-length": pdf.length, "cache-control": "no-store" });
      res.end(pdf);
      return;
    }

    if (path === "/api/libraries" && method === "GET") return sendJson(res, 200, await libraries.list());

    m = /^\/api\/files\/([^/]+)\/library$/.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      if (method === "GET") {
        const snap = await libraries.read(id);
        if (!snap) throw new HttpError(404, "This file has not been published as a library");
        return sendJson(res, 200, snap);
      }
      if (method === "PUT") return sendJson(res, 200, await libraries.publish(id, await readJson(req)));
      throw new HttpError(405, "Method not allowed");
    }

    m = /^\/api\/files\/([^/]+)\/library\/copy-assets$/.exec(path);
    if (m && method === "POST") {
      const body = asObject(await readJson(req));
      if (typeof body.to !== "string") throw new HttpError(400, "to is required");
      return sendJson(res, 200, { copied: await libraries.copyAssets(decodeURIComponent(m[1]!), body.to) });
    }

    if (path === "/api/guide" && method === "GET") {
      return sendJson(res, 200, await guides.craft(url.searchParams.get("fileId")));
    }

    m = /^\/api\/guide\/([^/]+)$/.exec(path);
    if (m && method === "PUT") {
      const content = (await readBody(req, GUIDE_LIMIT)).toString("utf8");
      const layer = await guides.write(decodeURIComponent(m[1]!), content, url.searchParams.get("fileId"));
      return sendJson(res, 200, { ok: true, layer });
    }

    if (await platformRoutes({ req, res, path, method, readJson: () => readJson(req), sendJson: (status, data) => sendJson(res, status, data), history, approvals, plugins })) return;

    throw new HttpError(404, "Not found");
  }

  /** POST /auth (form or JSON) or GET /auth?token=: set the session cookie and go to `next`. */
  async function signIn(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    let given: unknown = url.searchParams.get("token");
    let next: unknown = url.searchParams.get("next");
    if (req.method === "POST") {
      const raw = (await readBody(req, 64 * 1024)).toString("utf8");
      if (String(req.headers["content-type"] ?? "").includes("application/json")) {
        let body: Record<string, unknown>;
        try {
          body = asObject(JSON.parse(raw));
        } catch {
          throw new HttpError(400, "Body is not valid JSON");
        }
        given = body.token;
        next = body.next;
      } else {
        const form = new URLSearchParams(raw);
        given = form.get("token");
        next = form.get("next");
      }
    } else if (req.method !== "GET") throw new HttpError(405, "Method not allowed");
    if (typeof given !== "string" || !tokensEqual(given.trim(), token)) {
      res.writeHead(401, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end(`This sign-in link is not valid. Run opencrease again to open the editor, or use ~/.opencrease/token.`);
      return;
    }
    res.setHeader("set-cookie", sessionCookie(ownPort(), token));
    if (String(req.headers.accept ?? "").includes("application/json")) return sendJson(res, 200, { ok: true });
    res.writeHead(303, { location: safeNext(next), "cache-control": "no-store", "referrer-policy": "no-referrer" });
    res.end();
  }

  /** Paths that work without the token: the editor's static files, sign-in and a minimal status. */
  const isPublicPath = (path: string, method: string) =>
    path === "/auth" || path === "/api/status" || method === "OPTIONS" || (!path.startsWith("/api/") && path !== "/mcp" && !path.startsWith("/mcp/") && path !== BRIDGE_PATH);

  type Gate = { ok: true; authed: boolean; cors: boolean } | { ok: false; status: number; message: string };

  /** Host, Origin and token checks shared by HTTP requests and WebSocket upgrades. */
  function gate(req: IncomingMessage, url: URL): Gate {
    if (!isLocalHostHeader(req.headers.host)) return { ok: false, status: 403, message: "Forbidden host" };
    const origin = req.headers.origin;
    const path = url.pathname;
    if (!authRequired) {
      if (!isLocalOrigin(origin) && !(isExtensionOrigin(origin) && isExtensionPath(req.method, path))) return { ok: false, status: 403, message: "Forbidden origin" };
      return { ok: true, authed: true, cors: !!origin };
    }
    const extension = isExtensionOrigin(origin) && isExtensionPath(req.method, path);
    // the sign-in form is posted from a local launch file (Origin "null")
    if (path !== "/auth" && !isLocalOrigin(origin) && !extension) return { ok: false, status: 403, message: "Forbidden origin" };
    const sameOrigin = isSameOrigin(origin, req.headers.host) || (!!origin && origin === editorOrigin);
    const result = authorize(req, url, {
      token: currentToken(),
      port: ownPort(),
      sameOrigin,
      trustedOrigin: isLocalOrigin(origin) || extension,
      allowQuery: path === "/mcp",
    });
    if (result.ok) return { ok: true, authed: true, cors: !!origin && !sameOrigin };
    if (isPublicPath(path, req.method ?? "GET")) return { ok: true, authed: false, cors: extension && path === "/api/status" };
    return { ok: false, status: result.status, message: result.message };
  }

  const httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const g = gate(req, url);
    if (!g.ok) return sendError(res, g.status, g.message);
    const origin = req.headers.origin;
    const preflight = req.method === "OPTIONS" && (isLocalOrigin(origin) || (isExtensionOrigin(origin) && isExtensionPath(req.method, url.pathname)));
    if (origin && (g.cors || preflight)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("access-control-allow-headers", `content-type, x-filename, mcp-session-id, mcp-protocol-version, last-event-id, authorization, ${TOKEN_HEADER}`);
      res.setHeader("access-control-expose-headers", "mcp-session-id");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    route(req, res, url, g.authed).catch((err: unknown) => {
      if (err instanceof HttpError || err instanceof WorkspaceError || err instanceof SnapshotError) return sendError(res, err.status, err.message);
      console.error("[opencrease]", err);
      sendError(res, 500, (err as Error)?.message || "Internal error");
    });
  });

  httpServer.on("upgrade", (req, socket, head) => {
    const g = gate(req, new URL(req.url ?? "/", "http://127.0.0.1"));
    if (!g.ok) {
      socket.write(`HTTP/1.1 ${g.status} ${g.status === 401 ? "Unauthorized" : "Forbidden"}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    if (!bridge.handleUpgrade(req, socket, head)) socket.destroy();
  });

  await new Promise<void>((resolveListen, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.port ?? DEFAULT_PORT, host, () => {
      httpServer.off("error", reject);
      resolveListen();
    });
  });

  const port = (httpServer.address() as AddressInfo).port;
  baseUrl = `http://${host === "::1" ? "[::1]" : host}:${port}`;
  try {
    if (override) await writeSessionToken(configDir, port, token);
    else await removeSessionToken(configDir, port, readTokenSync(configDir, port) ?? "");
  }
  catch (error) { await new Promise<void>((r) => httpServer.close(() => r())); throw error; }

  const tokenChanged = () => { currentToken(); };
  if (!override) watchFile(tokenPath(configDir), { persistent: false, interval: 250 }, tokenChanged);

  return {
    url: baseUrl,
    port,
    workspace,
    bridge,
    guides,
    history,
    approvals,
    plugins,
    callTool,
    httpServer,
    get token() { return currentToken(); },
    authRequired,
    authUrl,
    openEditor: (path = "/") => open(editorUrl(path)),
    async close() {
      if (!override) unwatchFile(tokenPath(configDir), tokenChanged);
      if (override) await removeSessionToken(configDir, port, token);
      await closeRenderer();
      await sessions.close();
      await bridge.close();
      await new Promise<void>((r) => {
        httpServer.close(() => r());
        httpServer.closeAllConnections();
      });
    },
  };
}
