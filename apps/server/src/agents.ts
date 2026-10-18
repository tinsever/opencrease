// Agent permissions (SPEC §8.3): the first time an MCP client calls a tool, the editor asks the user
// "Allow <client> to read and edit your designs?". The answer is remembered per client name in
// <userConfigDir>/agents.json and can be revoked in Settings, Agents.
//
// Client names come from the MCP initialize handshake, so they identify an agent for consent, not
// for security: the session token is what keeps other programs out.
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentClientInfo } from "@opencrease/protocol";
import { atomicWrite } from "./workspace";

export type AgentDecision = "allow" | "deny";

export interface AgentRecord {
  name: string;
  decision: AgentDecision;
  decidedAt: number;
  lastSeen?: number;
  version?: string;
}

/** Asks the user; resolves true/false, or null when nobody answered. */
export type AskUser = (client: AgentClientInfo) => Promise<boolean | null>;

export class AgentApprovals {
  private records = new Map<string, AgentRecord>();
  private loaded: Promise<void> | null = null;
  private asking = new Map<string, Promise<boolean | null>>();
  private seenDirty = false;

  constructor(
    readonly configDir: string,
    private now: () => number = Date.now,
  ) {}

  get path(): string {
    return join(this.configDir, "agents.json");
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const data = JSON.parse(await readFile(this.path, "utf8")) as { clients?: Record<string, AgentRecord> };
        for (const [name, r] of Object.entries(data.clients ?? {})) {
          if (r && (r.decision === "allow" || r.decision === "deny")) this.records.set(name, { ...r, name });
        }
      } catch {
        // no file yet
      }
    })();
    return this.loaded;
  }

  private async save(): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    const clients = Object.fromEntries([...this.records.values()].sort((a, b) => a.name.localeCompare(b.name)).map((r) => [r.name, r]));
    await atomicWrite(this.path, `${JSON.stringify({ clients }, null, 2)}\n`);
  }

  async list(): Promise<AgentRecord[]> {
    await this.load();
    return [...this.records.values()].sort((a, b) => (b.lastSeen ?? b.decidedAt) - (a.lastSeen ?? a.decidedAt));
  }

  async get(name: string): Promise<AgentRecord | undefined> {
    await this.load();
    return this.records.get(name);
  }

  async set(name: string, decision: AgentDecision, version?: string): Promise<AgentRecord> {
    await this.load();
    const record: AgentRecord = { name, decision, decidedAt: this.now(), lastSeen: this.records.get(name)?.lastSeen ?? this.now() };
    if (version) record.version = version;
    this.records.set(name, record);
    await this.save();
    return record;
  }

  /** Forget a client: it is asked again on its next call. */
  async revoke(name: string): Promise<boolean> {
    await this.load();
    const had = this.records.delete(name);
    if (had) await this.save();
    return had;
  }

  /**
   * Whether the client may call tools. Unknown clients are asked once (concurrent calls share the
   * question). Returns "allow", "deny", or "pending" when the user did not answer in time.
   */
  async check(client: AgentClientInfo, ask: AskUser): Promise<"allow" | "deny" | "pending"> {
    await this.load();
    const name = client.name || "unknown";
    const known = this.records.get(name);
    if (known) {
      this.touch(known);
      return known.decision;
    }
    let question = this.asking.get(name);
    if (!question) {
      question = ask(client).finally(() => this.asking.delete(name));
      this.asking.set(name, question);
    }
    const answer = await question;
    if (answer === null) return "pending";
    // the first caller to get the answer records it
    if (!this.records.has(name)) await this.set(name, answer ? "allow" : "deny", client.version);
    return this.records.get(name)!.decision;
  }

  /** lastSeen is persisted lazily, at most once a minute. */
  private touch(record: AgentRecord): void {
    const t = this.now();
    if (record.lastSeen && t - record.lastSeen < 60_000) return;
    record.lastSeen = t;
    if (this.seenDirty) return;
    this.seenDirty = true;
    setTimeout(() => {
      this.seenDirty = false;
      void this.save().catch(() => {});
    }, 1000).unref();
  }
}

export function deniedMessage(name: string): string {
  return `The user has not allowed "${name}" to use OpenCrease. Ask them to allow it in OpenCrease under Settings, Agents.`;
}

export function pendingMessage(name: string): string {
  return `OpenCrease is asking the user whether "${name}" may read and edit their designs, and nobody has answered yet. Ask the user to answer the prompt in the OpenCrease editor, then try again.`;
}
