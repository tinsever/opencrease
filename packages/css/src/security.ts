// One network policy for imported HTML and the live renderer. Exact hosts only.
export const IMAGE_HOSTS = ["images.unsplash.com", "plus.unsplash.com", "images.pexels.com", "images.pixabay.com", "cdn.pixabay.com"] as const;
export const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"] as const;
export const SVG_TAGS = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "image", "use", "text", "tspan", "title", "desc", "symbol", "marker", "filter", "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix", "feComposite", "feFlood", "feMerge", "feMergeNode", "feDropShadow", "feTurbulence", "feDisplacementMap"]);

export function safeImageUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value || /[\u0000-\u0020\\]/.test(value)) return false;
  if (/^#[\w-]+$/.test(value)) return true;
  if (/^(?:paper-)?(?:asset|gen):\/\//i.test(value)) return true;
  if (/^data:image\/(?:png|jpeg|jpg|gif|webp|avif|svg\+xml)[;,]/i.test(value)) return true;
  if (/^blob:https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//.test(value)) return true;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/api/")) return /^\/api\/files\/[^/?#]+\/assets\/[a-f0-9]+(?:\.[a-z0-9]+)?$/i.test(value);
  if (!/^[a-z][a-z\d+.-]*:/i.test(value)) return !value.startsWith("/") || !value.startsWith("/auth");
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && IMAGE_HOSTS.some((h) => h === u.hostname);
  } catch { return false; }
}

/** Reject encoded CSS syntax and every URL that is outside the image policy. */
export function safeCssValue(value: string | number): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (/\\|\/\*|expression\s*\(|(?:-webkit-)?image-set\s*\(|image\s*\(|@import|javascript\s*:|[<>{}\u0000]/i.test(value)) return false;
  const urls = [...value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)];
  if ((value.match(/url\s*\(/gi)?.length ?? 0) !== urls.length) return false;
  const outsideUrls = value.replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi, "");
  if (outsideUrls.includes(";")) return false;
  return urls.every((m) => safeImageUrl((m[1] ?? m[2] ?? m[3]).trim()));
}

export function safeSvgAttrs(attrs: Record<string, string>, tag: string): Record<string, string> {
  return Object.fromEntries(Object.entries(attrs).filter(([name, value]) => {
    const key = name.toLowerCase();
    if (!/^[a-z][\w:.-]*$/i.test(name) || key.startsWith("on") || ["style", "srcdoc", "src", "is", "xmlns:xlink", "xml:base"].includes(key)) return false;
    if (key === "href" || key === "xlink:href") return tag === "image" ? safeImageUrl(value) : /^#[\w-]+$/.test(value);
    return safeCssValue(value);
  }));
}
