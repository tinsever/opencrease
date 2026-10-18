// OpenCrease tools beyond Paper's set: oc_post_brief (design brief) and oc_get_diff (version diff).
import { artboardOf, diffDocuments, getNode, summarizeDiff, type DesignBrief, type FoldDocument } from "@opencrease/model";
import { ToolError, type EditorTool } from "../env";

const joinText = (v: unknown): string => (Array.isArray(v) ? v.map(String).join("\n") : typeof v === "string" ? v : "").trim();

const oc_post_brief: EditorTool = {
  write: true,
  label: (args, doc) => {
    const board = typeof args.artboardId === "string" ? getNode(doc, args.artboardId) : undefined;
    return board ? `Brief for "${board.name}"` : "Posting a design brief";
  },
  run(args, env) {
    const doc = env.doc;
    let artboardId: string | null = null;
    if (typeof args.artboardId === "string" && args.artboardId) {
      const node = getNode(doc, args.artboardId);
      if (!node) throw new ToolError(`No node with id "${args.artboardId}". Pass an artboard id from get_basic_info, or omit artboardId for a brief that covers the whole file.`);
      const board = artboardOf(doc, node.id);
      if (!board) throw new ToolError(`"${node.name}" is not on an artboard. Pass an artboard id, or omit artboardId for the whole file.`);
      artboardId = board.id;
    }
    const brief: DesignBrief = {
      id: `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      artboardId,
      mood: joinText(args.mood),
      palette: joinText(args.palette),
      type: joinText(args.type),
      direction: joinText(args.direction),
      author: env.client.name,
      createdAt: Date.now(),
    };
    const subject = joinText(args.subject);
    if (subject) brief.subject = subject;
    for (const k of ["mood", "palette", "type", "direction"] as const) {
      if (!brief[k]) throw new ToolError(`The brief needs a ${k}.`);
    }
    env.transact((tx) => {
      const draft = tx.doc as FoldDocument;
      const rest = (draft.briefs ?? []).filter((b) => b.artboardId !== artboardId);
      draft.briefs = [...rest, brief];
    });
    const scope = artboardId ? `artboard "${getNode(env.doc, artboardId)?.name}"` : "the whole file";
    return [
      { brief: { scope: artboardId ? "artboard" : "file", ...brief } },
      `Brief saved for ${scope}. The user sees it in the Agent tab. Next: create tokens for the palette and type scale with create_tokens, then build in small steps with write_html.`,
    ];
  },
};

const oc_get_diff: EditorTool = {
  write: false,
  label: (args) => (typeof args.sinceVersion === "number" ? `Diff since version ${args.sinceVersion}` : "Listing versions"),
  async run(args, env) {
    const versions = env.versions;
    if (!versions) throw new ToolError("Version history is not available in this editor.");
    const list = await versions.list();
    if (typeof args.sinceVersion !== "number") {
      return [
        {
          versions: list.map((v) => ({ version: v.version, createdAt: new Date(v.createdAt).toISOString(), name: v.name ?? null, source: v.source, layers: v.nodeCount })),
          next: list.length ? "Pass one of these as sinceVersion to see what changed since then." : "No versions yet. Save the file or create a named version in Version history.",
        },
      ];
    }
    const since = list.find((v) => v.version === args.sinceVersion);
    if (!since) {
      throw new ToolError(`No version ${args.sinceVersion} of this file. Versions: ${list.map((v) => v.version).join(", ") || "none yet"}. Omit sinceVersion to list them.`);
    }
    const before = await versions.read(since.version);
    const after = env.doc;
    const diff = diffDocuments(before, after);
    const { touchedIds: _t, removedIds: _r, ...rest } = diff;
    return [
      {
        since: { version: since.version, createdAt: new Date(since.createdAt).toISOString(), name: since.name ?? null },
        latestSavedVersion: list.at(-1)?.version ?? null,
        summary: summarizeDiff(diff),
        ...rest,
      },
      "This comparison is read-only. Choose a saved version as the baseline for the next comparison.",
    ].filter(Boolean);
  },
};

export const ofTools: Record<string, EditorTool> = { oc_post_brief, oc_get_diff };
