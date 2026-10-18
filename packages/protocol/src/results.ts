import { tokensContentHash } from "@opencrease/model";
import type { FoldDocument } from "@opencrease/model";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ContentBlock[];
  isError?: boolean;
}

function toText(part: string | object): string {
  return typeof part === "string" ? part : JSON.stringify(part, null, 2);
}

/** Build a successful result. Strings are used as-is, objects are JSON.stringified with 2-space indentation. */
export function textResult(...parts: Array<string | object>): ToolResult {
  return { content: parts.map((p) => ({ type: "text" as const, text: toText(p) })) };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function imageBlock(data: string, mimeType: string): ContentBlock {
  return { type: "image", data, mimeType };
}

export interface FileHeader {
  file: { id: string; name: string };
  contentHash: { tokens: string };
}

/** fnv1a hash of the token list (stable JSON), used in the file header so agents notice token changes. */
export function tokensHash(tokens: FoldDocument["tokens"]): string {
  return tokensContentHash(tokens);
}

/** The header every file-scoped tool result starts with. */
export function fileHeader(doc: Pick<FoldDocument, "id" | "name" | "tokens">): FileHeader {
  return { file: { id: doc.id, name: doc.name }, contentHash: { tokens: tokensHash(doc.tokens) } };
}

/** Prefix a result with the file header text block. */
export function withFileHeader(doc: Pick<FoldDocument, "id" | "name" | "tokens">, result: ToolResult): ToolResult {
  return { ...result, content: [{ type: "text", text: toText(fileHeader(doc)) }, ...result.content] };
}
