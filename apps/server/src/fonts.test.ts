import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compactMetadata, FontCache } from "./fonts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "of-fonts-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const route = Object.keys(routes).find((k) => url.startsWith(k));
    if (!route) throw new Error("offline");
    return routes[route]();
  }) as typeof fetch;
  return { impl, calls };
}

const CSS = "@font-face { font-family: 'Inter'; src: url(https://fonts.gstatic.com/s/inter/v1/a.woff2) format('woff2'); }";

describe("FontCache", () => {
  it("rewrites font URLs to the proxy and caches stylesheets", async () => {
    const { impl, calls } = fakeFetch({ "https://fonts.googleapis.com/css2": () => new Response(CSS) });
    const cache = new FontCache(dir, impl);
    const a = await cache.stylesheet("css2", "family=Inter");
    expect(a?.css).toContain("url(/api/fonts/files/s/inter/v1/a.woff2)");
    await cache.stylesheet("css2", "family=Inter");
    expect(calls).toHaveLength(1);
  });

  it("serves stale stylesheets when offline and null when never fetched", async () => {
    const online = new FontCache(dir, fakeFetch({ "https://fonts.googleapis.com/css2": () => new Response(CSS) }).impl);
    await online.stylesheet("css2", "family=Inter");
    // age the cache past the refresh window
    const { readdir } = await import("node:fs/promises");
    const [file] = await readdir(join(dir, "css"));
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    await utimes(join(dir, "css", file), old, old);
    const offline = new FontCache(dir, fakeFetch({}).impl);
    expect(await offline.stylesheet("css2", "family=Inter")).toMatchObject({ offline: true });
    expect(await offline.stylesheet("css2", "family=Nope")).toBeNull();
  });

  it("stores font files once and refuses paths outside the cache", async () => {
    const { impl, calls } = fakeFetch({ "https://fonts.gstatic.com/": () => new Response(new Uint8Array([1, 2, 3])) });
    const cache = new FontCache(dir, impl);
    expect([...(await cache.file("s/inter/v1/a.woff2"))!]).toEqual([1, 2, 3]);
    expect([...(await new FontCache(dir, fakeFetch({}).impl).file("s/inter/v1/a.woff2"))!]).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(1);
    expect(await cache.file("../../etc/passwd")).toBeNull();
    // subset files keep their query, and different queries are different files
    await cache.file("l/font", "?kit=abc");
    expect(calls.at(-1)).toBe("https://fonts.gstatic.com/l/font?kit=abc");
    await cache.file("l/font", "?kit=abc");
    await cache.file("l/font", "?kit=xyz");
    expect(calls).toHaveLength(3);
  });

  it("compacts Google metadata to families, styles and axes", () => {
    const list = compactMetadata({
      familyMetadataList: [{ family: "Fraunces", category: "Serif", popularity: 86, fonts: { "400": {}, "400i": {} }, axes: [{ tag: "opsz", min: 9, max: 144, defaultValue: 14 }] }],
    });
    expect(list).toEqual([{ family: "Fraunces", category: "Serif", styles: ["400", "400i"], axes: [{ tag: "opsz", min: 9, max: 144, defaultValue: 14 }], popularity: 86 }]);
  });
});
