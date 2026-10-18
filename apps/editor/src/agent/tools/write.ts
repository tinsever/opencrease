// Write tools for nodes: artboards, HTML, styles, text, names, moves, duplicates, deletes.
import { styleConstraintPatches } from "../../canvas/measure-dom";
import { htmlToTrees, normalizeStyles } from "@opencrease/css";
import {
  collectionOfMode, descendants, getNode, isAncestor, normalizeModeName, pageOfNode, parseModeList,
  type AssetMeta, type FoldDocument, type NodeId, type NodeTree, type OFNode, type StyleMap, type Tx,
} from "@opencrease/model";
import { ToolError, type EditorTool, type ToolEnv } from "../env";
import { pxNumber } from "../match";
import { findFreeSpot, type Rect } from "../placement";
import {
  asArray, assertUnlocked, nameOf, pageOfIds, plural, positionOf, requireNode, requirePage, rootIdOfPage, sizeOf, topLevelRects,
} from "./common";
import { codeComponentTags } from "./components";

type Args = Record<string, unknown>;

const DEFAULT_TREE_SIZE = { width: 400, height: 300 };
const POSITION_KEYS = ["top", "right", "bottom", "left"];

function treeSize(styles: StyleMap | undefined): { width: number; height: number } {
  return {
    width: pxNumber(styles?.width) ?? DEFAULT_TREE_SIZE.width,
    height: pxNumber(styles?.height) ?? DEFAULT_TREE_SIZE.height,
  };
}

/** Collect asset://<sha256> references in trees (img src and url() in styles). */
function assetHashes(trees: NodeTree[]): string[] {
  const out = new Set<string>();
  const visit = (t: NodeTree) => {
    for (const v of [t.src, ...Object.values(t.styles ?? {}), ...Object.values(t.attrs ?? {})]) {
      if (typeof v !== "string") continue;
      for (const m of v.matchAll(/asset:\/\/([a-f0-9]{64})/g)) out.add(m[1]);
    }
    t.children?.forEach(visit);
  };
  trees.forEach(visit);
  return [...out];
}

async function registerAssets(env: ToolEnv, hashes: string[]): Promise<AssetMeta[]> {
  const metas: AssetMeta[] = [];
  for (const hash of hashes) {
    if (env.doc.assets[hash]) continue;
    const meta = await env.assetMeta(hash);
    if (meta) metas.push(meta);
  }
  return metas;
}

function createdInfo(env: ToolEnv, ids: NodeId[]) {
  const doc = env.doc;
  return ids
    .map((id) => getNode(doc, id))
    .filter((n) => n !== undefined)
    .map((n) => {
      const rect = env.measure(n.id);
      const size = sizeOf(env, n, rect);
      return { id: n.id, name: n.name, component: n.type, ...positionOf(env, doc, n, rect), width: size.width, height: size.height };
    });
}

// ---------------------------------------------------------------------------------- create_artboard

const create_artboard: EditorTool = {
  write: true,
  page: (args, doc) => (typeof args.pageId === "string" && doc.pages[args.pageId] ? args.pageId : undefined),
  label: (args) => `Creating "${String(args.name ?? "artboard")}"`,
  async run(args, env) {
    const doc = env.doc;
    const pageId = typeof args.pageId === "string" && args.pageId ? requirePage(doc, args.pageId) : env.activePageId;
    const { styles, ignored } = normalizeStyles((args.styles as Record<string, unknown>) ?? {});
    if (styles.width === undefined || styles.height === undefined) throw new ToolError("create_artboard needs styles.width and styles.height.");
    if (styles.display === undefined) styles.display = "flex";
    if (styles.display === "flex" && styles.flexDirection === undefined) styles.flexDirection = "column";
    if (styles.backgroundColor === undefined && styles.backgroundImage === undefined && styles.background === undefined) styles.backgroundColor = "#FFFFFF";
    if (styles.overflow === undefined) styles.overflow = "clip";
    styles.position = "absolute";
    if (styles.left === undefined || styles.top === undefined) {
      const spot = findFreeSpot(topLevelRects(env, doc, pageId), treeSize(styles));
      styles.left ??= spot.x;
      styles.top ??= spot.y;
    }
    for (const k of ["right", "bottom"]) delete styles[k];
    const name = String(args.name ?? "").trim() || "Artboard";
    const [id] = env.transact((tx) => tx.insertTrees(rootIdOfPage(doc, pageId), [{ type: "Frame", name, styles }]));
    env.touch([id]);
    await env.settle();
    const node = getNode(env.doc, id)!;
    const rect = env.measure(id);
    const size = sizeOf(env, node, rect);
    const pos = positionOf(env, env.doc, node, rect);
    const out: Record<string, unknown> = { id, name: node.name, pageId, worldX: pos.worldX, worldY: pos.worldY, width: size.width, height: size.height };
    if (ignored.length) out.ignoredStyles = ignored;
    out.next = "Fill it with write_html in insert-children mode, one visual group per call.";
    return [out];
  },
};

// ---------------------------------------------------------------------------------- write_html

function resolveAssetUrl(url: string): string {
  if (url.startsWith("paper-asset://")) return `asset://${url.slice("paper-asset://".length)}`;
  return url;
}

/** data-mode values in parsed trees that are not modes of this file (they are skipped on insert). */
function unknownTreeModes(doc: FoldDocument, trees: NodeTree[]): string[] {
  const out = new Set<string>();
  const visit = (t: NodeTree) => {
    for (const m of parseModeList(t.mode)) if (!collectionOfMode(doc, normalizeModeName(m))) out.add(m);
    t.children?.forEach(visit);
  };
  trees.forEach(visit);
  return [...out];
}

const write_html: EditorTool = {
  write: true,
  page: (args, doc) => pageOfIds(doc, [args.targetNodeId]),
  label: (args, doc) => `${args.mode === "replace" ? "Replacing" : "Writing into"} "${nameOf(doc, String(args.targetNodeId ?? ""))}"`,
  async run(args, env) {
    const doc = env.doc;
    const target = requireNode(doc, args.targetNodeId);
    const mode = args.mode === "replace" ? "replace" : "insert-children";
    const { trees, warnings } = htmlToTrees(String(args.html ?? ""), { resolveAssetUrl, componentTags: codeComponentTags(doc) });
    if (trees.length === 0) throw new ToolError(`The HTML produced no layers.${warnings.length ? ` ${warnings.join(" ")}` : ""}`);
    const unknownModes = unknownTreeModes(doc, trees);
    if (unknownModes.length) warnings.push(`Unknown token modes ignored in data-mode: ${unknownModes.join(", ")}. Create them with oc_set_mode.`);

    let parent: OFNode;
    let index: number | undefined;
    if (mode === "replace") {
      if (target.type === "Root") throw new ToolError("A page root cannot be replaced. Use insert-children on it, or replace one of its artboards.");
      assertUnlocked(doc, target, "be replaced");
      parent = getNode(doc, target.parentId!)!;
      index = parent.children.indexOf(target.id);
    } else {
      if (["Text", "Rectangle", "Image", "Shader"].includes(target.type)) {
        throw new ToolError(`${target.type} layers cannot have children. Use mode "replace" to swap "${target.name}" out, or target its parent.`);
      }
      if (target.type !== "Root") assertUnlocked(doc, target, "get new children");
      parent = target;
    }

    // top-level layers need canvas positions
    if (parent.type === "Root") {
      const pageId = pageOfNode(doc, parent.id)!.id;
      const placed: Rect[] = topLevelRects(env, doc, pageId, new Set(mode === "replace" ? [target.id] : []));
      trees.forEach((tree, i) => {
        const styles: StyleMap = { ...(tree.styles ?? {}) };
        if (mode === "replace" && i === 0 && styles.left === undefined && styles.top === undefined) {
          styles.position = "absolute";
          styles.left = target.styles.left ?? 0;
          styles.top = target.styles.top ?? 0;
        } else if (styles.left === undefined || styles.top === undefined) {
          const src = tree.cloneOf ? getNode(doc, tree.cloneOf) : undefined;
          const size = treeSize({ ...(src?.styles ?? {}), ...styles });
          const spot = findFreeSpot(placed, size);
          styles.position = "absolute";
          styles.left ??= spot.x;
          styles.top ??= spot.y;
        } else if (styles.position === undefined) {
          styles.position = "absolute";
        }
        const size = treeSize(styles);
        placed.push({ x: pxNumber(styles.left) ?? 0, y: pxNumber(styles.top) ?? 0, ...size });
        tree.styles = styles;
      });
    }

    const assets = await registerAssets(env, assetHashes(trees));
    const ids = env.transact((tx) => {
      for (const meta of assets) tx.addAsset(meta);
      const created = tx.insertTrees(parent.id, trees, index);
      if (mode === "replace") tx.deleteNode(target.id);
      return created;
    });
    env.touch(parent.type === "Root" ? ids : [parent.id, ...ids]);
    await env.settle();
    const out: Record<string, unknown> = { createdNodes: createdInfo(env, ids) };
    if (mode === "replace") out.replacedNodeId = target.id;
    if (warnings.length) out.warnings = warnings;
    return [out];
  },
};

// ---------------------------------------------------------------------------------- update_styles

interface StyleUpdate {
  nodeIds: string[];
  styles: Record<string, unknown>;
}

/** Positional properties only work on positioned layers (and on artboards). */
function inertPositionKeys(doc: FoldDocument, node: OFNode, patch: Record<string, unknown>): string[] {
  const parent = node.parentId ? getNode(doc, node.parentId) : undefined;
  if (!parent || parent.type === "Root") return [];
  const position = "position" in patch ? patch.position : node.styles.position;
  if (position === "absolute" || position === "relative") return [];
  return POSITION_KEYS.filter((k) => k in patch && patch[k] !== null);
}

const update_styles: EditorTool = {
  write: true,
  page: (args, doc) => pageOfIds(doc, asArray<StyleUpdate>(args.updates).flatMap((u) => asArray(u?.nodeIds))),
  label: (args, doc) => {
    const ids = asArray<StyleUpdate>(args.updates).flatMap((u) => asArray<string>(u?.nodeIds));
    return ids.length === 1 ? `Styling "${nameOf(doc, ids[0])}"` : `Styling ${plural(ids.length, "layer")}`;
  },
  async run(args, env) {
    const doc = env.doc;
    const updates = asArray<StyleUpdate>(args.updates);
    const plan: Array<{ id: NodeId; patch: Record<string, string | number | null>; ignored: string[] }> = [];
    for (const u of updates) {
      const { styles, ignored, removed } = normalizeStyles(u.styles ?? {});
      for (const id of asArray<string>(u.nodeIds)) {
        const node = requireNode(doc, id);
        if (node.type !== "Root") assertUnlocked(doc, node, "be restyled");
        const patch: Record<string, string | number | null> = { ...styles };
        for (const k of removed) patch[k] = null;
        const inert = inertPositionKeys(doc, node, patch);
        for (const k of inert) delete patch[k];
        const extra = inert.map((k) => `${k} (only works with position: absolute or relative)`);
        plan.push({ id, patch, ignored: [...ignored, ...extra] });
      }
    }
    env.transact((tx) => {
      for (const p of plan) {
        for (const c of styleConstraintPatches(tx.doc, p.id, p.patch, env.measure)) tx.setStyles(c.id, c.styles);
        tx.setStyles(p.id, p.patch);
      }
    });
    env.touch(plan.map((p) => p.id));
    const merged = new Map<NodeId, string[]>();
    for (const p of plan) merged.set(p.id, [...new Set([...(merged.get(p.id) ?? []), ...p.ignored])]);
    const updatedNodes = [...merged].map(([id, ignored]) => {
      const o: Record<string, unknown> = { id, name: getNode(env.doc, id)?.name };
      if (ignored.length) o.ignoredStyles = ignored;
      return o;
    });
    return [{ updatedNodes, count: updatedNodes.length }];
  },
};

// ---------------------------------------------------------------------------------- text and names

const set_text_content: EditorTool = {
  write: true,
  page: (args, doc) => pageOfIds(doc, asArray<{ nodeId: string }>(args.updates).map((u) => u?.nodeId)),
  label: (args) => `Editing ${plural(asArray(args.updates).length, "text")}`,
  run(args, env) {
    const doc = env.doc;
    const updates = asArray<{ nodeId: string; textContent: string }>(args.updates);
    const problems: string[] = [];
    for (const u of updates) {
      const node = getNode(doc, u.nodeId);
      if (!node) problems.push(`No node with id "${u.nodeId}".`);
      else if (node.type !== "Text") problems.push(`"${node.name}" (${node.id}) is a ${node.type}, not a Text layer.`);
      else assertUnlocked(doc, node, "be edited");
    }
    if (problems.length) throw new ToolError(`Nothing was changed. ${problems.join(" ")}`);
    env.transact((tx) => {
      for (const u of updates) tx.updateNode(u.nodeId, { text: String(u.textContent ?? "") });
    });
    env.touch(updates.map((u) => u.nodeId));
    return [{ updatedNodes: updates.map((u) => ({ id: u.nodeId, name: getNode(env.doc, u.nodeId)?.name, textContent: getNode(env.doc, u.nodeId)?.text })) }];
  },
};

const rename_nodes: EditorTool = {
  write: true,
  page: (args, doc) => pageOfIds(doc, asArray<{ nodeId: string }>(args.updates).map((u) => u?.nodeId)),
  label: (args) => `Renaming ${plural(asArray(args.updates).length, "layer")}`,
  run(args, env) {
    const doc = env.doc;
    const updates = asArray<{ nodeId: string; name: string }>(args.updates);
    for (const u of updates) {
      const node = requireNode(doc, u.nodeId);
      if (node.type === "Root") throw new ToolError("Page roots cannot be renamed. Use update_pages to rename a page.");
    }
    env.transact((tx) => {
      for (const u of updates) tx.updateNode(u.nodeId, { name: String(u.name ?? "") });
    });
    env.touch(updates.map((u) => u.nodeId));
    return [{ updatedNodes: updates.map((u) => ({ id: u.nodeId, name: getNode(env.doc, u.nodeId)?.name })) }];
  },
};

// ---------------------------------------------------------------------------------- move

type Move = { nodeId: string; before?: string; after?: string; parentId?: string; index?: number };

/** Adjust canvas positioning when a node enters or leaves a page root. */
function fixPositioning(tx: Tx, env: ToolEnv, id: NodeId, fromRoot: boolean, toRoot: boolean, placed: Rect[]): void {
  const node = tx.doc.nodes[id];
  if (fromRoot && !toRoot) {
    if (node.styles.position === "absolute") tx.setStyles(id, { position: null, left: null, top: null, right: null, bottom: null });
  } else if (!fromRoot && toRoot) {
    const rect = env.measure(id);
    const size = { width: rect?.width ?? pxNumber(node.styles.width) ?? DEFAULT_TREE_SIZE.width, height: rect?.height ?? pxNumber(node.styles.height) ?? DEFAULT_TREE_SIZE.height };
    const spot = findFreeSpot(placed, size);
    placed.push({ ...spot, ...size });
    tx.setStyles(id, { position: "absolute", left: spot.x, top: spot.y, right: null, bottom: null });
  }
}

const move_nodes: EditorTool = {
  write: true,
  page: (args, doc) => pageOfIds(doc, asArray<Move>(args.moves).map((m) => m?.nodeId)),
  label: (args) => `Moving ${plural(asArray(args.moves).length, "layer")}`,
  run(args, env) {
    const moves = asArray<Move>(args.moves);
    const before = env.doc;
    for (const m of moves) {
      const node = requireNode(before, m.nodeId);
      if (node.type === "Root") throw new ToolError("Page roots cannot be moved.");
      assertUnlocked(before, node, "be moved");
    }
    const touchedParents = new Set<NodeId>();
    const touchedNodes = new Set<NodeId>();
    const results = env.transact((tx) => {
      const doc = tx.doc;
      const out: Array<{ nodeId: string; parentId: string; index: number }> = [];
      for (const m of moves) {
        const node = doc.nodes[m.nodeId];
        const oldParent = node.parentId!;
        let parentId: NodeId;
        let index: number | undefined;
        const sibId = m.before ?? m.after;
        if (sibId !== undefined) {
          const sib = getNode(doc, sibId);
          if (!sib) throw new ToolError(`No node with id "${sibId}" to move next to.`);
          if (sib.id === node.id) throw new ToolError(`A node cannot be moved next to itself (${sib.id}).`);
          if (!sib.parentId) throw new ToolError(`"${sib.name}" is a page root; nodes cannot be placed next to it.`);
          parentId = sib.parentId;
          const siblings = doc.nodes[parentId].children.filter((c) => c !== node.id);
          index = siblings.indexOf(sib.id) + (m.after !== undefined ? 1 : 0);
        } else {
          const raw = String(m.parentId ?? "");
          if (raw === "root") parentId = pageOfNode(doc, node.id)!.rootId;
          else {
            const p = getNode(doc, raw);
            if (!p) throw new ToolError(`No node with id "${raw}" to move into.`);
            parentId = p.id;
          }
          index = typeof m.index === "number" ? m.index : undefined;
        }
        if (parentId === node.id || isAncestor(doc, node.id, parentId)) throw new ToolError(`"${node.name}" cannot be moved into itself.`);
        const target = doc.nodes[parentId];
        if (target.type !== "Root") assertUnlocked(doc, target, "receive layers");
        const fromRoot = doc.nodes[oldParent]?.type === "Root";
        const toRoot = target.type === "Root";
        tx.moveNode(node.id, parentId, index);
        if (fromRoot !== toRoot) {
          const pageId = pageOfNode(doc, parentId)!.id;
          fixPositioning(tx, env, node.id, fromRoot, toRoot, topLevelRects(env, doc, pageId, new Set([node.id])));
        }
        touchedParents.add(oldParent).add(parentId);
        touchedNodes.add(node.id).add(parentId);
        out.push({ nodeId: node.id, parentId, index: doc.nodes[parentId].children.indexOf(node.id) });
      }
      return out;
    });
    env.touch(touchedNodes);
    const doc = env.doc;
    const affectedParents = [...touchedParents]
      .map((id) => getNode(doc, id))
      .filter((p) => p !== undefined)
      .map((p) => ({ id: p.id, name: p.name, childIds: [...p.children] }));
    return [{ moves: results, affectedParents }];
  },
};

// ---------------------------------------------------------------------------------- duplicate

const duplicate_nodes: EditorTool = {
  write: true,
  page: (args, doc) => pageOfIds(doc, asArray<{ id: string }>(args.nodes).map((n) => n?.id)),
  label: (args) => `Duplicating ${plural(asArray(args.nodes).length, "layer")}`,
  run(args, env) {
    const doc = env.doc;
    const items = asArray<{ id: string; parentId?: string }>(args.nodes);
    for (const it of items) {
      const node = requireNode(doc, it.id);
      if (node.type === "Root") throw new ToolError("Page roots cannot be duplicated. Create a page and duplicate its artboards instead.");
      if (it.parentId) {
        const p = requireNode(doc, it.parentId);
        if (p.type !== "Root") assertUnlocked(doc, p, "receive layers");
      }
    }
    const placedByPage = new Map<string, Rect[]>();
    const results = env.transact((tx) =>
      items.map((it) => {
        const { newId, idMap } = tx.duplicateNode(it.id, it.parentId || undefined);
        const copy = tx.doc.nodes[newId];
        const parent = tx.doc.nodes[copy.parentId!];
        if (parent.type === "Root") {
          const pageId = pageOfNode(tx.doc, parent.id)!.id;
          let placed = placedByPage.get(pageId);
          if (!placed) {
            placed = topLevelRects(env, tx.doc, pageId, new Set([newId]));
            placedByPage.set(pageId, placed);
          }
          const src = tx.doc.nodes[it.id];
          const rect = env.measure(it.id);
          const near: Rect = rect ?? { x: pxNumber(src.styles.left) ?? 0, y: pxNumber(src.styles.top) ?? 0, ...treeSize(src.styles) };
          const spot = findFreeSpot(placed, { width: near.width, height: near.height }, near);
          placed.push({ ...spot, width: near.width, height: near.height });
          tx.setStyles(newId, { position: "absolute", left: spot.x, top: spot.y });
        }
        const descendantIdMap: Record<NodeId, NodeId> = {};
        for (const [from, to] of Object.entries(idMap)) if (from !== it.id) descendantIdMap[from] = to;
        return { sourceId: it.id, id: newId, name: copy.name, parentId: copy.parentId, descendantIdMap };
      }),
    );
    env.touch(results.map((r) => r.id));
    return [{ duplicatedNodes: results, count: results.length }];
  },
};

// ---------------------------------------------------------------------------------- delete

const delete_nodes: EditorTool = {
  write: true,
  page: (args, doc) => pageOfIds(doc, asArray(args.nodeIds)),
  label: (args) => `Deleting ${plural(asArray(args.nodeIds).length, "layer")}`,
  run(args, env) {
    const doc = env.doc;
    const ids = [...new Set(asArray<string>(args.nodeIds))];
    const nodes = ids.map((id) => requireNode(doc, id));
    for (const n of nodes) {
      if (n.type === "Root") throw new ToolError("Page roots cannot be deleted.");
      assertUnlocked(doc, n, "be deleted");
    }
    const set = new Set(ids);
    const top = nodes.filter((n) => !nodes.some((o) => o.id !== n.id && set.has(o.id) && isAncestor(doc, o.id, n.id)));
    const parents = top.map((n) => n.parentId!).filter((p) => !set.has(p));
    const count = top.reduce((sum, n) => sum + 1 + descendants(doc, n.id).length, 0);
    env.transact((tx) => {
      for (const n of top) tx.deleteNode(n.id);
    });
    env.touch(parents);
    return [{ deletedNodeIds: top.map((n) => n.id), deletedLayerCount: count }];
  },
};

export const writeTools: Record<string, EditorTool<Args>> = {
  create_artboard,
  write_html,
  update_styles,
  set_text_content,
  rename_nodes,
  move_nodes,
  duplicate_nodes,
  delete_nodes,
};
