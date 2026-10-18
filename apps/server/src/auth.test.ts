import { request } from "node:http";
import { chmod, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { cookieName, launchPage, loadOrCreateToken, readTokenSync, safeNext } from "./auth";
import { isSameOrigin } from "./security";
import { startTestServer, tempDir, type TestServer } from "./test-utils";

function raw(port: number, path: string, headers: Record<string, string>, method = "GET"): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (r) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => resolve({ status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("persistent token file", () => {
  it("is created once with 0600 permissions and reused", async () => {
    const tmp = await tempDir();
    try {
      const dir = join(tmp.dir, "home");
      const a = await loadOrCreateToken(dir);
      expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(await loadOrCreateToken(dir)).toBe(a);
      expect(readTokenSync(dir)).toBe(a);
      if (process.platform !== "win32") {
        await chmod(join(dir, "token"), 0o644);
        expect(await loadOrCreateToken(dir)).toBe(a);
      }
      if (process.platform !== "win32") expect((await stat(join(dir, "token"))).mode & 0o777).toBe(0o600);
    } finally {
      await tmp.cleanup();
    }
  });

  it("uses OPENCREASE_TOKEN without changing the persistent credential", async () => {
    const tmp = await tempDir();
    try {
      const persistent = await loadOrCreateToken(tmp.dir);
      vi.stubEnv("OPENCREASE_TOKEN", "environment-override-0123456789");
      expect(await loadOrCreateToken(tmp.dir)).toBe("environment-override-0123456789");
      expect(readTokenSync(tmp.dir, 29911)).toBe("environment-override-0123456789");
      vi.unstubAllEnvs();
      expect(await loadOrCreateToken(tmp.dir)).toBe(persistent);
    } finally { vi.unstubAllEnvs(); await tmp.cleanup(); }
  });

  it("only redirects to same-site paths after sign-in", () => {
    expect(safeNext("/file/ABC")).toBe("/file/ABC");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("/\\evil")).toBe("/");
    expect(launchPage("http://127.0.0.1:1", 'x"><script>', "/")).not.toContain('"><script>');
  });

  it("compares origins with the Host header", () => {
    expect(isSameOrigin("http://localhost:5210", "localhost:5210")).toBe(true);
    expect(isSameOrigin("http://localhost:3000", "localhost:5210")).toBe(false);
    expect(isSameOrigin("http://127.0.0.1", "127.0.0.1:80")).toBe(true);
    expect(isSameOrigin("http://[::1]:9", "[::1]:9")).toBe(true);
    expect(isSameOrigin("null", "localhost:1")).toBe(false);
  });
});

describe("token auth on the HTTP server", () => {
  let s: TestServer;
  const TOKEN = "test-token-0123456789abcdef";
  const host = () => `127.0.0.1:${s.port}`;

  beforeEach(async () => {
    s = await startTestServer({ auth: true, token: TOKEN });
  });
  afterEach(() => s.stop());

  it("rejects API, MCP and tool calls without the token", async () => {
    expect((await fetch(`${s.url}/api/files`)).status).toBe(401);
    expect((await fetch(`${s.url}/api/tools/call`, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await fetch(`${s.url}/mcp`, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await fetch(`${s.url}/api/files`, { headers: { authorization: "Bearer wrong-token-0000000000" } })).status).toBe(401);
  });

  it("accepts the token as a bearer header, X-OpenCrease-Token, or ?token= on /mcp", async () => {
    expect((await fetch(`${s.url}/api/files`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
    expect((await fetch(`${s.url}/api/files`, { headers: { "x-opencrease-token": TOKEN } })).status).toBe(200);
    expect((await fetch(`${s.url}/api/files?token=${TOKEN}`)).status).toBe(401);
    const client = new Client({ name: "auth-test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp?token=${TOKEN}`)));
    expect((await client.listTools()).tools.length).toBeGreaterThan(30);
    await client.close();
  });

  it("keeps the status endpoint public but minimal", async () => {
    const pub = await (await fetch(`${s.url}/api/status`)).json();
    expect(pub).toEqual({ app: "opencrease", version: "0.1.0", authRequired: true });
    const full = await (await fetch(`${s.url}/api/status`, { headers: { "x-opencrease-token": TOKEN } })).json() as { workspace: string };
    expect(full.workspace).toBe(s.workspace.root);
  });

  it("signs a browser in with a cookie that only works same-origin", async () => {
    const bad = await raw(s.port, "/auth?token=nope&next=/x", { host: host() });
    expect(bad.status).toBe(401);
    const ok = await raw(s.port, `/auth?token=${TOKEN}&next=/file/ABC`, { host: host() });
    expect(ok.status).toBe(303);
    expect(ok.headers.location).toBe("/file/ABC");
    const setCookie = String((ok.headers["set-cookie"] as string[])[0]);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    const cookie = `${cookieName(s.port)}=${TOKEN}`;

    // same origin (the editor) works, also for writes
    expect((await raw(s.port, "/api/files", { host: host(), cookie, origin: `http://${host()}` })).status).toBe(200);
    // a page on another localhost port cannot ride the cookie (CSRF)
    const cross = await raw(s.port, "/api/files", { host: host(), cookie, origin: "http://localhost:3000" }, "POST");
    expect(cross.status).toBe(403);
    expect(cross.headers["access-control-allow-origin"]).toBeUndefined();
    // a foreign website is rejected even with the token
    expect((await raw(s.port, "/api/files", { host: host(), "x-opencrease-token": TOKEN, origin: "https://evil.example" })).status).toBe(403);
    // DNS rebinding: a foreign Host header is rejected before anything else
    expect((await raw(s.port, "/api/files", { host: "evil.example:80", cookie })).status).toBe(403);
  });

  it("signs in with a posted form from the launch file", async () => {
    const res = await fetch(`${s.url}/auth`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "null" },
      body: `token=${TOKEN}&next=%2F`,
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toContain(cookieName(s.port));
  });

  it("lets token holders on loopback or extension origins call cross-origin", async () => {
    const r = await raw(s.port, "/api/status", { host: host(), origin: "chrome-extension://abcdef", "x-opencrease-token": TOKEN });
    expect((await raw(s.port, "/api/files", { host: host(), origin: "chrome-extension://abcdef", "x-opencrease-token": TOKEN })).status).toBe(403);
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe("chrome-extension://abcdef");
    const pre = await raw(s.port, "/api/snapshot", { host: host(), origin: "chrome-extension://abcdef" }, "OPTIONS");
    expect(pre.status).toBe(204);
    expect(String(pre.headers["access-control-allow-headers"])).toContain("x-opencrease-token");
  });

  it("sandboxes uploaded active documents even on direct navigation", async () => {
    const f = await s.workspace.create({ name: "Unsafe SVG" });
    const asset = await s.workspace.addAsset(f.id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "image/svg+xml");
    const res = await fetch(`${s.url}/api/files/${f.id}/assets/${asset.hash}`, { headers: { "x-opencrease-token": TOKEN } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toMatch(/^sandbox;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("serves the editor's static files without the token", async () => {
    const res = await fetch(`${s.url}/`);
    expect(res.status).toBe(200);
  });

  it("guards the bridge WebSocket", async () => {
    const attempt = (headers: Record<string, string>) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(`${s.url.replace("http", "ws")}/bridge`, { headers });
        ws.on("open", () => {
          ws.close();
          resolve("open");
        });
        ws.on("error", (e) => resolve(e.message));
      });
    expect(await attempt({})).toMatch(/401/);
    expect(await attempt({ cookie: `${cookieName(s.port)}=${TOKEN}`, origin: "http://localhost:3000" })).toMatch(/403/);
    expect(await attempt({ cookie: `${cookieName(s.port)}=${TOKEN}`, origin: s.url })).toBe("open");
    expect(await attempt({ "x-opencrease-token": TOKEN })).toBe("open");
  });

  it("opens the editor through /auth when a custom opener is used", async () => {
    s.openEditor("/file/XYZ");
    expect(s.opened[0]).toBe(`${s.url}/auth?token=${TOKEN}&next=${encodeURIComponent("/file/XYZ")}`);
  });
});

describe("shared server credentials", () => {
  it("survives restarts and is shared by simultaneous ports", async () => {
    const temp = await tempDir();
    const home = join(temp.dir, "home");
    const servers: TestServer[] = [];
    try {
      const a = await startTestServer({ auth: true, userConfigDir: home }); servers.push(a);
      const b = await startTestServer({ auth: true, userConfigDir: home }); servers.push(b);
      expect(a.token).toBe(b.token);
      expect(readTokenSync(home, a.port)).toBe(a.token);
      expect(readTokenSync(home, b.port)).toBe(b.token);
      const port = a.port, previous = a.token;
      await a.stop(); servers.shift();
      expect(readTokenSync(home, port)).toBe(previous);
      expect(readTokenSync(home, b.port)).toBe(b.token);
      const restarted = await startTestServer({ auth: true, port, userConfigDir: home }); servers.push(restarted);
      expect(restarted.token).toBe(previous);
      expect(readTokenSync(home, port)).toBe(restarted.token);
      expect((await fetch(`${restarted.url}/api/files`, { headers: { "x-opencrease-token": previous } })).status).toBe(200);
    } finally {
      for (const server of servers) await server.stop();
      await temp.cleanup();
    }
  });
});


describe("token reset", () => {
  it("rotates across running ports, rejects old credentials and survives restart", async () => {
    const tmp = await tempDir();
    const home = join(tmp.dir, "home");
    const servers: TestServer[] = [];
    try {
      const a = await startTestServer({ auth: true, userConfigDir: home }); servers.push(a);
      const b = await startTestServer({ auth: true, userConfigDir: home }); servers.push(b);
      const old = a.token;
      expect((await fetch(`${a.url}/api/session/reset-token`, { method: "POST" })).status).toBe(401);
      const res = await fetch(`${a.url}/api/session/reset-token`, { method: "POST", headers: { "x-opencrease-token": old } });
      expect(res.status).toBe(200);
      const next = readTokenSync(home)!;
      expect(next).not.toBe(old);
      expect(res.headers.get("set-cookie")).toContain(next);
      for (const server of servers) {
        expect((await fetch(`${server.url}/api/files`, { headers: { "x-opencrease-token": old } })).status).toBe(401);
        expect((await fetch(`${server.url}/api/files`, { headers: { "x-opencrease-token": next } })).status).toBe(200);
      }
      await a.stop(); servers.shift();
      const restarted = await startTestServer({ auth: true, userConfigDir: home }); servers.push(restarted);
      expect(restarted.token).toBe(next);
    } finally {
      for (const server of servers) await server.stop();
      await tmp.cleanup();
    }
  });

  it("preserves an explicit override and explains why reset is unavailable", async () => {
    const s = await startTestServer({ auth: true, token: "override-token-0123456789abcdef" });
    try {
      const headers = { "x-opencrease-token": s.token };
      expect(await (await fetch(`${s.url}/api/session`, { headers })).json()).toMatchObject({ canResetToken: false });
      expect((await fetch(`${s.url}/api/session/reset-token`, { method: "POST", headers })).status).toBe(409);
      expect(readTokenSync(join(s.dir, "home"), s.port)).toBe(s.token);
    } finally { await s.stop(); }
  });

  it("shares one complete token when servers initialize concurrently", async () => {
    const tmp = await tempDir();
    try {
      const tokens = await Promise.all(Array.from({ length: 8 }, () => loadOrCreateToken(join(tmp.dir, "home"))));
      expect(new Set(tokens).size).toBe(1);
    } finally { await tmp.cleanup(); }
  });
});
