// The server listens on 127.0.0.1 only. These checks stop other websites from driving it
// through the user's browser (CSRF, DNS rebinding, cross-origin WebSockets).

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Host header must name a loopback host (any port). Missing Host is allowed (HTTP/1.0 tools). */
export function isLocalHostHeader(host: string | undefined): boolean {
  if (!host) return true;
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
  return LOCAL_HOSTNAMES.has(name.toLowerCase());
}

/** Origin header, when present, must be a loopback http(s) origin (any port, e.g. the Vite dev server). */
export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && LOCAL_HOSTNAMES.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Browser extension origins (the Snapshot extension's popup and background script). */
export function isExtensionOrigin(origin: string | undefined): boolean {
  return !!origin && /^(chrome-extension|moz-extension|safari-web-extension):\/\/[\w.-]+$/i.test(origin);
}

/**
 * Endpoints browser extensions may call. Only the snapshot import and the status probe: extensions cannot
 * read or change files, call agent tools or reach the bridge.
 */
export function isExtensionPath(method: string | undefined, path: string): boolean {
  if (method === "OPTIONS") return path === "/api/status" || path === "/api/snapshot";
  return (method === "GET" && path === "/api/status") || (method === "POST" && path === "/api/snapshot");
}

function splitHost(host: string): { name: string; port: string | undefined } {
  const h = host.toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    const rest = h.slice(end + 1);
    return { name: h.slice(0, end + 1), port: rest.startsWith(":") ? rest.slice(1) : undefined };
  }
  const i = h.lastIndexOf(":");
  return i === -1 ? { name: h, port: undefined } : { name: h.slice(0, i), port: h.slice(i + 1) };
}

/** True when the Origin header names the host and port the request was sent to (the Host header). */
export function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  if (!host) return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const fallback = url.protocol === "https:" ? "443" : "80";
    const h = splitHost(host);
    const originHost = url.hostname.toLowerCase();
    return (originHost === h.name || `[${originHost}]` === h.name || originHost === `[${h.name}]`) && (url.port || fallback) === (h.port ?? fallback);
  } catch {
    return false;
  }

}
