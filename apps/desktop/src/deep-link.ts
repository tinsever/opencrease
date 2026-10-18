// opencrease:// deep links. Only two shapes are accepted, everything else is ignored:
//   opencrease://file/<fileId>[/<pageId>]   open a file (and page)
//   opencrease://home                        show the files home
// Ids are limited to letters, digits, "-" and "_", so a link can never smuggle a path, a query
// or another origin into the editor URL.

export const PROTOCOL = "opencrease";
const MAX_LENGTH = 512;
// Matched against the raw string (not a parsed URL, which would resolve "..", decode escapes and
// accept credentials or ports).
const FILE_LINK = /^opencrease:\/\/file\/([A-Za-z0-9_-]{1,128})(?:\/([A-Za-z0-9_-]{1,128}))?\/?$/i;
const HOME_LINK = /^opencrease:\/\/home\/?$/i;

/** Editor path for a deep link ("/file/<id>/<page>" or "/"), or null when the link is not valid. */
export function parseDeepLink(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_LENGTH) return null;
  if (HOME_LINK.test(raw)) return "/";
  const m = FILE_LINK.exec(raw);
  if (!m) return null;
  return m[2] ? `/file/${m[1]}/${m[2]}` : `/file/${m[1]}`;
}

/** The first valid deep link among command line arguments (Windows and Linux pass links this way). */
export function deepLinkFromArgv(argv: readonly string[]): string | null {
  for (const a of argv) {
    if (a.toLowerCase().startsWith(`${PROTOCOL}://`)) {
      const path = parseDeepLink(a);
      if (path) return path;
    }
  }
  return null;
}
