import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "./test-utils";
import { extForMime, safeDirName, sniffImageSize, Workspace } from "./workspace";

// 1x1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("Workspace", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let ws: Workspace;

  beforeEach(async () => {
    ({ dir, cleanup } = await tempDir());
    ws = await Workspace.open(join(dir, "ws"));
  });
  afterEach(() => cleanup());

  it("creates files on disk and finds them by id", async () => {
    const entry = await ws.create({ name: "Landing page" });
    expect(entry.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(entry.path).toBe(join(ws.root, "Landing page.fold"));
    expect(entry.folder).toBe("");
    const manifest = JSON.parse(await readFile(join(entry.path, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ formatVersion: 1, id: entry.id, name: "Landing page", app: "opencrease 0.1.0" });
    const doc = await ws.readDocument(entry.id);
    expect(doc.name).toBe("Landing page");
    expect(doc.pageList).toHaveLength(1);

    const fresh = await Workspace.open(ws.root);
    expect((await fresh.list()).map((f) => f.id)).toEqual([entry.id]);
  });

  it("uses unique, safe directory names and folders", async () => {
    const a = await ws.create({ name: "A/B: test" });
    const b = await ws.create({ name: "A/B: test" });
    expect(a.path.endsWith("A-B- test.fold")).toBe(true);
    expect(b.path.endsWith("A-B- test 2.fold")).toBe(true);
    const c = await ws.create({ name: "Nested", folder: "client/one" });
    expect(c.folder).toBe("client/one");
    await expect(ws.create({ name: "x", folder: "../escape" })).rejects.toThrow();
    expect(safeDirName("..hidden")).toBe("hidden");
    expect(safeDirName("   ")).toBe("Untitled");
  });

  it("ignores dot directories and non-fold directories while scanning", async () => {
    await ws.create({ name: "Visible" });
    await mkdir(join(ws.root, ".hidden", "Secret.fold"), { recursive: true });
    await writeFile(join(ws.root, ".hidden", "Secret.fold", "manifest.json"), JSON.stringify({ id: "X", name: "Secret" }));
    await writeFile(join(ws.root, ".hidden", "Secret.fold", "document.json"), "{}");
    await mkdir(join(ws.root, "Broken.fold"));
    const names = (await ws.list()).map((f) => f.name);
    expect(names).toEqual(["Visible"]);
  });

  it("writes documents atomically and renames the directory with the document", async () => {
    const entry = await ws.create({ name: "Draft" });
    const doc = await ws.readDocument(entry.id);
    doc.name = "Final";
    doc.updatedAt = 1234;
    const { updatedAt, entry: after } = await ws.writeDocument(entry.id, doc);
    expect(updatedAt).toBe(1234);
    expect(after.path).toBe(join(ws.root, "Final.fold"));
    expect(existsSync(entry.path)).toBe(false);
    expect((await ws.readDocument(entry.id)).name).toBe("Final");
    expect((await readdir(after.path)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    await expect(ws.writeDocument(entry.id, { ...doc, id: "OTHER" })).rejects.toThrow(/does not match/);
  });

  it("renames, clones and deletes into the trash", async () => {
    const entry = await ws.create({ name: "One" });
    const renamed = await ws.rename(entry.id, "  Two  ");
    expect(renamed.name).toBe("Two");
    expect((await ws.readDocument(entry.id)).name).toBe("Two");
    expect((await ws.rename(entry.id, "   ")).name).toBe("Two");

    await ws.addAsset(entry.id, PNG, "image/png", "dot.png");
    const clone = await ws.create({ cloneFileId: entry.id });
    expect(clone.id).not.toBe(entry.id);
    expect(clone.name).toBe("Two copy");
    const cloneDoc = await ws.readDocument(clone.id);
    expect(cloneDoc.id).toBe(clone.id);
    expect(await readdir(join(clone.path, "assets"))).toHaveLength(1);

    await ws.delete(entry.id);
    expect(await ws.find(entry.id)).toBeUndefined();
    const trash = await readdir(ws.trashDir);
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatch(/^Two .+\.fold$/);
    expect((await ws.list()).map((f) => f.id)).toEqual([clone.id]);
  });

  it("stores assets by sha256 with an extension from the mime type", async () => {
    const entry = await ws.create({ name: "Assets" });
    const meta = await ws.addAsset(entry.id, PNG, "image/png", "dot.png");
    expect(meta).toMatchObject({ mime: "image/png", size: PNG.length, name: "dot.png", width: 1, height: 1 });
    expect(meta.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(entry.path, "assets", `${meta.hash}.png`))).toBe(true);
    const again = await ws.addAsset(entry.id, PNG, "image/png");
    expect(again.hash).toBe(meta.hash);
    const read = await ws.readAsset(entry.id, meta.hash);
    expect(read?.mime).toBe("image/png");
    expect(read?.data.equals(PNG)).toBe(true);
    expect(await ws.readAsset(entry.id, "../../etc/passwd")).toBeNull();

    const local = join(dir, "photo.png");
    await writeFile(local, PNG);
    expect((await ws.importLocalAsset(entry.id, local)).hash).toBe(meta.hash);
    await expect(ws.importLocalAsset(entry.id, join(dir, "secret.txt"))).rejects.toThrow(/image and video/);
  });

  it("reads and writes thumbnails and per-file guides", async () => {
    const entry = await ws.create({ name: "Thumbs" });
    expect(await ws.readThumbnail(entry.id)).toBeNull();
    expect((await ws.list()).find((f) => f.id === entry.id)?.hasThumbnail).toBe(false);
    await ws.writeThumbnail(entry.id, PNG);
    expect((await ws.readThumbnail(entry.id))?.equals(PNG)).toBe(true);
    expect((await ws.list()).find((f) => f.id === entry.id)?.hasThumbnail).toBe(true);
    expect(await ws.readGuide(entry.id)).toBe("");
    await ws.writeGuide(entry.id, "Use warm colours.");
    expect(await ws.readGuide(entry.id)).toBe("Use warm colours.");
  });
});

describe("helpers", () => {
  it("maps mime types to extensions", () => {
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/svg+xml; charset=utf-8")).toBe("svg");
    expect(extForMime("application/x-unknown", "font.woff2")).toBe("woff2");
    expect(extForMime("application/x-unknown")).toBe("bin");
  });

  it("sniffs image sizes", () => {
    expect(sniffImageSize(PNG, "image/png")).toEqual({ width: 1, height: 1 });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16"><path d="M0 0"/></svg>');
    expect(sniffImageSize(svg, "image/svg+xml")).toEqual({ width: 24, height: 16 });
    const gif = Buffer.from("R0lGODlhAgADAIAAAP///wAAACwAAAAAAgADAAACAoRRADs=", "base64");
    expect(sniffImageSize(gif, "image/gif")).toEqual({ width: 2, height: 3 });
  });
});
