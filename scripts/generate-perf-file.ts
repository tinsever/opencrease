// Deterministic synthetic file: 50,000 design nodes, by default 10 artboards with 4,999 children each.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDocument, serializeFold, type FoldDocument, type OFNode } from "../packages/model/src/index.ts";

export function generatePerfFile(count = 50_000, boards = 10): FoldDocument {
  const doc = createDocument(`Canvas performance ${count}`, { id: "01PERFCANVAS000000000000000", clientId: "perf", now: 1_700_000_000_000 });
  const root = doc.nodes[Object.values(doc.pages)[0].rootId];
  let counter = 0;
  const node = (type: OFNode["type"], parentId: string): OFNode => {
    const id = `${(++counter).toString(36).toUpperCase()}-perf`;
    const n: OFNode = { id, type, parentId, name: `${type} ${counter}`, visible: true, locked: false, children: [], styles: {} };
    doc.nodes[id] = n;
    doc.nodes[parentId].children.push(id);
    return n;
  };
  for (let b = 0; b < boards; b++) {
    const frame = node("Frame", root.id);
    frame.name = `Artboard ${b + 1}`;
    frame.styles = { position: "absolute", left: (b % 5) * 1600, top: Math.floor(b / 5) * 1200, width: 1440, height: 1000, backgroundColor: "#faf9f6", overflow: "clip", display: "grid", gridTemplateColumns: "repeat(20, 1fr)", gap: 4, padding: 16 };
    const children = Math.floor(count / boards) - 1 + (b < count % boards ? 1 : 0);
    for (let c = 0; c < children; c++) {
      const n = node(c % 4 === 0 ? "Text" : "Rectangle", frame.id);
      n.styles = n.type === "Text" ? { fontSize: 10, lineHeight: "14px", color: "#373730", minHeight: 14 } : { height: 14, backgroundColor: c % 2 ? "#e5e3d9" : "#d2dbca", borderRadius: 2 };
      if (n.type === "Text") n.text = `Cell ${c + 1}`;
    }
  }
  doc.clock = counter;
  return doc;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folder = resolve(process.argv[2] ?? "/tmp/of-track4/ws/Canvas performance.fold");
  const doc = generatePerfFile(Number(process.argv[3] ?? 50_000), Number(process.argv[4] ?? 10));
  const { manifest, documentJson } = serializeFold(doc);
  await mkdir(folder, { recursive: true });
  await writeFile(resolve(folder, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(resolve(folder, "document.json"), documentJson);
  console.log(JSON.stringify({ folder, id: doc.id, pageId: Object.keys(doc.pages)[0], designNodes: Object.keys(doc.nodes).length - 1, bytes: documentJson.length }));
}
