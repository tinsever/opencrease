# Local plugins

Open a file, press Command K (Control K on Windows/Linux), then choose **Plugins**. The bundled **Rename layers sequentially** plugin numbers the selection in reading order. Its second command asks for a base name.

Install modules in `$OPENCREASE_HOME/plugins` (default `~/.opencrease/plugins`). A plugin is a single `.js`/`.mjs` file, or a directory with `plugin.json` and a main module. Plugins are read from disk each time the menu opens; restart is unnecessary. No package installation or module bundling is performed. Bundle dependencies into the single main module.

```js
// @name Rename selection
// @description Give selected layers a consistent numbered name.
// @commands [{"id":"run","title":"Rename selection"}]
export default async function run(opencrease, { command, fileId }) {
  const { selectedNodes } = await opencrease.callJson("get_selection", {});
  await opencrease.callJson("rename_nodes", {
    updates: selectedNodes.map((node, i) => ({ nodeId: node.id, name: `Item ${i + 1}` })),
  });
  opencrease.notify(`Renamed ${selectedNodes.length} layers.`);
}
```

A directory manifest has this shape:

```json
{
  "name": "Rename selection",
  "description": "Number selected layers",
  "version": "1.0.0",
  "main": "index.js",
  "commands": [{ "id": "run", "title": "Rename selection" }]
}
```

The async default export receives:

- `opencrease.call(tool, args)`: the full MCP `ToolResult`, including the file header, text and images.
- `opencrease.callJson(tool, args)`: the first JSON body after the file header. Tool errors reject the promise.
- `opencrease.notify(text)`: status text in the Plugins dialog.
- `opencrease.prompt(text, initialValue?)`: a native text prompt, returning a string or `null`.
- `{ command, fileId }`: the selected command id and the file the user invoked it from.

Tool names and arguments match MCP. File-scoped calls are pinned to the invoking file. Calls pass through the usual schema validation, required steps, undo boundaries and first-client permission prompt, identified as `plugin:<id>`. Revoke access in Settings, Agents. Server-side file tools retain their ordinary capabilities.

Each run uses an opaque-origin iframe with `sandbox="allow-scripts"`. It has no parent DOM, cookies, local storage, network, forms, child frames or workers. The host verifies message sources before forwarding calls; source is never evaluated by the server or the editor window. Runs are removed after completion, failure or two minutes. This API has no persistent background execution. Source files are limited to 2 MB.
