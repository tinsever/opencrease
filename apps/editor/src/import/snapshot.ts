// Receives a Snapshot from the server (bridge "import-html") and adds it to the page as a new artboard:
// placed in view beside existing layers, selected, one undo step.
import { colorTokensForTrees, htmlToTrees } from "@opencrease/css";
import type { AssetMeta, NodeTree } from "@opencrease/model";
import { errorResult, textResult, type ImportHtmlRequest, type ToolResult } from "@opencrease/protocol";
import { flushSave, getOpenFile, openFile, setSelection } from "../state/workspace";
import { showPage, waitFrames } from "../agent/dom";
import { assetMeta } from "../agent/runtime";
import { pageRootId, viewportCentre } from "../canvas/insert";
import { centredAt, placeBesideExisting } from "../canvas/placement";
import { getWorldRect } from "../canvas/registry";
import { revealNodes } from "../canvas/view";
import type { Rect } from "../canvas/geometry";

const ASSET_RE = /(?:asset:\/\/|\/api\/files\/[^/"')\s]+\/assets\/)([a-f0-9]{64})/g;

/** Hashes of assets referenced by the trees (img src and url() in styles). */
export function referencedAssets(trees: NodeTree[]): string[] {
  const out = new Set<string>();
  const visit = (t: NodeTree) => {
    for (const v of [t.src, ...Object.values(t.styles ?? {}), ...Object.values(t.attrs ?? {})]) {
      if (typeof v !== "string") continue;
      for (const m of v.matchAll(ASSET_RE)) out.add(m[1]);
    }
    t.children?.forEach(visit);
  };
  trees.forEach(visit);
  return [...out];
}

function countTrees(trees: NodeTree[]): number {
  return trees.reduce((n, t) => n + 1 + countTrees(t.children ?? []), 0);
}

function px(v: unknown, fallback: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^-?[\d.]+(px)?$/.test(v.trim())) return parseFloat(v);
  return fallback;
}

export async function importHtml(req: ImportHtmlRequest): Promise<ToolResult> {
  try {
    await openFile(req.fileId);
    const file = getOpenFile(req.fileId);
    if (!file) return errorResult(`File ${req.fileId} is not open.`);
    await showPage(req.fileId, file.activePageId);
    const rootId = pageRootId(file.store.doc, file.activePageId);
    if (!rootId) return errorResult("The page has no root.");

    const parsed = htmlToTrees(req.html);
    let trees = parsed.trees;
    if (!trees.length) return errorResult("The snapshot contained no layers.");

    const metas: AssetMeta[] = [];
    for (const hash of referencedAssets(trees)) {
      if (file.store.doc.assets[hash]) continue;
      const meta = await assetMeta(req.fileId, hash);
      if (meta) metas.push(meta);
    }

    // place the artboard in view, beside whatever is already on the page
    const first = trees[0];
    const size = { width: px(first.styles?.width, 800), height: px(first.styles?.height, 600) };
    const target = centredAt(viewportCentre(), size);
    const existing = file.store.doc.nodes[rootId].children.map((id) => getWorldRect(id)).filter((r): r is Rect => !!r);
    const { dx, dy } = placeBesideExisting(target, existing);

    let created: string[] = [];
    file.store.transact(
      "Import snapshot",
      (tx) => {
        for (const m of metas) tx.addAsset(m);
        if (req.colorTokens) {
          const res = colorTokensForTrees(trees, tx.doc.tokens);
          trees = res.trees;
          for (const t of res.tokens) tx.createToken(t);
        }
        const prepared = trees.map((t, i) => ({
          ...t,
          name: i === 0 ? req.name : t.name,
          styles: { ...t.styles, left: Math.round(target.x + dx + i * 40), top: Math.round(target.y + dy + i * 40) },
        }));
        created = tx.insertTrees(rootId, prepared);
      },
      { origin: "user" },
    );
    setSelection(req.fileId, created);
    await waitFrames();
    revealNodes(created);
    await flushSave(req.fileId);
    if (getOpenFile(req.fileId)?.saveState === "error") return errorResult("The snapshot was added to the editor, but could not be saved. Keep the editor open and retry saving.");
    return textResult({ nodeId: created[0] ?? null, name: req.name, layers: countTrees(trees), warnings: parsed.warnings.slice(0, 10) });
  } catch (err) {
    return errorResult(`The snapshot could not be imported: ${(err as Error).message}`);
  }
}
