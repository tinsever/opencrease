// Pure helpers for AI images on nodes: find pending gen:// URLs, the current image, and style patches.
import type { GenSpec, OFNode, StyleMap } from "@opencrease/model";
import { genUrlsInCss, isGenUrl, parseGenUrl, type GenUrlSpec } from "@opencrease/protocol";

export type GenTarget = "src" | "fill";

export interface PendingGen {
  target: GenTarget;
  /** the gen:// URL as written in the node */
  url: string;
  spec: GenUrlSpec;
}

const BG_KEYS = ["backgroundImage", "background"] as const;

/** A gen:// URL in the node that has not been generated yet (src first, then the background). */
export function pendingGen(node: OFNode): PendingGen | null {
  if (node.type === "Image" && node.src && isGenUrl(node.src)) {
    const spec = parseGenUrl(node.src);
    return spec ? { target: "src", url: node.src, spec } : null;
  }
  for (const k of BG_KEYS) {
    const v = node.styles[k];
    if (typeof v !== "string") continue;
    for (const url of genUrlsInCss(v)) {
      const spec = parseGenUrl(url);
      if (spec) return { target: "fill", url, spec };
    }
  }
  return null;
}

/** The node's current (already generated or uploaded) image, used for regenerate and edits. */
export function currentImage(node: OFNode): { target: GenTarget; url: string } | null {
  if (node.type === "Image") return node.src && !isGenUrl(node.src) ? { target: "src", url: node.src } : null;
  for (const k of BG_KEYS) {
    const v = node.styles[k];
    if (typeof v !== "string") continue;
    for (const m of v.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
      if (!isGenUrl(m[2]!)) return { target: "fill", url: m[2]! };
    }
  }
  return null;
}

/** Asset hash in an asset://, /api/files/…/assets/… or bare-hash reference. */
export function assetHashOf(url: string): string | undefined {
  return /^asset:\/\/([a-f0-9]{64})/.exec(url)?.[1] ?? /\/assets\/([a-f0-9]{64})/.exec(url)?.[1];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Style patch that swaps `oldUrl` for `newUrl` inside url(...) in background/backgroundImage.
 * Returns null when oldUrl is not used there.
 */
export function replaceFillUrl(styles: StyleMap, oldUrl: string, newUrl: string): Record<string, string> | null {
  const re = new RegExp(`url\\(\\s*(['"]?)${escapeRe(oldUrl)}\\1\\s*\\)`, "g");
  const patch: Record<string, string> = {};
  for (const k of BG_KEYS) {
    const v = styles[k];
    re.lastIndex = 0;
    if (typeof v !== "string" || !re.test(v)) continue;
    re.lastIndex = 0;
    patch[k] = v.replace(re, `url("${newUrl}")`);
  }
  return Object.keys(patch).length ? patch : null;
}

/** Style patch that makes `url` the node's top image fill, covering the box, keeping colours underneath. */
export function setFillImage(styles: StyleMap, url: string): Record<string, string> {
  const layer = `url("${url}")`;
  const patch: Record<string, string> = { backgroundImage: layer };
  if (styles.backgroundSize === undefined) patch.backgroundSize = "cover";
  if (styles.backgroundPosition === undefined) patch.backgroundPosition = "center";
  if (styles.backgroundRepeat === undefined) patch.backgroundRepeat = "no-repeat";
  return patch;
}

/** The gen spec stored on the node after a generation. */
export function genSpec(input: { prompt: string; target: GenTarget; provider?: string; model?: string; seed?: number; width?: number; height?: number; edit?: boolean }): GenSpec {
  const out: GenSpec = { prompt: input.prompt, target: input.target };
  if (input.provider) out.provider = input.provider;
  if (input.model) out.model = input.model;
  if (typeof input.seed === "number") out.seed = input.seed;
  if (input.width) out.width = Math.round(input.width);
  if (input.height) out.height = Math.round(input.height);
  if (input.edit) out.edit = true;
  return out;
}

/** Which target a new generation should use for this node. */
export function defaultTarget(node: OFNode | undefined): GenTarget | "new" {
  if (!node || node.type === "Root") return "new";
  if (node.type === "Image") return "src";
  if (node.type === "Frame" || node.type === "Rectangle") return "fill";
  return "new";
}

/** Pending generation URLs are placeholders, not resources the browser can fetch. */
export function pendingImageStyle(value: string): string {
  return value.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi, (whole, _quote: string, url: string) =>
    isGenUrl(url) ? "linear-gradient(transparent, transparent)" : whole,
  );
}
