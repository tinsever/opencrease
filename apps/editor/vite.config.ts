import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

const server = `http://127.0.0.1:${process.env.OPENCREASE_PORT ?? 29880}`;

/**
 * The server wants its local token on /api, /mcp and /bridge. The dev server is a local tool, so it
 * reads the token file (written by the server on start) and adds it to every proxied request.
 * Read on each request: the server may start after Vite.
 */
function sessionToken(): string | null {
  if (process.env.OPENCREASE_TOKEN) return process.env.OPENCREASE_TOKEN;
  try {
    const dir = process.env.OPENCREASE_HOME || join(homedir(), ".opencrease");
    try { return readFileSync(join(dir, "sessions", `${process.env.OPENCREASE_PORT ?? 29880}.token`), "utf8").trim() || null; }
    catch { return readFileSync(join(dir, "token"), "utf8").trim() || null; }
  } catch {
    return null;
  }
}

/** Only the dev editor's own pages get the token, not other local sites calling this port. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function withToken(target: string, ws = false): ProxyOptions {
  const add = (out: { setHeader(name: string, value: string): void }, incoming: IncomingMessage) => {
    const token = sessionToken();
    if (token && sameOrigin(incoming)) out.setHeader("x-opencrease-token", token);
  };
  return {
    target,
    ws,
    configure(proxy) {
      proxy.on("proxyReq", (out, incoming) => add(out, incoming));
      proxy.on("proxyReqWs", (out, incoming) => add(out, incoming));
    },
  };
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": withToken(server),
      "/mcp": withToken(server),
      "/auth": withToken(server),
      "/bridge": withToken(server.replace("http", "ws"), true),
    },
  },
  build: { outDir: "dist", sourcemap: true, chunkSizeWarningLimit: 4000 },
  // the AVIF encoder loads its .wasm relative to its own module, which pre-bundling would break
  optimizeDeps: { exclude: ["@jsquash/avif"] },
  worker: { format: "es" },
});
