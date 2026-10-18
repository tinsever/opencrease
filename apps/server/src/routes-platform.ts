// REST routes for the agent platform: version history, agent permissions and plugins.
//   GET    /api/files/:id/versions              list versions
//   POST   /api/files/:id/versions              { name?, document?, source? } save a version (document: the live doc)
//   GET    /api/files/:id/versions/:n           the document at version n
//   PATCH  /api/files/:id/versions/:n           { name } name or rename a version ("" clears)
//   DELETE /api/files/:id/versions/:n
//   GET    /api/agents                          remembered agent decisions
//   PUT    /api/agents/:name                    { decision: "allow" | "deny" }
//   DELETE /api/agents/:name                    forget (asked again next time)
//   GET    /api/plugins                         plugins in ~/.opencrease/plugins
//   GET    /api/plugins/:id/source              a plugin's main module
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeDocument, type FoldDocument } from "@opencrease/model";
import type { AgentApprovals } from "./agents";
import type { VersionHistory, VersionSource } from "./history";
import type { Plugins } from "./plugins";
import { WorkspaceError } from "./workspace";

export interface PlatformRouteCtx {
  req: IncomingMessage;
  res: ServerResponse;
  path: string;
  method: string;
  readJson(): Promise<unknown>;
  sendJson(status: number, data: unknown): void;
  history: VersionHistory;
  approvals: AgentApprovals;
  plugins: Plugins;
}

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const SOURCES = new Set<VersionSource>(["auto", "user", "agent", "restore"]);

/** Returns true when the request was handled. */
export async function platformRoutes(ctx: PlatformRouteCtx): Promise<boolean> {
  const { path, method, history, approvals, plugins } = ctx;

  let m = /^\/api\/files\/([^/]+)\/versions$/.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]!);
    if (method === "GET") {
      ctx.sendJson(200, { versions: await history.list(id) });
      return true;
    }
    if (method === "POST") {
      const body = asObject(await ctx.readJson());
      let doc: FoldDocument | undefined;
      if (body.document !== undefined) {
        try {
          doc = normalizeDocument(body.document);
        } catch (err) {
          throw new WorkspaceError(`Invalid document: ${(err as Error).message}`);
        }
      }
      const source = SOURCES.has(body.source as VersionSource) ? (body.source as VersionSource) : undefined;
      const opts: Parameters<VersionHistory["create"]>[1] = { force: body.force === true };
      if (doc) opts.doc = doc;
      if (typeof body.name === "string") opts.name = body.name;
      if (source) opts.source = source;
      const { info, created } = await history.create(id, opts);
      ctx.sendJson(created ? 201 : 200, { ...info, created });
      return true;
    }
    throw new WorkspaceError("Method not allowed", 405);
  }

  m = /^\/api\/files\/([^/]+)\/versions\/(\d+)$/.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]!);
    const version = Number(m[2]);
    if (method === "GET") {
      ctx.sendJson(200, await history.read(id, version));
      return true;
    }
    if (method === "PATCH") {
      const body = asObject(await ctx.readJson());
      if (typeof body.name !== "string") throw new WorkspaceError("name is required");
      ctx.sendJson(200, await history.rename(id, version, body.name));
      return true;
    }
    if (method === "DELETE") {
      await history.remove(id, version);
      ctx.sendJson(200, { ok: true });
      return true;
    }
    throw new WorkspaceError("Method not allowed", 405);
  }

  if (path === "/api/agents" && method === "GET") {
    ctx.sendJson(200, { agents: await approvals.list() });
    return true;
  }
  m = /^\/api\/agents\/([^/]+)$/.exec(path);
  if (m) {
    const name = decodeURIComponent(m[1]!);
    if (method === "PUT") {
      const body = asObject(await ctx.readJson());
      if (body.decision !== "allow" && body.decision !== "deny") throw new WorkspaceError('decision must be "allow" or "deny"');
      ctx.sendJson(200, await approvals.set(name, body.decision));
      return true;
    }
    if (method === "DELETE") {
      ctx.sendJson(200, { ok: await approvals.revoke(name) });
      return true;
    }
    throw new WorkspaceError("Method not allowed", 405);
  }

  if (path === "/api/plugins" && method === "GET") {
    ctx.sendJson(200, { dir: plugins.dir, plugins: await plugins.list() });
    return true;
  }
  m = /^\/api\/plugins\/([^/]+)\/source$/.exec(path);
  if (m && method === "GET") {
    const source = await plugins.source(decodeURIComponent(m[1]!));
    ctx.res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    ctx.res.end(source);
    return true;
  }

  return false;
}
