// SVG generation through a chat model: the selected frame (HTML and a screenshot) goes along as context,
// and the reply is cleaned down to one safe, standalone <svg> element.
import type { AiSvgRequest } from "@opencrease/protocol";
import { ProviderError } from "./http-util";
import type { ChatAdapter, HistoryBlock } from "./llm";

export const SVG_SYSTEM = `You draw SVG graphics for a design tool. Reply with exactly one standalone <svg> element and nothing else: no prose, no Markdown, no code fences.
- Include xmlns, a viewBox and explicit width and height attributes.
- Use shapes, paths, groups, gradients and text only. No scripts, event handlers, external references, images, foreignObject or animation.
- Keep it clean and editable: few nodes, sensible grouping, rounded coordinates.
- When a frame is given as context, match its palette, stroke weights and mood so the graphic belongs in it.`;

/** Pull the first <svg>…</svg> out of a reply and remove anything active or external. */
export function cleanSvg(reply: string): string {
  const m = /<svg\b[\s\S]*?<\/svg>/i.exec(reply);
  if (!m) throw new ProviderError("The model did not return an SVG. Try a more concrete prompt.");
  let svg = m[0];
  svg = svg.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "");
  svg = svg.replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "");
  svg = svg.replace(/<(image|use)\b[^>]*\b(?:xlink:)?href\s*=\s*["'](?!#)[^"']*["'][^>]*\/?>/gi, "");
  svg = svg.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  svg = svg.replace(/(href\s*=\s*["'])\s*javascript:[^"']*(["'])/gi, "$1#$2");
  if (!/\sxmlns=/.test(svg)) svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg.trim();
}

export async function generateSvg(adapter: ChatAdapter, model: string, req: AiSvgRequest, signal?: AbortSignal): Promise<string> {
  const content: HistoryBlock[] = [];
  const ctx = req.context;
  if (ctx?.image) content.push({ type: "image", data: ctx.image.data, mimeType: ctx.image.mimeType });
  const parts = [`Draw: ${req.prompt.trim()}`];
  if (ctx) {
    const size = ctx.width && ctx.height ? ` (${Math.round(ctx.width)}x${Math.round(ctx.height)})` : "";
    parts.push(`It goes into the frame "${ctx.name ?? "Frame"}"${size}.${ctx.image ? " The image shows that frame." : ""}`);
    if (ctx.html) parts.push(`The frame's HTML, for colours and style:\n${ctx.html.slice(0, 24_000)}`);
  }
  content.push({ type: "text", text: parts.join("\n\n") });
  const result = await adapter.stream({ model, system: SVG_SYSTEM, messages: [{ role: "user", content }], tools: [], maxTokens: 16000, signal }, () => {});
  if (result.stopReason === "refusal") throw new ProviderError("The model declined this request.");
  return cleanSvg(result.text);
}
