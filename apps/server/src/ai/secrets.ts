// AI provider settings and API keys in ~/.opencrease/secrets.json (0600). Keys never leave the server:
// the browser only ever sees the last four characters.
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  providerKindInfo,
  type AiDefaults,
  type AiProviderInput,
  type AiProviderKind,
  type AiProviderView,
  type AiSettingsView,
} from "@opencrease/protocol";

export interface StoredProvider {
  id: string;
  kind: AiProviderKind;
  label: string;
  baseUrl: string;
  imageModel: string;
  chatModel: string;
  apiKey: string;
}

interface SecretsFile {
  version: 1;
  providers: StoredProvider[];
  defaults: AiDefaults;
}

export class AiSettingsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function keyHint(key: string): string {
  return key ? `…${key.slice(-4)}` : "";
}

function cleanUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export class AiSecrets {
  readonly path: string;
  private cache: SecretsFile | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(configDir: string) {
    this.path = join(configDir, "secrets.json");
  }

  private async load(): Promise<SecretsFile> {
    if (this.cache) return this.cache;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.path, "utf8"));
    } catch {
      raw = {};
    }
    const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const providers: StoredProvider[] = [];
    for (const p of Array.isArray(obj.providers) ? obj.providers : []) {
      if (!p || typeof p !== "object") continue;
      const r = p as Record<string, unknown>;
      const info = providerKindInfo(str(r.kind));
      if (!info || !str(r.id)) continue;
      providers.push({
        id: str(r.id),
        kind: info.kind,
        label: str(r.label) || info.label,
        baseUrl: str(r.baseUrl),
        imageModel: str(r.imageModel),
        chatModel: str(r.chatModel),
        apiKey: str(r.apiKey),
      });
    }
    const d = (obj.defaults && typeof obj.defaults === "object" ? obj.defaults : {}) as Record<string, unknown>;
    const defaults: AiDefaults = {};
    if (str(d.image) && providers.some((p) => p.id === d.image)) defaults.image = str(d.image);
    if (str(d.chat) && providers.some((p) => p.id === d.chat)) defaults.chat = str(d.chat);
    this.cache = { version: 1, providers, defaults };
    return this.cache;
  }

  private async save(file: SecretsFile): Promise<void> {
    this.cache = file;
    const run = async () => {
      await mkdir(join(this.path, ".."), { recursive: true });
      const tmp = `${this.path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
      try {
        await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
        await chmod(tmp, 0o600);
        await rename(tmp, this.path);
        await chmod(this.path, 0o600);
      } catch (err) {
        await unlink(tmp).catch(() => {});
        throw err;
      }
    };
    this.writing = this.writing.then(run, run);
    await this.writing;
  }

  static view(p: StoredProvider): AiProviderView {
    return { id: p.id, kind: p.kind, label: p.label, baseUrl: p.baseUrl, imageModel: p.imageModel, chatModel: p.chatModel, hasKey: !!p.apiKey, keyHint: keyHint(p.apiKey) };
  }

  async settings(): Promise<AiSettingsView> {
    const f = await this.load();
    return { providers: f.providers.map(AiSecrets.view), defaults: { ...f.defaults }, secretsPath: this.path };
  }

  async providers(): Promise<StoredProvider[]> {
    return [...(await this.load()).providers];
  }

  async get(id: string): Promise<StoredProvider | undefined> {
    return (await this.load()).providers.find((p) => p.id === id);
  }

  /** The provider for a capability: the explicit id, else the default, else the first capable one. */
  async resolve(capability: "image" | "chat", id?: string): Promise<StoredProvider | undefined> {
    const f = await this.load();
    const capable = (p: StoredProvider) => providerKindInfo(p.kind)?.capabilities.includes(capability) ?? false;
    if (id) {
      const p = f.providers.find((x) => x.id === id);
      return p && capable(p) ? p : undefined;
    }
    const def = f.defaults[capability];
    const byDefault = def ? f.providers.find((p) => p.id === def && capable(p)) : undefined;
    return byDefault ?? f.providers.find(capable);
  }

  private apply(p: StoredProvider, input: AiProviderInput): void {
    const info = providerKindInfo(p.kind)!;
    if (input.label !== undefined) p.label = input.label.trim().slice(0, 80) || info.label;
    if (input.baseUrl !== undefined) p.baseUrl = cleanUrl(input.baseUrl);
    if (input.imageModel !== undefined) p.imageModel = input.imageModel.trim();
    if (input.chatModel !== undefined) p.chatModel = input.chatModel.trim();
    if (input.apiKey === null) p.apiKey = "";
    else if (typeof input.apiKey === "string" && input.apiKey.trim()) p.apiKey = input.apiKey.trim();
    if (p.baseUrl && !/^https?:\/\//i.test(p.baseUrl)) throw new AiSettingsError("The base URL must start with http:// or https://");
  }

  async create(input: AiProviderInput): Promise<AiProviderView> {
    const info = providerKindInfo(String(input.kind ?? ""));
    if (!info) throw new AiSettingsError(`Unknown provider kind "${String(input.kind)}"`);
    const f = await this.load();
    const p: StoredProvider = {
      id: `${info.kind}-${randomBytes(3).toString("hex")}`,
      kind: info.kind,
      label: info.label,
      baseUrl: info.baseUrl,
      imageModel: info.imageModels[0] ?? "",
      chatModel: info.chatModels[0] ?? "",
      apiKey: "",
    };
    this.apply(p, input);
    if (!p.baseUrl) throw new AiSettingsError(`${info.label} needs a base URL`);
    const next: SecretsFile = { ...f, providers: [...f.providers, p], defaults: { ...f.defaults } };
    if (info.capabilities.includes("image") && !next.defaults.image) next.defaults.image = p.id;
    if (info.capabilities.includes("chat") && !next.defaults.chat) next.defaults.chat = p.id;
    await this.save(next);
    return AiSecrets.view(p);
  }

  async update(id: string, input: AiProviderInput): Promise<AiProviderView> {
    const f = await this.load();
    const cur = f.providers.find((p) => p.id === id);
    if (!cur) throw new AiSettingsError(`No provider "${id}"`, 404);
    const p = { ...cur };
    this.apply(p, input);
    if (!p.baseUrl) throw new AiSettingsError("The base URL cannot be empty");
    await this.save({ ...f, providers: f.providers.map((x) => (x.id === id ? p : x)) });
    return AiSecrets.view(p);
  }

  async remove(id: string): Promise<void> {
    const f = await this.load();
    if (!f.providers.some((p) => p.id === id)) throw new AiSettingsError(`No provider "${id}"`, 404);
    const providers = f.providers.filter((p) => p.id !== id);
    const defaults: AiDefaults = {};
    for (const cap of ["image", "chat"] as const) {
      const cur = f.defaults[cap];
      if (cur && cur !== id) defaults[cap] = cur;
      else {
        const next = providers.find((p) => providerKindInfo(p.kind)?.capabilities.includes(cap));
        if (next) defaults[cap] = next.id;
      }
    }
    await this.save({ ...f, providers, defaults });
  }

  async setDefaults(input: { image?: string | null; chat?: string | null }): Promise<AiDefaults> {
    const f = await this.load();
    const defaults = { ...f.defaults };
    for (const cap of ["image", "chat"] as const) {
      const v = input[cap];
      if (v === undefined) continue;
      if (v === null || v === "") {
        delete defaults[cap];
        continue;
      }
      const p = f.providers.find((x) => x.id === v);
      if (!p) throw new AiSettingsError(`No provider "${v}"`, 404);
      if (!providerKindInfo(p.kind)?.capabilities.includes(cap)) throw new AiSettingsError(`${p.label} cannot be used for ${cap === "image" ? "images" : "the agent"}`);
      defaults[cap] = v;
    }
    await this.save({ ...f, defaults });
    return defaults;
  }
}
