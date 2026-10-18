import { describe, expect, it } from "vitest";
import { clientLabel, isClaudeClient, monogram } from "./AgentAvatar";

describe("agent identity", () => {
  it("labels clients", () => {
    expect(clientLabel("claude-code")).toBe("Claude Code");
    expect(clientLabel("claude-ai")).toBe("Claude");
    expect(clientLabel("codex-mcp-client")).toBe("Codex");
    expect(clientLabel("my_agent")).toBe("My agent");
  });
  it("makes monograms", () => {
    expect(monogram("codex-mcp-client")).toBe("Cx");
    expect(monogram("Cursor")).toBe("Cu");
    expect(monogram("opencode")).toBe("Oc");
    expect(monogram("my agent")).toBe("Ma");
    expect(monogram("FooBar")).toBe("Fb");
    expect(monogram("goose")).toBe("Gs");
  });
  it("detects claude", () => {
    expect(isClaudeClient("claude-code")).toBe(true);
    expect(isClaudeClient("codex")).toBe(false);
  });
});
