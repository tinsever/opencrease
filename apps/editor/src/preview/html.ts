import geist from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
import geistMono from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url";
import { IMAGE_HOSTS, nodeToHtml, safeCssValue } from "@opencrease/css";
import { themeToCss, type FoldDocument } from "@opencrease/model";
import { collectFontUsage, googleFontsUrl, proxiedFontsUrl } from "../canvas/fonts";
import { familyInfo, variableFontQuery } from "../canvas/font-meta";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Existing HTML export in a script-free page, with canvas positioning removed only from the root. */
export function previewHtml(doc: FoldDocument, nodeId: string, origin: string): string {
  const node = doc.nodes[nodeId];
  if (!node) throw new Error("This artboard was removed. Open Preview again from the editor.");
  const styles = { ...node.styles, position: "relative", left: 0, top: 0 };
  delete (styles as Record<string, unknown>).right;
  delete (styles as Record<string, unknown>).bottom;
  const safeDoc = { ...doc, nodes: { ...doc.nodes, [nodeId]: { ...node, styles } }, tokens: doc.tokens.filter((t) => /^--[\w-]+$/.test(t.name) && safeCssValue(t.value) && Object.values(t.modes ?? {}).every(safeCssValue)) };
  const html = nodeToHtml(safeDoc, nodeId).replace(/asset:\/\/([a-f0-9]+)/g, (_all, hash: string) => `${origin}/api/files/${encodeURIComponent(doc.id)}/assets/${hash}`);
  const links = [...collectFontUsage(doc)].map(([family, variants]) => {
    const info = familyInfo(family);
    const url = info?.axes.length ? `/api/fonts/css2?${variableFontQuery(info, [...variants].some((v) => v.startsWith("1,")))}` : proxiedFontsUrl(googleFontsUrl(family, variants));
    return `<link rel="stylesheet" href="${escape(origin + url)}">`;
  }).join("");
  const font = (family: string, url: string) => `@font-face{font-family:"${family}";font-style:normal;font-weight:100 900;src:url("${new URL(url, origin).href}") format("woff2")}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${origin}; font-src data: ${origin} https://fonts.gstatic.com; img-src data: blob: ${origin} ${IMAGE_HOSTS.map((h) => `https://${h}`).join(" ")}; base-uri 'none'; form-action 'none'"><title>${escape(node.name)}</title>${links}<style>${font("Geist Variable", geist)}${font("Geist", geist)}${font("Geist Mono Variable", geistMono)}${font("Geist Mono", geistMono)}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:"Geist Variable",sans-serif;font-size:16px;color:#000;background:#fff}${themeToCss(safeDoc).replace(/</g, "\\3c ")}</style></head><body>${html}</body></html>`;
}
