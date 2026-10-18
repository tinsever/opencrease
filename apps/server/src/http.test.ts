import { request } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { FoldDocument } from "@opencrease/model";
import { startTestServer, tempDir, type TestServer } from "./test-utils";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("HTTP API", () => {
  let s: TestServer;
  const api = (path: string, init?: RequestInit) => fetch(`${s.url}${path}`, init);
  const json = async <T = any>(path: string, init?: RequestInit): Promise<T> => {
    const res = await api(path, init);
    expect(res.ok, `${init?.method ?? "GET"} ${path} -> ${res.status}`).toBe(true);
    return (await res.json()) as T;
  };
  const send = (method: string, body: unknown) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  beforeEach(async () => {
    s = await startTestServer();
  });
  afterEach(() => s.stop());

  it("reports status", async () => {
    const status = await json("/api/status");
    expect(status).toMatchObject({ app: "opencrease", version: "0.1.0", workspace: s.workspace.root, editorConnected: false, openFiles: [] });
  });

  it("creates, lists, reads, writes, renames and deletes files", async () => {
    const created = await json<{ id: string; name: string; path: string }>("/api/files", send("POST", { name: "Hello" }));
    expect(created.name).toBe("Hello");
    expect(created.path.endsWith("Hello.fold")).toBe(true);

    const list = await json<Array<{ id: string; name: string; folder: string; updatedAt: number }>>("/api/files");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: created.id, name: "Hello", folder: "" });

    const doc = await json<FoldDocument>(`/api/files/${created.id}`);
    expect(doc.id).toBe(created.id);
    doc.updatedAt = 42;
    expect(await json(`/api/files/${created.id}`, send("PUT", doc))).toEqual({ ok: true, updatedAt: 42 });
    expect((await api(`/api/files/${created.id}`, send("PUT", { ...doc, id: "nope" }))).status).toBe(400);
    expect((await api(`/api/files/${created.id}`, { method: "PUT", body: "{not json" })).status).toBe(400);

    const renamed = await json(`/api/files/${created.id}`, send("PATCH", { name: "Renamed" }));
    expect(renamed).toMatchObject({ ok: true, name: "Renamed" });
    expect((await json<FoldDocument>(`/api/files/${created.id}`)).name).toBe("Renamed");

    const clone = await json<{ id: string; name: string }>("/api/files", send("POST", { cloneFileId: created.id, folder: "copies" }));
    expect(clone.name).toBe("Renamed copy");

    expect(await json(`/api/files/${created.id}`, { method: "DELETE" })).toEqual({ ok: true });
    expect((await api(`/api/files/${created.id}`)).status).toBe(404);
    expect((await json<unknown[]>("/api/files")).length).toBe(1);
  });

  it("stores thumbnails and assets", async () => {
    const { id } = await json<{ id: string }>("/api/files", send("POST", {}));
    expect((await api(`/api/files/${id}/thumbnail`)).status).toBe(404);
    expect(await json(`/api/files/${id}/thumbnail`, { method: "PUT", headers: { "content-type": "image/png" }, body: PNG })).toEqual({ ok: true });
    const thumb = await api(`/api/files/${id}/thumbnail`);
    expect(thumb.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await thumb.arrayBuffer()).equals(PNG)).toBe(true);

    const meta = await json(`/api/files/${id}/assets`, {
      method: "POST",
      headers: { "content-type": "image/png", "x-filename": encodeURIComponent("my dot.png") },
      body: PNG,
    });
    expect(meta).toMatchObject({ mime: "image/png", size: PNG.length, name: "my dot.png", width: 1, height: 1 });
    const asset = await api(`/api/files/${id}/assets/${meta.hash}`);
    expect(asset.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await asset.arrayBuffer()).equals(PNG)).toBe(true);
    expect((await api(`/api/files/${id}/assets/${"0".repeat(64)}`)).status).toBe(404);
    expect((await api(`/api/files/UNKNOWN/assets`, { method: "POST", body: PNG })).status).toBe(404);
  });

  it("writes exports into the workspace Exports folder", async () => {
    const { id } = await json<{ id: string }>("/api/files", send("POST", { name: "Deck" }));
    const out = await json<{ path: string }>(`/api/files/${id}/exports`, {
      method: "POST",
      headers: { "content-type": "image/png", "x-filename": encodeURIComponent("../Hero @2x.png") },
      body: PNG,
    });
    expect(out.path).toBe(join(s.workspace.root, "Exports", "Deck", "Hero @2x.png"));
    const { readFile } = await import("node:fs/promises");
    expect((await readFile(out.path)).equals(PNG)).toBe(true);
    expect((await api(`/api/files/${id}/exports`, { method: "POST", body: PNG })).status).toBe(400);
    expect((await api(`/api/files/UNKNOWN/exports`, { method: "POST", headers: { "x-filename": "a.png" }, body: PNG })).status).toBe(404);
    // the Exports folder does not show up as a file
    expect((await json<unknown[]>("/api/files")).length).toBe(1);
  });

  it("serves layered guides", async () => {
    const { id } = await json<{ id: string }>("/api/files", send("POST", { name: "Brand" }));
    const before = await json<{ layers: Array<{ id: string; editable: boolean; content: string }>; merged: string }>(`/api/guide?fileId=${id}`);
    expect(before.layers.map((l) => [l.id, l.editable])).toEqual([["builtin", false], ["user", true], ["file", true]]);
    expect(before.layers[0]!.content).toMatch(/craft guide/i);

    expect((await api("/api/guide/builtin", { method: "PUT", body: "x" })).status).toBe(403);
    await json("/api/guide/user", { method: "PUT", body: "Prefer serif display type." });
    await json(`/api/guide/file?fileId=${id}`, { method: "PUT", body: "Brand colour is teal." });
    expect((await api("/api/guide/file", { method: "PUT", body: "x" })).status).toBe(400);

    const after = await json<{ merged: string }>(`/api/guide?fileId=${id}`);
    const merged = after.merged;
    expect(merged.indexOf("OpenCrease craft guide")).toBeLessThan(merged.indexOf("Prefer serif"));
    expect(merged.indexOf("Prefer serif")).toBeLessThan(merged.indexOf("Brand colour is teal"));
    expect((await json<{ layers: unknown[] }>("/api/guide")).layers).toHaveLength(2);
  });

  it("calls server-side tools through /api/tools/call", async () => {
    const res = await json("/api/tools/call", send("POST", { tool: "create_file", args: { name: "Via tool" }, client: { name: "test" } }));
    const created = JSON.parse(res.content[0].text);
    expect(created.fileId).toMatch(/^[0-9A-Z]{26}$/);
    expect(created.url).toBe(`${s.url}/file/${created.fileId}`);
    const bad = await json("/api/tools/call", send("POST", { tool: "nope", args: {} }));
    expect(bad.isError).toBe(true);
    expect((await api("/api/tools/call", send("POST", {}))).status).toBe(400);
  });

  it("publishes libraries, lists them and copies their assets to subscribers", async () => {
    const lib = await json<{ id: string }>("/api/files", send("POST", { name: "Kit" }));
    const app = await json<{ id: string }>("/api/files", send("POST", { name: "App" }));
    expect((await api(`/api/files/${lib.id}/library`)).status).toBe(404);
    const asset = await json<{ hash: string }>(`/api/files/${lib.id}/assets`, { method: "POST", headers: { "content-type": "image/png" }, body: PNG });
    const snap = { fileId: lib.id, name: "x", version: 1, publishedAt: 1, componentIds: ["A-0"], nodes: {}, tokens: [], assets: { [asset.hash]: { hash: asset.hash, mime: "image/png", size: PNG.length } } };
    expect(await json(`/api/files/${lib.id}/library`, send("PUT", snap))).toEqual({ version: 1, publishedAt: 1 });
    // re-publishing an old version number bumps it
    expect((await json<{ version: number }>(`/api/files/${lib.id}/library`, send("PUT", snap))).version).toBe(2);
    expect(await json(`/api/libraries`)).toEqual([{ fileId: lib.id, name: "Kit", version: 2, publishedAt: 1, componentCount: 1, tokenCount: 0 }]);
    expect((await json<{ name: string }>(`/api/files/${lib.id}/library`)).name).toBe("Kit");
    expect((await api(`/api/files/${app.id}/library`, send("PUT", snap))).status).toBe(400);
    expect(await json(`/api/files/${lib.id}/library/copy-assets`, send("POST", { to: app.id }))).toEqual({ copied: 1 });
    expect((await api(`/api/files/${app.id}/assets/${asset.hash}`)).status).toBe(200);
  });

  it("returns 404 JSON for unknown API routes", async () => {
    const res = await api("/api/nothing");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("serves a fallback page when the editor is not built", async () => {
    const res = await api("/file/abc");
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/pnpm build/);
  });

  it("rejects foreign origins and hosts", async () => {
    const res = await api("/api/status", { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    const ok = await api("/api/status", { headers: { origin: "http://localhost:5173" } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");

    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: s.port, path: "/api/status", headers: { host: "evil.example" } }, (r) => {
        r.resume();
        resolve(r.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);

    const wsErr = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`${s.url.replace("http", "ws")}/bridge`, { origin: "https://evil.example" });
      ws.on("open", () => resolve("open"));
      ws.on("error", (e) => resolve(e.message));
    });
    expect(wsErr).toMatch(/403/);
  });
});

describe("static editor build", () => {
  let s: TestServer;
  let tmp: { dir: string; cleanup(): Promise<void> };
  afterEach(async () => {
    await s.stop();
    await tmp.cleanup();
  });

  it("serves files from dist with SPA fallback and no traversal", async () => {
    tmp = await tempDir();
    const dist = join(tmp.dir, "dist");
    await mkdir(join(dist, "assets"), { recursive: true });
    await writeFile(join(dist, "index.html"), "<!doctype html><title>editor</title>");
    await writeFile(join(dist, "assets", "app-123.js"), "console.log(1)");
    await writeFile(join(tmp.dir, "secret.txt"), "secret");
    s = await startTestServer({ editorDist: dist });

    const index = await fetch(`${s.url}/`);
    expect(index.headers.get("content-type")).toMatch(/text\/html/);
    expect(await index.text()).toMatch(/editor/);
    const js = await fetch(`${s.url}/assets/app-123.js`);
    expect(js.headers.get("content-type")).toMatch(/javascript/);
    expect(js.headers.get("cache-control")).toMatch(/immutable/);
    expect(await (await fetch(`${s.url}/file/ABC/p-1-0`)).text()).toMatch(/editor/);
    expect((await fetch(`${s.url}/assets/missing.js`)).status).toBe(404);
    const traversal = await fetch(`${s.url}/..%2Fsecret.txt`);
    expect(await traversal.text()).not.toMatch(/secret/);
  });
});
