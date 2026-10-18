import { describe, expect, it } from "vitest";
import { deepLinkFromArgv, parseDeepLink } from "./deep-link";

describe("parseDeepLink", () => {
  it("accepts file and page links", () => {
    expect(parseDeepLink("opencrease://file/01HZX3K7Q2V8N5M4R6T9W0YB1C")).toBe("/file/01HZX3K7Q2V8N5M4R6T9W0YB1C");
    expect(parseDeepLink("opencrease://file/01HZX3K7Q2V8N5M4R6T9W0YB1C/p-1-abc")).toBe("/file/01HZX3K7Q2V8N5M4R6T9W0YB1C/p-1-abc");
    expect(parseDeepLink("opencrease://file/01HZX3K7Q2V8N5M4R6T9W0YB1C/p-1-abc/")).toBe("/file/01HZX3K7Q2V8N5M4R6T9W0YB1C/p-1-abc");
    expect(parseDeepLink("OPENCREASE://FILE/abc")).toBe("/file/abc");
    expect(parseDeepLink("opencrease://home")).toBe("/");
  });

  it("rejects anything else", () => {
    for (const bad of [
      "https://file/abc",
      "opencrease://file/",
      "opencrease://file",
      "opencrease://file/a/b/c",
      "opencrease://file/../etc",
      "opencrease://file/%2e%2e/x",
      "opencrease://file/a%2Fb",
      "opencrease://file/abc?x=1",
      "opencrease://file/abc#x",
      "opencrease://user:pw@file/abc",
      "opencrease://file:99/abc",
      "opencrease://evil.com/file/abc",
      "opencrease://file/a b",
      "opencrease://file//abc",
      "opencrease://home/x",
      `opencrease://file/${"a".repeat(600)}`,
      "javascript:alert(1)",
      "",
      42,
    ]) {
      expect(parseDeepLink(bad), String(bad)).toBeNull();
    }
  });

  it("finds a link among argv", () => {
    expect(deepLinkFromArgv(["/Apps/OpenCrease", "--flag", "opencrease://file/abc/p-1"])).toBe("/file/abc/p-1");
    expect(deepLinkFromArgv(["/Apps/OpenCrease", "opencrease://bad/abc"])).toBeNull();
  });
});
