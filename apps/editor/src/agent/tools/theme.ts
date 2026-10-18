// oc_set_mode (token mode collections and frame pins) and oc_set_text_styles.
import { normalizeStyles } from "@opencrease/css";
import { collectionOfMode, normalizeModeName, parseModeList, type NodeId } from "@opencrease/model";
import { ToolError, type EditorTool } from "../env";
import { asArray, assertUnlocked, requireNode } from "./common";

interface CollectionArg { name: string; modes: string[]; renames?: Record<string, string>; delete?: boolean }
interface PinArg { nodeId: string; mode: string | null }
interface StyleArg { name: string; styles?: Record<string, string | number>; newName?: string; description?: string; delete?: boolean }
interface ApplyArg { nodeIds: string[]; style: string | null }

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const oc_set_mode: EditorTool = {
  write: true,
  label: (args) => (asArray(args.pins).length ? "Pinning token modes" : "Setting up token modes"),
  run(args, env) {
    const collections = asArray<CollectionArg>(args.collections);
    const pins = asArray<PinArg>(args.pins);
    if (!collections.length && !pins.length) throw new ToolError("Pass collections and/or pins.");
    const touched: NodeId[] = [];
    const results = env.transact((tx) => {
      const out: Array<Record<string, unknown>> = [];
      for (const c of collections) {
        try {
          const existing = tx.doc.modeCollections?.find((x) => x.name === c.name);
          if (c.delete) {
            if (!existing) throw new Error(`No mode collection named "${c.name}".`);
            tx.deleteModeCollection(existing.id);
            out.push({ collection: c.name, status: "deleted" });
            continue;
          }
          const result = existing
            ? tx.updateModeCollection(existing.id, { modes: c.modes, renames: c.renames })
            : tx.createModeCollection(c.name, c.modes);
          out.push({ collection: result.name, status: existing ? "updated" : "created", modes: result.modes, defaultMode: result.modes[0] });
        } catch (err) {
          out.push({ collection: c.name, status: "error", error: message(err) });
        }
      }
      for (const p of pins) {
        try {
          const node = requireNode(tx.doc, p.nodeId);
          if (node.type !== "Frame") throw new Error(`${node.type} "${node.name}" cannot pin a mode; use a frame or artboard.`);
          assertUnlocked(tx.doc, node);
          const unknown = parseModeList(p.mode ?? "").filter((m) => !collectionOfMode(tx.doc, normalizeModeName(m)));
          if (unknown.length) {
            const known = (tx.doc.modeCollections ?? []).flatMap((c) => c.modes);
            throw new Error(`Unknown mode ${unknown.map((m) => `"${m}"`).join(", ")}.${known.length ? ` Modes in this file: ${known.join(", ")}.` : " Create a collection first."}`);
          }
          tx.updateNode(node.id, { mode: p.mode ?? undefined });
          touched.push(node.id);
          out.push({ nodeId: node.id, name: node.name, status: "pinned", mode: tx.doc.nodes[node.id].mode ?? null });
        } catch (err) {
          out.push({ nodeId: p.nodeId, status: "error", error: message(err) });
        }
      }
      return out;
    });
    env.touch(touched);
    if (results.every((r) => r.status === "error")) throw new ToolError(results.map((r) => r.error).join(" "));
    return [{ results, modeCollections: (env.doc.modeCollections ?? []).map((c) => ({ name: c.name, modes: c.modes, defaultMode: c.modes[0] })) }];
  },
};

const oc_set_text_styles: EditorTool = {
  write: true,
  label: () => "Updating text styles",
  run(args, env) {
    const styles = asArray<StyleArg>(args.styles);
    const apply = asArray<ApplyArg>(args.apply);
    if (!styles.length && !apply.length) throw new ToolError("Pass styles and/or apply.");
    const touched: NodeId[] = [];
    const results = env.transact((tx) => {
      const out: Array<Record<string, unknown>> = [];
      for (const s of styles) {
        try {
          const existing = tx.doc.textStyles?.find((x) => x.name === s.name);
          if (s.delete) {
            if (!existing) throw new Error(`No text style named "${s.name}".`);
            tx.deleteTextStyle(existing.id);
            out.push({ style: s.name, status: "deleted" });
            continue;
          }
          let ignored: string[] = [];
          let map: Record<string, string | number> | undefined;
          if (s.styles) {
            const norm = normalizeStyles(s.styles);
            ignored = norm.ignored;
            map = norm.styles;
          }
          if (existing) {
            const before = new Set(Object.entries(tx.doc.nodes).filter(([, n]) => n.textStyle === existing.id).map(([id]) => id));
            const updated = tx.updateTextStyle(existing.id, { name: s.newName, styles: map, description: s.description });
            touched.push(...before);
            out.push({ style: updated.name, status: "updated", styles: updated.styles, linkedNodes: before.size, ...(ignored.length ? { ignoredStyles: ignored } : {}) });
          } else {
            if (!map) throw new Error(`Text style "${s.name}" does not exist yet: pass its styles to create it.`);
            const created = tx.createTextStyle({ name: s.newName ?? s.name, styles: map, description: s.description });
            out.push({ style: created.name, status: "created", styles: created.styles, ...(ignored.length ? { ignoredStyles: ignored } : {}) });
          }
        } catch (err) {
          out.push({ style: s.name, status: "error", error: message(err) });
        }
      }
      for (const a of apply) {
        for (const id of asArray<string>(a.nodeIds)) {
          try {
            const node = requireNode(tx.doc, id);
            assertUnlocked(tx.doc, node);
            if (a.style === null) tx.applyTextStyle(node.id, null);
            else {
              const style = tx.doc.textStyles?.find((x) => x.name === a.style || x.id === a.style);
              if (!style) throw new Error(`No text style named "${a.style}".`);
              tx.applyTextStyle(node.id, style.id);
            }
            touched.push(node.id);
            out.push({ nodeId: node.id, status: a.style === null ? "unlinked" : "applied", style: a.style });
          } catch (err) {
            out.push({ nodeId: id, status: "error", error: message(err) });
          }
        }
      }
      return out;
    });
    env.touch(touched);
    if (results.every((r) => r.status === "error")) throw new ToolError(results.map((r) => r.error).join(" "));
    return [{ results }];
  },
};

export const themeTools: Record<string, EditorTool> = { oc_set_mode, oc_set_text_styles };
