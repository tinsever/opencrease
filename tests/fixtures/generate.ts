// Rebuild deterministic design fixtures when intentionally changing the corpus.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createDocument, DocStore, serializeFold, type NodeTree } from "../../packages/model/src/index";
import { htmlToTrees } from "../../packages/css/src/index";

const cases: Record<string, string> = {
  layout: `<div layer-name="Layout" style="width:400px;height:260px;display:flex;flex-direction:column;gap:16px;padding:24px;background:#fff8ed;overflow:hidden">
    <div style="display:flex;gap:12px;align-items:center"><div style="width:32px;height:32px;border-radius:8px;background:#eb5b21"></div><div style="font-family:Geist Variable;font-size:20px;font-weight:650;color:#352214">OpenCrease</div></div>
    <div style="display:flex;gap:12px;flex:1"><div style="flex:1;border-radius:12px;background:linear-gradient(135deg,#f4b677,#eb5b21)"></div><div style="flex:1;display:flex;flex-direction:column;gap:8px"><div style="height:46px;border:2px solid #352214;border-radius:8px;background:#ffecce"></div><div style="height:46px;background:#352214;border-radius:8px"></div></div></div>
    <div style="font-family:Geist Variable;font-size:12px;color:#69432a">Real HTML. Precise exports.</div>
  </div>`,
  typography: `<div layer-name="Typography" style="width:400px;height:260px;display:flex;flex-direction:column;gap:10px;padding:24px;background:#171d21;overflow:hidden">
    <div style="font-family:Geist Variable;font-size:11px;letter-spacing:2px;color:#8ad7bf">TYPE AND COLOUR</div>
    <div style="font-family:Geist Variable;font-size:34px;font-weight:750;line-height:38px;color:#eff6f3">Design that<br>stays editable.</div>
    <div style="font-family:Geist Variable;font-size:14px;line-height:20px;color:#acc3bb;white-space:pre-wrap">Größe, Weißraum &amp; Rhythmus.\nHTML, SVG and embedded fonts.</div>
    <div style="font-family:Geist Mono Variable;font-size:12px;color:#8ad7bf">--color-accent: #8ad7bf;</div>
  </div>`,
  vector: `<div layer-name="Vector" style="width:400px;height:260px;display:flex;align-items:center;justify-content:center;gap:24px;padding:24px;background:#eef2ff;overflow:hidden">
    <svg layer-name="Mark" width="150" height="150" viewBox="0 0 100 100"><rect x="5" y="5" width="90" height="90" rx="24" fill="#30256f"/><circle cx="50" cy="50" r="28" fill="#ffb96b"/><path d="M35 50 L46 62 L68 38" fill="none" stroke="#30256f" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div style="display:flex;flex-direction:column;gap:12px"><div style="width:100px;height:60px;border-radius:12px;background:linear-gradient(90deg,#30256f,#8c9eff)"></div><div style="font-family:Geist Variable;font-size:16px;font-weight:600;color:#30256f">Vector detail</div></div>
  </div>`,
};
for (const [name, html] of Object.entries(cases)) {
  const store = new DocStore(createDocument(name, { id: `fixture-${name}`, clientId: "fixture", now: 0 }));
  const trees: NodeTree[] = htmlToTrees(html).trees;
  trees[0]!.styles = { ...trees[0]!.styles, position: "absolute", left: 0, top: 0 };
  const [id] = store.transact("Fixture", (tx) => tx.insertTrees(Object.values(store.doc.pages)[0]!.rootId, trees));
  store.transact("Export setting", (tx) => tx.updateNode(id!, { exports: [{ format: "png", scale: "2x" }] }));
  const doc = { ...store.doc, createdAt: 0, updatedAt: 0 };
  const folder = fileURLToPath(new URL(`${name}.fold/`, import.meta.url));
  await mkdir(folder, { recursive: true });
  const out = serializeFold(doc);
  await writeFile(join(folder, "document.json"), out.documentJson);
  await writeFile(join(folder, "manifest.json"), JSON.stringify(out.manifest, null, 2) + "\n");
}
