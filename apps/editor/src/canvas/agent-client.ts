// Presentation helpers for MCP agent clients shown on the canvas.

export function isClaudeClient(client: string): boolean {
  return /claude/i.test(client);
}

/** Human name for an MCP client id: "claude-code" → "Claude", "codex-mcp-client" → "Codex". */
export function clientDisplayName(client: string): string {
  if (isClaudeClient(client)) return "Claude";
  const first = client.trim().split(/[\s\-_./]+/).find(Boolean) ?? "Agent";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** Two-letter monogram for non-Claude clients: "cursor" → "Cu", "open-code" → "OC". */
export function clientMonogram(client: string): string {
  const words = client.trim().split(/[\s\-_./]+/).filter(Boolean);
  if (words.length === 0) return "Ag";
  if (words.length >= 2 && !/^(mcp|client|cli)$/i.test(words[1])) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  const w = words[0];
  return w.charAt(0).toUpperCase() + (w.charAt(1) || "").toLowerCase();
}
