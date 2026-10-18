// Persistent token for the local server (SPEC §13): HTTP MCP, the REST API and the editor bridge need it,
// so other local web pages and other users on the machine cannot drive OpenCrease.
//
// - Servers share <configDir>/token (0600) across restarts and ports.
// - Agents send it as Authorization: Bearer or X-OpenCrease-Token. Stdio and Vite read it automatically.
// - Browser cookies only authenticate same-origin requests. Explicit cross-origin tokens are scoped
//   by the server's Origin/Host checks. Explicit overrides have per-port discovery files.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, link, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";

/** Atomic write of a file only the user can read (the temp file is created 0600 too). */
async function writePrivate(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  if (process.platform !== "win32") await chmod(path, 0o600);
}

export const TOKEN_FILE = "token";
export const TOKEN_HEADER = "x-opencrease-token";

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function tokenPath(configDir: string, port?: number): string {
  return port === undefined ? join(configDir, TOKEN_FILE) : join(configDir, "sessions", `${port}.token`);
}

/** Read the token file without creating it (stdio proxy, Vite). Returns null when missing. */
export function readTokenSync(configDir: string, port?: number): string | null {
  const env = process.env.OPENCREASE_TOKEN?.trim();
  if (env) return env;
  if (port !== undefined) {
    try {
      const t = readFileSync(tokenPath(configDir, port), "utf8").trim();
      if (TOKEN_RE.test(t)) return t;
    } catch { /* normal servers use the shared persistent token */ }
  }
  try {
    const t = readFileSync(tokenPath(configDir), "utf8").trim();
    return TOKEN_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** Load the token, creating <configDir>/token with 0600 permissions on first use. */
export async function loadOrCreateToken(configDir: string): Promise<string> {
  const env = process.env.OPENCREASE_TOKEN?.trim();
  if (env) return env;
  const path = tokenPath(configDir);
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (TOKEN_RE.test(existing)) {
      // tighten permissions if someone loosened them
      if (process.platform !== "win32" && ((await stat(path)).mode & 0o077) !== 0) await chmod(path, 0o600);
      return existing;
    }
  } catch {
    // create below
  }
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("base64url");
  // Publish a complete file without replacing a token another server just created.
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, `${token}\n`, { mode: 0o600 });
  try {
    await link(tmp, path);
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = (await readFile(path, "utf8")).trim();
    if (TOKEN_RE.test(existing)) return existing;
    await writePrivate(path, `${token}\n`);
    return token;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

export function tokensEqual(a: string | undefined | null, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Cookie names are per port: browsers share cookies across ports of the same host. */
export function cookieName(port: number): string {
  return `opencrease_session_${port}`;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function sessionCookie(port: number, token: string): string {
  return `${cookieName(port)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`;
}

/** Token sent explicitly by the client (header, or ?token= when allowed). */
export function explicitToken(req: IncomingMessage, url: URL, allowQuery: boolean): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1]!.trim();
  }
  const h = req.headers[TOKEN_HEADER];
  if (typeof h === "string" && h) return h.trim();
  if (allowQuery) {
    const q = url.searchParams.get("token");
    if (q) return q;
  }
  return undefined;
}

export type AuthResult = { ok: true; via: "header" | "cookie" | "none" } | { ok: false; status: 401 | 403; message: string };

export interface AuthCheck {
  token: string;
  port: number;
  /** Origin matches the Host header, or is the configured editor URL. */
  sameOrigin: boolean;
  /** Origin is a loopback page or a browser extension (may use the token explicitly). */
  trustedOrigin: boolean;
  allowQuery: boolean;
}

export function authorize(req: IncomingMessage, url: URL, check: AuthCheck): AuthResult {
  const explicit = explicitToken(req, url, check.allowQuery);
  if (explicit !== undefined) {
    if (!tokensEqual(explicit, check.token)) return { ok: false, status: 401, message: "Invalid OpenCrease token" };
    if (!check.trustedOrigin) return { ok: false, status: 403, message: "Forbidden origin" };
    return { ok: true, via: "header" };
  }
  const cookie = parseCookies(req.headers.cookie)[cookieName(check.port)];
  if (cookie !== undefined && tokensEqual(cookie, check.token)) {
    if (!check.sameOrigin) return { ok: false, status: 403, message: "Cross-origin requests need an explicit token" };
    return { ok: true, via: "cookie" };
  }
  return {
    ok: false,
    status: 401,
    message: `Missing OpenCrease token. Send "Authorization: Bearer <token>" with the token from $OPENCREASE_HOME/token (default ~/.opencrease/token), or use "opencrease mcp", which adds it for you.`,
  };
}

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * A local HTML file that signs the browser in by posting the token to /auth. Opening a file keeps
 * the token out of the browser command line, which other users could read with `ps`.
 */
export function launchPage(baseUrl: string, token: string, next: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Opening OpenCrease</title></head>
<body style="font:14px system-ui,sans-serif;padding:32px;color:#444">
<form id="f" method="post" action="${escAttr(`${baseUrl}/auth`)}">
<input type="hidden" name="token" value="${escAttr(token)}"><input type="hidden" name="next" value="${escAttr(next)}">
<noscript><button type="submit">Open OpenCrease</button></noscript></form>
<p>Opening OpenCrease</p>
<script>document.getElementById("f").submit()</script>
</body></html>`;
}

/** Only same-site relative paths are valid redirect targets after signing in. */
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

export async function writeLaunchFile(configDir: string, port: number, html: string): Promise<string> {
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const path = join(configDir, `launch-${port}.html`);
  await writePrivate(path, html);
  return path;
}

/** Rotate the shared token. Explicit environment overrides must be changed at their source. */
export async function resetToken(configDir: string): Promise<string> {
  if (process.env.OPENCREASE_TOKEN?.trim()) throw new Error("OPENCREASE_TOKEN is set; change the environment override and restart the server.");
  const token = randomBytes(32).toString("base64url");
  await writePrivate(tokenPath(configDir), `${token}\n`);
  return token;
}

/** Announce an explicit per-server override, so stdio and Vite can discover it. */
export async function writeSessionToken(configDir: string, port: number, token: string): Promise<void> {
  await mkdir(join(configDir, "sessions"), { recursive: true, mode: 0o700 });
  await writePrivate(tokenPath(configDir, port), `${token}\n`);
}

/** Remove only this session's file, never a newer server's credential. */
export async function removeSessionToken(configDir: string, port: number, token: string): Promise<void> {
  const path = tokenPath(configDir, port);
  if (await readFile(path, "utf8").then((s) => tokensEqual(s.trim(), token), () => false)) await unlink(path).catch(() => {});
}
