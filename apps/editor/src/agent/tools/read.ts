// Read-only tools: orientation, structure, code, styles, screenshots, fonts, tokens, search.
import { nodeToJsx, normalizeStyles } from "@opencrease/css";
import {
  artboardOf, artboards, collectionOfMode, descendants, effectiveModes, getNode, getPage, normalizeModeName, resolveToken,
  themeToCss, themeToTailwind, tokensInModes, treeSummary,
  type FoldDocument, type NodeId, type PageId, type Token,
} from "@opencrease/model";
import { imageBlock } from "@opencrease/protocol";
import { curateComputedStyles } from "../computed";
import { RawBlock, ToolError, type EditorTool, type ToolEnv } from "../env";
import { GENERIC_FAMILIES, primaryFamily } from "../fonts";
import { globMatch } from "../match";
import { asArray, pageOfIds, positionOf, requireNode, requirePage, sizeOf } from "./common";
import { componentInfo } from "./components";
import { findNodes, type StyleFilter } from "./find";

type Args = Record<string, unknown>;

function pageArg(args: Args, doc: FoldDocument): PageId | undefined {
  return typeof args.pageId === "string" && getPage(doc, args.pageId) ? args.pageId : undefined;
}

function nodePage(args: Args, doc: FoldDocument): PageId | undefined {
  return pageOfIds(doc, [args.nodeId, ...asArray(args.nodeIds)]);
}

/** Font families used on a page (first family of each stack, tokens resolved). */
export function fontFamiliesInUse(doc: FoldDocument, pageId: PageId): string[] {
  const page = getPage(doc, pageId);
  if (!page) return [];
  const seen = new Set<string>();
  for (const node of descendants(doc, page.rootId)) {
    let value = node.styles.fontFamily;
    if (value === undefined) continue;
    if (typeof value === "string" && value.trim().startsWith("var(")) value = resolveToken(doc, value) ?? value;
    const family = primaryFamily(String(value));
    if (family && !family.startsWith("var(")) seen.add(family);
  }
  return [...seen];
}

function tokenItems(tokens: readonly Token[]) {
  return tokens.map((t) => ({ name: t.name, value: t.value }));
}

const get_basic_info: EditorTool = {
  write: false,
  page: pageArg,
  run(args, env) {
    const doc = env.doc;
    const pageId = pageArg(args, doc) ?? env.activePageId;
    if (typeof args.pageId === "string" && args.pageId && !getPage(doc, args.pageId)) requirePage(doc, args.pageId);
    const page = getPage(doc, pageId)!;
    const boards = artboards(doc, pageId);
    return [
      {
        fileName: doc.name,
        pageName: page.name,
        pageId,
        url: env.editorUrl(`/file/${doc.id}/${pageId}`),
        rootNodeId: page.rootId,
        nodeCount: descendants(doc, page.rootId).length,
        artboardCount: boards.length,
        artboards: boards.map((b) => {
          const rect = env.measure(b.id);
          const size = sizeOf(env, b, rect);
          const pos = positionOf(env, doc, b, rect);
          return { id: b.id, name: b.name, childCount: b.children.length, width: size.width, height: size.height, worldX: pos.worldX, worldY: pos.worldY };
        }),
        pages: doc.pageList.map((item) =>
          item.type === "page"
            ? { type: "page", id: item.id, name: doc.pages[item.id]?.name ?? item.id, icon: doc.pages[item.id]?.icon ?? null, isActive: item.id === env.activePageId }
            : { type: "divider", id: item.id },
        ),
        fontFamilies: fontFamiliesInUse(doc, pageId),
        tokens: { items: tokenItems(doc.tokens) },
        ...(doc.modeCollections?.length ? { modeCollections: modeSummary(doc) } : {}),
        ...(doc.textStyles?.length ? { textStyles: doc.textStyles.map((st) => st.name) } : {}),
      },
    ];
  },
};

const get_selection: EditorTool = {
  write: false,
  run(_args, env) {
    const doc = env.doc;
    const selectedNodes = env.selection
      .map((id) => getNode(doc, id))
      .filter((n) => n !== undefined)
      .map((n) => {
        const size = sizeOf(env, n);
        const board = artboardOf(doc, n.id);
        return { id: n.id, name: n.name, component: n.type, width: size.width, height: size.height, artboardId: board?.id ?? null, artboardName: board?.name ?? null };
      });
    return [{ selectedNodes, count: selectedNodes.length }];
  },
};

const get_tree_summary: EditorTool = {
  write: false,
  page: nodePage,
  run(args, env) {
    const node = requireNode(env.doc, args.nodeId);
    const depth = typeof args.depth === "number" ? args.depth : 3;
    const summary = treeSummary(env.doc, node.id, depth, (id) => {
      const n = getNode(env.doc, id);
      if (!n || n.type === "Root") return null;
      const s = sizeOf(env, n);
      return s.width !== null && s.height !== null ? { width: s.width, height: s.height } : null;
    });
    return [{ summary, nodeId: node.id, depth }];
  },
};

const get_children: EditorTool = {
  write: false,
  page: nodePage,
  run(args, env) {
    const doc = env.doc;
    const parent = requireNode(doc, args.nodeId);
    const children = parent.children
      .map((id) => getNode(doc, id))
      .filter((n) => n !== undefined)
      .map((n) => {
        const rect = env.measure(n.id);
        const size = sizeOf(env, n, rect);
        return { id: n.id, name: n.name, component: n.type, childCount: n.children.length, width: size.width, height: size.height, ...positionOf(env, doc, n, rect) };
      });
    return [{ children, count: children.length }];
  },
};

const get_node_info: EditorTool = {
  write: false,
  page: nodePage,
  run(args, env) {
    const doc = env.doc;
    const n = requireNode(doc, args.nodeId);
    const rect = env.measure(n.id);
    const size = sizeOf(env, n, rect);
    const info: Record<string, unknown> = {
      id: n.id,
      name: n.name,
      component: n.type,
      width: size.width,
      height: size.height,
      ...positionOf(env, doc, n, rect),
      isVisible: n.visible,
      isLocked: n.locked,
      parentId: n.parentId,
      childIds: [...n.children],
      childCount: n.children.length,
      artboardId: artboardOf(doc, n.id)?.id ?? null,
      textContent: n.type === "Text" ? (n.text ?? "") : null,
      styles: { ...n.styles },
    };
    if (n.src !== undefined) info.src = n.src;
    if (n.tag !== undefined) info.tag = n.tag;
    if (n.attrs) info.attrs = { ...n.attrs };
    if (n.shader) info.shader = n.shader;
    if (n.exports?.length) info.exports = n.exports;
    if (n.spans) info.spans = n.spans;
    if (n.mode) info.mode = n.mode;
    if (n.textStyle) info.textStyle = doc.textStyles?.find((s) => s.id === n.textStyle)?.name ?? n.textStyle;
    const modes = effectiveModes(doc, n.id);
    if (modes.length && !n.mode) info.activeModes = modes;
    const comp = componentInfo(doc, n);
    if (comp) info.componentInfo = comp;
    return [info];
  },
};

const get_jsx: EditorTool = {
  write: false,
  page: nodePage,
  run(args, env) {
    const node = requireNode(env.doc, args.nodeId);
    if (node.type === "Root") throw new ToolError("get_jsx works on artboards and layers, not on a page root. Pass an artboard id.");
    return [
      nodeToJsx(env.doc, node.id, {
        format: args.format === "inline-styles" ? "inline-styles" : "tailwind",
        includeNodeIds: args.includeNodeIds !== false,
        includeRootPositioning: args.includeRootPositioning === true,
      }),
    ];
  },
};

const get_computed_styles: EditorTool = {
  write: false,
  page: nodePage,
  run(args, env) {
    const styles: Record<NodeId, Record<string, string | number>> = {};
    const missing: string[] = [];
    for (const id of asArray<string>(args.nodeIds)) {
      const node = getNode(env.doc, id);
      if (!node) {
        missing.push(id);
        continue;
      }
      const read = env.computedStyle(id);
      styles[id] = read ? curateComputedStyles(node, read) : normalizeStyles(node.styles).styles;
    }
    const out: Record<string, unknown> = { styles };
    if (missing.length) out.errors = missing.map((id) => `No node with id "${id}".`);
    return [out];
  },
};

const get_screenshot: EditorTool = {
  write: false,
  page: nodePage,
  async run(args, env) {
    const node = requireNode(env.doc, args.nodeId);
    if (node.type === "Root") throw new ToolError("Screenshots work on artboards and layers, not on a page root. Pass an artboard id.");
    if (!node.visible) throw new ToolError(`Layer "${node.name}" is hidden, so there is nothing to capture.`);
    const scale = args.scale === 2 ? 2 : 1;
    const shot = await env.screenshot(node.id, scale);
    const board = artboardOf(env.doc, node.id);
    if (board) env.reviewed(board.id);
    return [new RawBlock(imageBlock(shot.data, shot.mimeType))];
  },
};

const get_fill_image: EditorTool = {
  write: false,
  page: nodePage,
  async run(args, env) {
    const node = requireNode(env.doc, args.nodeId);
    if (node.type === "SVG" || node.type === "SVGElement") throw new ToolError("SVG nodes have no fill image. Use get_jsx to read the SVG markup.");
    const fill = await env.fillImage(node.id);
    return [
      { nodeId: node.id, src: fill.src, naturalWidth: fill.naturalWidth, naturalHeight: fill.naturalHeight, width: fill.image.width, height: fill.image.height },
      new RawBlock(imageBlock(fill.image.data, fill.image.mimeType)),
    ];
  },
};

const get_font_family_info: EditorTool = {
  write: false,
  async run(args, env) {
    const names = asArray<string>(args.familyNames).map((n) => String(n).trim()).filter(Boolean);
    const generic = names.filter((n) => GENERIC_FAMILIES.has(n.toLowerCase()));
    const lookup = await env.fontFamilies(names.filter((n) => !generic.includes(n)));
    const inUse = new Set<string>(Object.keys(env.doc.pages).flatMap((p) => fontFamiliesInUse(env.doc, p)).map((f) => f.toLowerCase()));
    const out: Record<string, unknown> = {};
    if (lookup.errors.length) out.errors = lookup.errors;
    out.fontsPerFamily = lookup.fontsPerFamily;
    const notes: string[] = [];
    for (const g of generic) notes.push(`"${g}" is a generic CSS family; the browser picks the actual font.`);
    for (const [family, source] of Object.entries(lookup.sources ?? {})) {
      if (source === "local") notes.push(`"${family}" is installed on this machine but not on Google Fonts; its other weights could not be listed, and it only renders for people who have it installed.`);
    }
    const used = names.filter((n) => inUse.has(n.toLowerCase()));
    if (used.length) notes.push(`Already used in this file: ${used.join(", ")}.`);
    if (notes.length) out.notes = notes;
    return [out];
  },
};

export function filterTokens(tokens: readonly Token[], types?: string[], namePattern?: string): Token[] {
  return tokens.filter((t) => (!types?.length || types.includes(t.type)) && (!namePattern || globMatch(namePattern, t.name)));
}

function modeSummary(doc: FoldDocument) {
  return (doc.modeCollections ?? []).map((c) => ({ name: c.name, modes: c.modes, defaultMode: c.modes[0] }));
}

/** A mode argument: normalised, and known to the file. */
export function modeArg(doc: FoldDocument, raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const mode = normalizeModeName(raw);
  if (collectionOfMode(doc, mode)) return mode;
  const known = (doc.modeCollections ?? []).flatMap((c) => c.modes);
  throw new ToolError(known.length ? `Unknown mode "${raw}". Modes in this file: ${known.join(", ")}.` : "This file has no token modes yet. Create a mode collection with oc_set_mode first.");
}

const get_tokens: EditorTool = {
  write: false,
  run(args, env) {
    const doc = env.doc;
    const tokens = filterTokens(doc.tokens, asArray<string>(args.types), typeof args.namePattern === "string" ? args.namePattern : undefined);
    const mode = modeArg(doc, args.mode);
    const scoped = {
      tokens: mode ? tokensInModes(tokens, [mode]).map(({ modes: _modes, ...t }): Token => t) : tokens,
      modeCollections: mode ? undefined : doc.modeCollections,
    };
    if (args.format === "css") return [themeToCss(scoped)];
    if (args.format === "tailwind") return [themeToTailwind(scoped)];
    const out: Record<string, unknown> = {
      tokens: scoped.tokens.map((t) => {
        const o: Record<string, unknown> = { name: t.name, type: t.type, value: t.value };
        if (t.description) o.description = t.description;
        if (t.modes) o.modes = t.modes;
        return o;
      }),
    };
    if (mode) out.mode = mode;
    else if (doc.modeCollections?.length) out.modeCollections = modeSummary(doc);
    return [out];
  },
};

const find_nodes: EditorTool = {
  write: false,
  run(args, env) {
    if (typeof args.nodeId === "string" && args.nodeId) requireNode(env.doc, args.nodeId);
    else if (typeof args.pageId === "string" && args.pageId) requirePage(env.doc, args.pageId);
    const filters = asArray<StyleFilter>(args.filters);
    const textValue = typeof args.textValue === "string" ? args.textValue : undefined;
    if (!filters.length && textValue === undefined) throw new ToolError("Pass filters, textValue or both.");
    const nodes = findNodes(env.doc, {
      filters,
      textValue,
      pageId: typeof args.pageId === "string" ? args.pageId : undefined,
      nodeId: typeof args.nodeId === "string" ? args.nodeId : undefined,
    });
    return [{ nodes, count: nodes.length }];
  },
};

export const readTools: Record<string, EditorTool> = {
  get_basic_info,
  get_selection,
  get_tree_summary,
  get_children,
  get_node_info,
  get_jsx,
  get_computed_styles,
  get_screenshot,
  get_fill_image,
  get_font_family_info,
  get_tokens,
  find_nodes,
};

export type { ToolEnv };
