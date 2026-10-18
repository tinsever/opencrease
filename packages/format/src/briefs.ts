// Design briefs (SPEC §8.5): stored on the document so they persist, show in the Agent tab and are
// part of version history. Pure helpers.
import type { DesignBrief, FoldDocument, NodeId } from "./types";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : Array.isArray(v) ? v.filter((x) => typeof x === "string").join("\n").trim() : "");

/** Validate stored briefs; drops malformed entries and briefs for artboards that no longer exist. */
export function normalizeBriefs(input: unknown, nodes: FoldDocument["nodes"]): DesignBrief[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: DesignBrief[] = [];
  for (const raw of input) {
    if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) continue;
    const artboardId = typeof raw.artboardId === "string" && raw.artboardId ? raw.artboardId : null;
    if (artboardId && !nodes[artboardId]) continue;
    const brief: DesignBrief = {
      id: raw.id,
      artboardId,
      mood: text(raw.mood),
      palette: text(raw.palette),
      type: text(raw.type),
      direction: text(raw.direction),
      createdAt: typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    };
    const subject = text(raw.subject);
    if (subject) brief.subject = subject;
    if (typeof raw.author === "string" && raw.author) brief.author = raw.author;
    out.push(brief);
  }
  return out.length ? out : undefined;
}

/** The brief that covers an artboard: its own, else the file-wide one. */
export function briefFor(doc: Pick<FoldDocument, "briefs">, artboardId: NodeId | null | undefined): DesignBrief | undefined {
  const briefs = doc.briefs ?? [];
  return (artboardId ? briefs.findLast((b) => b.artboardId === artboardId) : undefined) ?? briefs.findLast((b) => b.artboardId === null);
}
