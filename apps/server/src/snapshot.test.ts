import { afterEach, describe, expect, it } from "vitest";
import type { FoldDocument } from "@opencrease/model";
import { startTestServer, type TestServer } from "./test-utils";
import { parseSnapshotBody, type SnapshotResult } from "./snapshot";

let server: TestServer | undefined;
afterEach(async () => { await server?.stop(); server = undefined; });

describe("Snapshot endpoint", () => {
  it("validates payloads", () => {
    expect(() => parseSnapshotBody({})).toThrow("html is required");
    expect(parseSnapshotBody({ html: "<div>Hello</div>" })).toMatchObject({ name: "Snapshot", target: { kind: "active" } });
  });

  it("accepts extension preflights and imports assets on disk without opening a window", async () => {
    server = await startTestServer();
    const origin = "chrome-extension://abcdefghijklmnop";
    const preflight = await fetch(`${server.url}/api/snapshot`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const response = await fetch(`${server.url}/api/snapshot`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: "Captured", html: `<div style="width:300px;height:200px"><img src="data:image/png;base64,${png}" style="width:20px;height:20px"><div>Hello</div></div>`, target: { kind: "new" } }) });
    expect(response.status).toBe(200);
    const result = await response.json() as SnapshotResult;
    expect(result).toMatchObject({ ok: true, delivered: "disk", layers: 3 });
    const doc = await (await fetch(`${server.url}/api/files/${result.fileId}`)).json() as FoldDocument;
    expect(doc.nodes[result.nodeId!].name).toBe("Captured");
    const image = Object.values(doc.nodes).find((n) => n.type === "Image")!;
    expect(image.src).toMatch(/^asset:\/\/[a-f0-9]{64}$/);
    expect(Object.keys(doc.assets)).toHaveLength(1);
    expect(server.opened).toHaveLength(0);
    expect((await fetch(`${server.url}/api/files`, { headers: { origin } })).status).toBe(403);
    expect((await fetch(`${server.url}/api/snapshot`, { method: "POST", headers: { origin: "https://example.com", "content-type": "application/json" }, body: "{}" })).status).toBe(403);
  });

  it("rejects empty imports before creating a file", async () => {
    server = await startTestServer();
    const res = await fetch(`${server.url}/api/snapshot`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ html: "<script>bad()</script>" }) });
    expect(res.status).toBe(400);
    expect(await (await fetch(`${server.url}/api/files`)).json()).toEqual([]);
  });
});
