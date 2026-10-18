// Workspace on disk: a directory tree containing `*.fold` directories.
//   <workspace>/<folder>/<Name>.fold/{manifest.json, document.json, assets/<hash>.<ext>, thumbnail.png, guide.md}
import { createHash, randomBytes } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createDocument, newFileId, parseFold, serializeFold } from "@opencrease/model";
import type { AssetMeta, FoldDocument } from "@opencrease/model";

export interface FileEntry {
  id: string;
  name: string;
  /** absolute path of the .fold directory */
  path: string;
  /** folder relative to the workspace root, "/"-separated, "" for the root */
  folder: string;
  /** ms since epoch (mtime of document.json) */
  updatedAt: number;
  hasThumbnail?: boolean;
}

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

const MAX_SCAN_DEPTH = 8;
export const MAX_ASSET_BYTES = 100 * 1024 * 1024;
export const MAX_EXPORT_BYTES = 1024 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "font/woff2": "woff2",
  "font/woff": "woff",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "application/pdf": "pdf",
  "application/json": "json",
  "text/plain": "txt",
};

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  pdf: "application/pdf",
  json: "application/json",
  txt: "text/plain",
};

/** Extensions that may be imported from local paths (asset:///abs/path in write_html). */
const IMPORTABLE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico", "mp4", "webm", "mov"]);

export function extForMime(mime: string, filename?: string): string {
  const clean = mime.split(";")[0]!.trim().toLowerCase();
  const fromMime = MIME_TO_EXT[clean];
  if (fromMime) return fromMime;
  const fromName = filename ? extname(filename).slice(1).toLowerCase() : "";
  if (/^[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  return "bin";
}

export function mimeForExt(ext: string): string {
  return EXT_TO_MIME[ext.toLowerCase()] ?? "application/octet-stream";
}

/** Make a display name safe as a directory name. */
export function safeDirName(name: string): string {
  let s = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "-").trim();
  s = s.replace(/^\.+/, "").replace(/[. ]+$/, "");
  if (s.length > 120) s = s.slice(0, 120).trim();
  return s || "Untitled";
}

export async function atomicWrite(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Width and height of common image formats, read from the header bytes. */
export function sniffImageSize(data: Uint8Array, mime: string): { width: number; height: number } | undefined {
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  try {
    if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) {
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (b.length >= 10 && b.toString("ascii", 0, 3) === "GIF") {
      return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    }
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = b[i + 1]!;
        const len = b.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
      return undefined;
    }
    if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
      const kind = b.toString("ascii", 12, 16);
      if (kind === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
      if (kind === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (kind === "VP8L") {
        const bits = b.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
    if (mime === "image/svg+xml") {
      const head = b.toString("utf8", 0, Math.min(b.length, 4096));
      const tag = /<svg\b[^>]*>/i.exec(head)?.[0];
      if (!tag) return undefined;
      const num = (attr: string) => {
        const m = new RegExp(`\\s${attr}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, "i").exec(tag);
        return m ? Number(m[1]) : undefined;
      };
      const w = num("width");
      const h = num("height");
      if (w && h) return { width: w, height: h };
      const vb = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
      if (vb) return { width: Number(vb[1]), height: Number(vb[2]) };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export interface WorkspaceOptions {
  /** Only these `.fold` directories (and files created later) instead of scanning the root. Used by headless mode. */
  files?: string[];
  /** Write exports straight into this directory instead of `<root>/Exports/<file name>/`. */
  exportDir?: string;
}

export class Workspace {
  readonly root: string;
  private index = new Map<string, FileEntry>();
  private locks = new Map<string, Promise<unknown>>();
  private pinned: Set<string> | null;
  exportRoot: string | null;

  constructor(root: string, opts: WorkspaceOptions = {}) {
    this.root = resolve(root);
    this.pinned = opts.files ? new Set(opts.files.map((f) => resolve(f))) : null;
    this.exportRoot = opts.exportDir ? resolve(opts.exportDir) : null;
  }

  static async open(root: string, opts: WorkspaceOptions = {}): Promise<Workspace> {
    const ws = new Workspace(root, opts);
    await mkdir(ws.root, { recursive: true });
    await ws.scan();
    return ws;
  }

  get trashDir(): string {
    return join(this.root, ".trash");
  }

  /** Serialise mutations per file. */
  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }

  // ----- index ---------------------------------------------------------------

  /** Rebuild the id index by scanning the workspace. */
  async scan(): Promise<FileEntry[]> {
    const found = new Map<string, FileEntry>();
    if (this.pinned) {
      for (const dir of this.pinned) {
        const entry = await this.readEntry(dir);
        if (entry && !found.has(entry.id)) found.set(entry.id, entry);
      }
      this.index = found;
      return [...found.values()];
    }
    const walk = async (dir: string, depth: number): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
        const full = join(dir, e.name);
        if (e.name.endsWith(".fold")) {
          const entry = await this.readEntry(full);
          if (!entry) continue;
          if (found.has(entry.id)) {
            console.warn(`[opencrease] duplicate file id ${entry.id} in ${full}, ignoring it`);
            continue;
          }
          found.set(entry.id, entry);
        } else if (depth < MAX_SCAN_DEPTH) {
          await walk(full, depth + 1);
        }
      }
    };
    await walk(this.root, 0);
    this.index = found;
    return [...found.values()];
  }

  private async readEntry(dir: string): Promise<FileEntry | undefined> {
    let id: unknown;
    let name: unknown;
    try {
      const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
      id = manifest.id ?? manifest.fileId;
      name = manifest.name;
    } catch {
      // fall back to document.json
    }
    if (typeof id !== "string") {
      try {
        const doc = JSON.parse(await readFile(join(dir, "document.json"), "utf8"));
        id = doc.id;
        name = doc.name;
      } catch {
        return undefined;
      }
    }
    if (typeof id !== "string" || !id) return undefined;
    let updatedAt = 0;
    try {
      updatedAt = Math.round((await stat(join(dir, "document.json"))).mtimeMs);
    } catch {
      return undefined;
    }
    const rel = relative(this.root, dirname(dir));
    return {
      id,
      name: typeof name === "string" && name ? name : basename(dir, ".fold"),
      path: dir,
      folder: rel.startsWith("..") || isAbsolute(rel) ? "" : rel.split(sep).filter(Boolean).join("/"),
      updatedAt,
      hasThumbnail: await stat(join(dir, "thumbnail.png")).then((s) => s.isFile(), () => false),
    };
  }

  /** All files (rescans the workspace). */
  async list(): Promise<FileEntry[]> {
    return this.scan();
  }

  /** Cached entries without rescanning. */
  cached(): FileEntry[] {
    return [...this.index.values()];
  }

  async find(id: string): Promise<FileEntry | undefined> {
    const hit = this.index.get(id);
    if (hit && (await exists(join(hit.path, "document.json")))) return hit;
    await this.scan();
    return this.index.get(id);
  }

  async require(id: string): Promise<FileEntry> {
    const entry = await this.find(id);
    if (!entry) throw new WorkspaceError(`No file with id "${id}" in the workspace`, 404);
    return entry;
  }

  // ----- files ---------------------------------------------------------------

  private resolveFolder(folder?: string): string {
    if (!folder) return this.root;
    if (isAbsolute(folder) || folder.split(/[/\\]/).some((s) => s === ".." || s.startsWith("."))) {
      throw new WorkspaceError("folder must be a relative path inside the workspace");
    }
    const dir = resolve(this.root, folder);
    if (dir !== this.root && !dir.startsWith(this.root + sep)) {
      throw new WorkspaceError("folder must be inside the workspace");
    }
    return dir;
  }

  private async uniqueDir(parent: string, name: string, except?: string): Promise<string> {
    const base = safeDirName(name);
    for (let n = 1; ; n++) {
      const candidate = join(parent, `${n === 1 ? base : `${base} ${n}`}.fold`);
      if (candidate === except) return candidate;
      if (!(await exists(candidate))) return candidate;
    }
  }

  private async writeDocFiles(dir: string, doc: FoldDocument): Promise<void> {
    const { manifest, documentJson } = serializeFold(doc);
    await atomicWrite(join(dir, "document.json"), documentJson);
    await atomicWrite(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  private async refreshEntry(dir: string): Promise<FileEntry> {
    const entry = await this.readEntry(dir);
    if (!entry) throw new WorkspaceError(`Could not read ${dir}`, 500);
    this.pinned?.add(resolve(dir));
    this.index.set(entry.id, entry);
    return entry;
  }

  async create(opts: { name?: string; cloneFileId?: string; folder?: string } = {}): Promise<FileEntry> {
    const now = Date.now();
    const id = newFileId();
    if (opts.cloneFileId) {
      const src = await this.require(opts.cloneFileId);
      const srcDoc = await this.readDocument(src.id);
      const name = opts.name?.trim() || `${srcDoc.name} copy`;
      const parent = opts.folder !== undefined ? this.resolveFolder(opts.folder) : dirname(src.path);
      await mkdir(parent, { recursive: true });
      const dir = await this.uniqueDir(parent, name);
      await cp(src.path, dir, { recursive: true });
      // a copy starts its own version history
      await rm(join(dir, "history"), { recursive: true, force: true });
      const doc: FoldDocument = { ...structuredClone(srcDoc), id, name, createdAt: now, updatedAt: now };
      await this.writeDocFiles(dir, doc);
      return this.refreshEntry(dir);
    }
    const name = opts.name?.trim() || "Untitled";
    const parent = this.resolveFolder(opts.folder);
    await mkdir(parent, { recursive: true });
    const dir = await this.uniqueDir(parent, name);
    await mkdir(dir, { recursive: true });
    await this.writeDocFiles(dir, createDocument(name, { id, now }));
    return this.refreshEntry(dir);
  }

  async readDocument(id: string): Promise<FoldDocument> {
    const entry = await this.require(id);
    const json = await readFile(join(entry.path, "document.json"), "utf8");
    return parseFold(json);
  }

  /** Validate and persist a whole document. Renames the directory if the name changed. */
  async writeDocument(id: string, input: unknown): Promise<{ updatedAt: number; entry: FileEntry; doc: FoldDocument }> {
    if (!input || typeof input !== "object") throw new WorkspaceError("Body must be a FoldDocument object");
    if ((input as { id?: unknown }).id !== id) throw new WorkspaceError("Document id does not match the URL");
    let doc: FoldDocument;
    try {
      doc = parseFold(JSON.stringify(input));
    } catch (err) {
      throw new WorkspaceError(`Invalid document: ${(err as Error).message}`);
    }
    return this.withLock(id, async () => {
      const entry = await this.require(id);
      let dir = entry.path;
      if (doc.name !== entry.name) dir = await this.moveDir(entry, doc.name);
      await this.writeDocFiles(dir, doc);
      const fresh = await this.refreshEntry(dir);
      return { updatedAt: doc.updatedAt, entry: fresh, doc };
    });
  }

  private async moveDir(entry: FileEntry, name: string): Promise<string> {
    if (basename(entry.path, ".fold") === safeDirName(name)) return entry.path;
    const target = await this.uniqueDir(dirname(entry.path), name, entry.path);
    if (target !== entry.path) await rename(entry.path, target);
    return target;
  }

  async rename(id: string, rawName: string): Promise<FileEntry> {
    const name = rawName.trim().slice(0, 500);
    if (!name) return this.require(id);
    return this.withLock(id, async () => {
      const entry = await this.require(id);
      const doc = await this.readDocument(id);
      doc.name = name;
      doc.updatedAt = Date.now();
      const dir = await this.moveDir(entry, name);
      await this.writeDocFiles(dir, doc);
      return this.refreshEntry(dir);
    });
  }

  /** Move a file to <workspace>/.trash/. */
  async delete(id: string): Promise<{ trashedTo: string }> {
    return this.withLock(id, async () => {
      const entry = await this.require(id);
      await mkdir(this.trashDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const target = join(this.trashDir, `${basename(entry.path, ".fold")} ${stamp}.fold`);
      await rename(entry.path, target);
      this.index.delete(id);
      return { trashedTo: target };
    });
  }

  // ----- thumbnails ------------------------------------------------------------

  async readThumbnail(id: string): Promise<Buffer | null> {
    const entry = await this.require(id);
    try {
      return await readFile(join(entry.path, "thumbnail.png"));
    } catch {
      return null;
    }
  }

  async writeThumbnail(id: string, data: Uint8Array): Promise<void> {
    const entry = await this.require(id);
    await atomicWrite(join(entry.path, "thumbnail.png"), data);
    entry.hasThumbnail = true;
  }

  // ----- assets ----------------------------------------------------------------

  async addAsset(id: string, data: Uint8Array, mime: string, filename?: string): Promise<AssetMeta> {
    if (data.byteLength > MAX_ASSET_BYTES) throw new WorkspaceError("Asset is larger than 100 MB", 413);
    const entry = await this.require(id);
    const cleanMime = (mime.split(";")[0] || "application/octet-stream").trim().toLowerCase();
    const hash = createHash("sha256").update(data).digest("hex");
    const ext = extForMime(cleanMime, filename);
    const dir = join(entry.path, "assets");
    await mkdir(dir, { recursive: true });
    const target = join(dir, `${hash}.${ext}`);
    if (!(await exists(target))) await atomicWrite(target, data);
    const meta: AssetMeta = { hash, mime: cleanMime, size: data.byteLength };
    if (filename) meta.name = basename(filename);
    const size = sniffImageSize(data, cleanMime);
    if (size && size.width > 0 && size.height > 0) {
      meta.width = size.width;
      meta.height = size.height;
    }
    return meta;
  }

  async readAsset(id: string, hash: string): Promise<{ data: Buffer; mime: string; path: string } | null> {
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    const entry = await this.require(id);
    const dir = join(entry.path, "assets");
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return null;
    }
    const file = names.find((n) => n.startsWith(`${hash}.`) || n === hash);
    if (!file) return null;
    const path = join(dir, file);
    return { data: await readFile(path), mime: mimeForExt(extname(file).slice(1)), path };
  }

  /** Copy a local media file into the file's assets (used for asset:///abs/path in agent HTML). */
  async importLocalAsset(id: string, path: string): Promise<AssetMeta> {
    const ext = extname(path).slice(1).toLowerCase();
    if (!IMPORTABLE_EXTS.has(ext)) throw new WorkspaceError(`Only image and video files can be used as assets: ${path}`);
    let info;
    try {
      info = await stat(path);
    } catch {
      throw new WorkspaceError(`File not found: ${path}`, 404);
    }
    if (!info.isFile()) throw new WorkspaceError(`Not a file: ${path}`);
    if (info.size > MAX_ASSET_BYTES) throw new WorkspaceError(`Asset is larger than 100 MB: ${path}`, 413);
    return this.addAsset(id, await readFile(path), mimeForExt(ext), basename(path));
  }

  // ----- exports ----------------------------------------------------------------

  /** Directory that holds exported images and PDFs of a file: `<workspace>/Exports/<file name>/`. */
  async exportDir(id: string): Promise<string> {
    const entry = await this.require(id);
    return this.exportRoot ?? join(this.root, "Exports", safeDirName(entry.name));
  }

  /** Write an exported file (image, PDF, video) and return its absolute path. Same name overwrites. */
  async writeExport(id: string, filename: string, data: Uint8Array): Promise<string> {
    if (data.byteLength > MAX_EXPORT_BYTES) throw new WorkspaceError("Export is larger than 1 GB", 413);
    const raw = basename(filename.replace(/\\/g, "/"));
    const ext = extname(raw);
    const stem = safeDirName(ext ? raw.slice(0, -ext.length) : raw);
    const cleanExt = /^\.[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : "";
    const dir = await this.exportDir(id);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${stem}${cleanExt}`);
    await atomicWrite(path, data);
    return path;
  }

  // ----- per-file guide --------------------------------------------------------

  async guidePath(id: string): Promise<string> {
    return join((await this.require(id)).path, "guide.md");
  }

  async readGuide(id: string): Promise<string> {
    try {
      return await readFile(await this.guidePath(id), "utf8");
    } catch (err) {
      if (err instanceof WorkspaceError) throw err;
      return "";
    }
  }

  async writeGuide(id: string, content: string): Promise<void> {
    const path = await this.guidePath(id);
    if (!content.trim()) {
      await rm(path, { force: true });
      return;
    }
    await atomicWrite(path, content);
  }
}
