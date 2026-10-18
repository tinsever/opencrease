import { describe, expect, it } from "vitest";
import { clientSetups, connectInfo } from "./connect";

describe("connect info", () => {
  it("uses the running server's URL and port", () => {
    const info = connectInfo({ port: 29894, mcpUrl: "http://127.0.0.1:29894/mcp" });
    expect(info.url).toBe("http://127.0.0.1:29894/mcp");
    expect(info.stdio).toBe("opencrease mcp --port 29894");
    expect(info.loading).toBe(false);
    const all = JSON.stringify(clientSetups(info));
    expect(all).not.toContain("29880");
    expect(all).toContain("npx opencrease mcp --port 29894");
    const zed = JSON.parse(clientSetups(info).find((c) => c.id === "zed")!.steps[0].code);
    expect(zed.context_servers.opencrease.args).toEqual(["opencrease", "mcp", "--port", "29894"]);
  });
  it("omits --port for the default port", () => {
    const info = connectInfo({ port: 29880, mcpUrl: "http://127.0.0.1:29880/mcp" });
    expect(info.stdio).toBe("opencrease mcp");
    expect(clientSetups(info)[0].steps[0].code).toBe("claude mcp add opencrease -- npx opencrease mcp");
  });
  it("marks the placeholder while loading", () => {
    expect(connectInfo(null).loading).toBe(true);
  });
});
