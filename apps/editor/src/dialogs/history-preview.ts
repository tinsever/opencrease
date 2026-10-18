import geistFont from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline";
import { nodeToHtml, safeCssValue, IMAGE_HOSTS } from "@opencrease/css";
import { tokenCssVars, type FoldDocument } from "@opencrease/model";

/** Static, script-free snapshot for an opaque-origin sandbox. Images use the authenticated parent origin. */
export function historyPreview(doc: FoldDocument, highlights: string[], origin: string, pageId?: string, images: Record<string, string> = {}): string {
  const copy = structuredClone(doc);
  const roots = [copy.pages[pageId ?? ""] ?? Object.values(copy.pages)[0]].filter(Boolean).map((p) => p.rootId);
  const nodes = roots.flatMap((id) => copy.nodes[id]?.children ?? []).map((id) => copy.nodes[id]);
  const number = (v: unknown, fallback = 0) => Number.parseFloat(String(v)) || fallback;
  const minX = Math.min(0, ...nodes.map((n) => number(n.styles.left)));
  const minY = Math.min(0, ...nodes.map((n) => number(n.styles.top)));
  const width = Math.max(1, ...nodes.map((n) => number(n.styles.left) + number(n.styles.width, 400))) - minX;
  const height = Math.max(1, ...nodes.map((n) => number(n.styles.top) + number(n.styles.height, 400))) - minY;
  const html = roots.map((id) => nodeToHtml(copy, id, { includeNodeIds: true })).join("\n").replace(/asset:\/\/([a-f0-9]+)/g, (url, hash: string) => images[hash] ?? url);
  const vars = Object.entries(tokenCssVars(doc)).filter(([k, v]) => /^--[\w-]+$/.test(k) && safeCssValue(v)).map(([k, v]) => `${k}:${v}`).join(";");
  const marked = highlights.filter((id) => /^[\w-]+$/.test(id)).map((id) => `[data-of-id="${id}"]`).join(",");
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: ${origin} ${IMAGE_HOSTS.map((h) => `https://${h}`).join(" ")}; base-uri 'none'; form-action 'none'"><style>@font-face{font-family:"Geist Variable";font-style:normal;font-weight:100 900;src:url("${geistFont}") format("woff2")}*{box-sizing:border-box}body{margin:16px;${vars}}.stage{width:${width}px;height:${height}px;zoom:min(1,calc((100vw - 32px) / ${width}px))}.world{position:relative;left:${-minX}px;top:${-minY}px}${marked ? `${marked}{outline:3px solid #d97706 !important;outline-offset:2px}` : ""}</style><div class="stage"><div class="world">${html}</div></div>`;
}

/** Fetch local images in the authenticated parent, then pass only inert image bytes into the sandbox. */
export async function historyImages(fileId: string, docs: FoldDocument[]): Promise<Record<string, string>> {
  const hashes = new Set<string>();
  for (const doc of docs) for (const node of Object.values(doc.nodes)) {
    const input = JSON.stringify([node.src, node.styles, node.attrs]);
    for (const m of input.matchAll(/asset:\/\/([a-f0-9]+)/g)) hashes.add(m[1]);
  }
  const entries = await Promise.all([...hashes].map(async (hash) => {
    try {
      const response = await fetch(`/api/files/${encodeURIComponent(fileId)}/assets/${hash}`);
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) return null;
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
      return [hash, data] as const;
    } catch { return null; }
  }));
  return Object.fromEntries(entries.filter((e): e is readonly [string, string] => e !== null));
}
