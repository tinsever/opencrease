// @name Rename layers sequentially
// @description Renames the selected layers in canvas order: top to bottom, then left to right.
// @commands [{"id":"numbered","title":"Rename selection: Item 1, Item 2, ..."},{"id":"custom","title":"Rename selection with a base name"}]
//
// Example OpenCrease plugin. It runs in a sandboxed iframe with no network access and talks to the
// editor only through the `opencrease` object, whose calls mirror the MCP tools. See docs/PLUGINS.md.

export default async function run(opencrease, { command }) {
  const { selectedNodes } = await opencrease.callJson("get_selection", {});
  if (!selectedNodes.length) {
    opencrease.notify("Select the layers to rename first.");
    return;
  }

  let base = "Item";
  if (command === "custom") {
    const answer = await opencrease.prompt("Base name for the selected layers", selectedNodes[0].name.replace(/\s*\d+$/, "") || "Item");
    if (answer === null || !answer.trim()) return;
    base = answer.trim();
  }

  // read positions so "1" is the layer the eye reads first
  const placed = [];
  for (const node of selectedNodes) {
    const info = await opencrease.callJson("get_node_info", { nodeId: node.id });
    placed.push({ id: node.id, x: info.worldX ?? 0, y: info.worldY ?? 0 });
  }
  placed.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? a.y - b.y : a.x - b.x));

  const updates = placed.map((p, i) => ({ nodeId: p.id, name: `${base} ${i + 1}` }));
  await opencrease.callJson("rename_nodes", { updates });
  opencrease.notify(`Renamed ${updates.length} ${updates.length === 1 ? "layer" : "layers"}.`);
}
