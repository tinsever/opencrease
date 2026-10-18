// Page tools: create, update, arrange.
import type { FoldDocument, PageIcon } from "@opencrease/model";
import { ToolError, type EditorTool } from "../env";
import { asArray, plural, requirePage } from "./common";

function pageList(doc: FoldDocument) {
  return doc.pageList.map((item) =>
    item.type === "page"
      ? { type: "page" as const, id: item.id, name: doc.pages[item.id]?.name ?? item.id, icon: doc.pages[item.id]?.icon ?? null }
      : { type: "divider" as const, id: item.id },
  );
}

const create_page: EditorTool = {
  write: true,
  label: (args) => `Creating page${typeof args.name === "string" && args.name ? ` "${args.name}"` : ""}`,
  run(args, env) {
    const name = typeof args.name === "string" ? args.name : undefined;
    const icon = (typeof args.icon === "string" ? args.icon : null) as PageIcon | null;
    const after = env.doc.pages[env.activePageId] ? env.activePageId : undefined;
    const pageId = env.transact((tx) => tx.createPage(name, icon, after));
    const page = env.doc.pages[pageId];
    return [
      {
        pageId,
        name: page.name,
        icon: page.icon,
        rootNodeId: page.rootId,
        pages: pageList(env.doc),
        next: "The user stays on their page. Pass this pageId to create_artboard and get_basic_info to work on it.",
      },
    ];
  },
};

const update_pages: EditorTool = {
  write: true,
  label: (args) => `Updating ${plural(asArray(args.updates).length, "page")}`,
  run(args, env) {
    const updates = asArray<{ pageId: string; name?: string; icon?: PageIcon | null }>(args.updates);
    for (const u of updates) requirePage(env.doc, u.pageId);
    env.transact((tx) => {
      for (const u of updates) {
        const patch: { name?: string; icon?: PageIcon | null } = {};
        if (u.name !== undefined) patch.name = u.name;
        if (u.icon !== undefined) patch.icon = u.icon;
        tx.updatePage(u.pageId, patch);
      }
    });
    const doc = env.doc;
    return [{ updatedPages: updates.map((u) => ({ id: u.pageId, name: doc.pages[u.pageId].name, icon: doc.pages[u.pageId].icon })) }];
  },
};

/** Check that `order` lists every page and kept divider exactly once. Returns problems (empty = ok). */
export function validatePageOrder(doc: FoldDocument, order: Array<string | { type: "divider" }>, removeDividerIds: string[] = []): string[] {
  const problems: string[] = [];
  const known = new Map(doc.pageList.map((i) => [i.id, i.type]));
  const remove = new Set(removeDividerIds);
  for (const id of remove) {
    if (!known.has(id)) problems.push(`removeDividerIds: no divider "${id}".`);
    else if (known.get(id) !== "divider") problems.push(`removeDividerIds: "${id}" is a page; pages are never removed.`);
  }
  const seen = new Set<string>();
  for (const entry of order) {
    if (typeof entry !== "string") continue;
    if (!known.has(entry)) problems.push(`"${entry}" is not a page or divider in this file.`);
    else if (seen.has(entry)) problems.push(`"${entry}" appears more than once.`);
    else if (remove.has(entry)) problems.push(`"${entry}" is listed in order and in removeDividerIds.`);
    seen.add(entry);
  }
  for (const [id, type] of known) {
    if (!seen.has(id) && !remove.has(id)) problems.push(`${type === "page" ? "Page" : "Divider"} "${id}" is missing from order.`);
  }
  return problems;
}

const arrange_pages: EditorTool = {
  write: true,
  label: () => "Arranging pages",
  run(args, env) {
    const order = asArray<string | { type: "divider" }>(args.order);
    const remove = asArray<string>(args.removeDividerIds);
    const problems = validatePageOrder(env.doc, order, remove);
    if (problems.length) throw new ToolError(`The page list was not changed. ${problems.join(" ")} Call get_basic_info for the current list.`);
    env.transact((tx) => tx.arrangePages(order, remove));
    return [{ pages: pageList(env.doc) }];
  },
};

export const pageTools: Record<string, EditorTool> = { create_page, update_pages, arrange_pages };
export { pageList };
