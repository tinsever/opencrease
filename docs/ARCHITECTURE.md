# OpenCrease architecture

This document describes the integrated runtime, data contracts and subsystem boundaries. `SPEC.md` records the broader product plan; this document describes the implemented product.

## Runtime topology

```
 ┌──────────────── browser tab (apps/editor, React) ────────────────┐
 │  DocStore per open file (@opencrease/model)                         │
 │  Canvas renders nodes as real DOM, overlay draws selection         │
 │  Agent bridge: executes MCP tools against the store and the DOM   │
 └──────────────▲───────────────────────────────▲────────────────────┘
        REST /api/* (files, assets, guide)     WebSocket /bridge
 ┌──────────────┴───────────────────────────────┴────────────────────┐
 │ apps/server  ("opencrease" CLI, Node)  http://127.0.0.1:29880         │
 │  workspace on disk (*.fold directories), MCP over Streamable HTTP   │
 │  at /mcp, tool router: server-side tools or forward to the editor   │
 └──────────────▲─────────────────────────────────────────────────────┘
                │ POST /api/tools/call
        `opencrease mcp` (stdio MCP server for Claude Code, Codex, ...)
```

The live document is owned by the editor tab that has the file open, like Paper Desktop. The server persists files and routes tool calls. When an agent calls a tool for a file and no editor is connected, the server opens the browser at the editor URL and waits up to 15 s for the bridge to connect.

There is no CRDT and no collaboration in v0.1 (SPEC §11 is deferred). The model uses immer patches for undo/redo. Node IDs keep the `<counter-base36>-<clientId>` shape.

## Packages

| Path | Package | Owns |
|---|---|---|
| `packages/format` | `@opencrease/format` | Portable types, document factory, normalization, ids, serialization, schema and Node directory I/O |
| `packages/model` | `@opencrease/model` | Store contracts, `DocStore`, transactions, queries and format compatibility exports |
| `packages/css` | `@opencrease/css` | Style allowlist, style normalisation, HTML → `NodeTree[]`, node → JSX / HTML / Tailwind, React style conversion, colour utilities |
| `packages/protocol` | `@opencrease/protocol` | MCP tool definitions (names, descriptions, zod input schemas, read-only flag, execution side), bridge message types, result helpers |
| `apps/server` | `opencrease` | CLI, HTTP server, workspace fs, MCP (Streamable HTTP + stdio proxy), bridge hub, design guide files |
| `apps/extension` | `@opencrease/extension` | Snapshot MV3 WebExtension; esbuild bundles shared CSS normalisation into Chrome and Firefox builds |
| `apps/editor` | `@opencrease/editor` | The React app |
| `apps/desktop` | `@opencrease/desktop` | Electron shell, native menus, workspace settings, system fonts, agent config setup and packaging |

All packages are TypeScript ESM consumed from source (`main: src/index.ts`); no build step for packages. The server runs with `tsx`. The editor builds with Vite into `apps/editor/dist`, which the server serves.

## Portable format

`@opencrease/format` owns the portable types, normalization, factory, ids, token serialization and `.fold` serialization, with no runtime dependencies. `@opencrease/model` keeps compatibility exports for existing imports. The Node-only `@opencrease/format/node` entry reads/writes unpacked `.fold` directories. `packages/format/document.schema.json` is the published Draft-07 document schema. Format, CSS and protocol packages have explicit MIT licences; the root licence is unchanged.

Format v1 supports unpacked `.fold` directories. ZIP/CRDT snapshots and npm publication are not part of this implementation. Format contracts and normalization belong in `packages/format/src`; live transactions and queries belong in model. See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution attestation and licensing.

- `createDocument(name: string, opts?: { id?: string; clientId?: string; now?: number }): FoldDocument` creates one page named "Page 1" with its Root node.
- IDs: nodes `${(++clock).toString(36).toUpperCase()}-${clientId}`; pages `p-${n}-${clientId}`; root node id `root_${pageId}`; token ids `t-${n}-${clientId}`; divider ids `d-${n}-${clientId}`. File ids: 26-char Crockford base32 ULID (`newFileId()`).
- Format (pure): `serializeFold(doc): { manifest: object; documentJson: string }` with stable key order and 2-space indentation, `parseFold(documentJson: string): FoldDocument` (validates `formatVersion`, fills missing defaults), `FORMAT_VERSION = 1`.
- Token helpers: `tokensToCss(tokens): string` (`:root { ... }`), `tokensToTailwind(tokens): string` (`@theme { ... }`), `tokenCssVars(doc): Record<string,string>` (name → value, for injecting on the canvas root).

## Document model and transactions

Transactions and queries live in `packages/model/src`; portable contracts come from `@opencrease/format` through compatibility exports. `contracts.ts` defines the store and transaction API.

- `DocStore implements IDocStore` with immer `produceWithPatches`. A transaction records patches + inverse patches as one history entry. `mergeKey` merges consecutive entries (for drags). History cap 500. `updatedAt` bumps on every commit.
- Node defaults when inserted from a `NodeTree`: `visible: true`, `locked: false`, `styles: {}`, `children: []`. Names: explicit `name`, else Text → first 40 chars of text (newlines → spaces), Image → "Image", SVG → "SVG", SVGElement → capitalised tag ("Path", "Circle", "Rect"), Shader → shader name, Frame → "Frame", Rectangle → "Rectangle". A tree with no `type` is a Frame if it has children, else Rectangle; with `text` it is Text.
- `cloneOf` in a tree deep-copies that node (new ids) then merges `styles`.
- Validation: Text/Rectangle/Image/Shader cannot have children; SVGElement only under SVG or SVGElement; only SVGElement under SVG. Throw `ModelError` (exported class with `code` string).
- Queries per `Queries` interface, exported as plain functions (`getNode`, `pageOfNode`, `artboardOf`, ...).
- Components (SPEC §4.9, `component-types.ts`, `components.ts`, `library.ts`). All fields are optional, so older files load unchanged:
  - `OFNode.component` marks a Frame as a main component: `{ props: ComponentPropDef[], variant?, codeRef?, description? }`. Prop types: `text` (drives a Text layer), `boolean` (visibility of a layer), `enum` (variant axis, derived from the `variant` values of the components in a set), `instance-swap` (component of a nested instance), `slot` (a frame whose children belong to each instance). `target` is the id path of the bound layer inside the main component (`""` is the component itself).
  - `OFNode.componentSet` marks a Frame whose child components are variants of one component.
  - `OFNode.instance` marks a Frame as an instance: `{ componentId, library?, props, overrides }`. Its layers are generated from the main component and carry `source` (the id path they mirror). Overrides are keyed by that path (`""` instance frame, `"A-0"` a layer, `"B1-0/C2-0"` a layer of a nested instance) and hold `styles` (null removes a style), `text`, `visible`, `name`, `src`, and `props`/`componentId` for nested instances.
  - Edits go through `Tx` as usual: `TxImpl` owns `ComponentHooks`, which turns edits of generated layers into overrides, refuses structural edits inside instances (except in slots) and component cycles, and regenerates affected instances in `finalize()` before each commit, so every change stays one undo step. Exported helpers take a `Tx`: `createComponent`, `setComponentDef`, `createComponentSet`, `addVariant`, `createInstance`, `setInstanceProps`, `resetOverrides`, `detachInstance`, `removeComponent`.
  - A `NodeTree` with `instance: InstanceTreeSpec` (`{ component, library?, props?, overrides?, slots? }`) builds an instance; `children` are only a fallback when the component is missing.
  - Libraries: `FoldDocument.library` records this file's last published version; `FoldDocument.libraries[fileId]` holds a copy of each subscribed library (components, tokens, assets). `buildLibrarySnapshot`, `applyLibrary` (subscribe or update, keeps overrides), `diffLibrary`, `unsubscribeLibrary` (detaches instances).
- Tests with vitest next to the code (`*.test.ts`).

### Optional paint metadata

`OFNode.paint` and `NodeTree.paint` are optional `NodePaint` values. Files without paint continue to load without a version change. `Tx.insertTrees`, `updateNode`, cloning and `.fold` serialisation preserve this field; `updateNode({ paint: undefined })` removes it.

- `shader?: ShaderSpec` holds one shader fill. On frames and rectangles it paints above the CSS backgrounds and below children in an isolated stacking context. It stays at the top of the inspector fill stack.
- `shaderHidden?: boolean` hides that fill without losing its parameters.
- `hiddenFills?: { index: number; css: string; size?: string; position?: string; repeat?: string; blend?: string }[]` stores hidden CSS fills. Indices refer to the CSS fill stack, excluding the shader. Hidden layers produce no CSS until shown again.

The inspector writes paint and background styles in one transaction, so hide, show and reorder are undoable together. The model does not interpret CSS paint syntax.

## CSS, import and code generation

```ts
export const ALLOWED_STYLES: ReadonlySet<string>;              // camelCase, per SPEC §4.2 (+ WebkitTextStroke, WebkitBackgroundClip, fontSynthesis, etc.)
export function normalizeStyles(input: Record<string, unknown>): { styles: StyleMap; ignored: string[] };
//   kebab → camel, drops non-allowlisted and inert keys, numbers kept as numbers, "px" strings kept as given,
//   margin*: dropped and reported in `ignored`. display:grid is preserved; inline/inline-block → "block" with an ignored note.
export function parseInlineStyle(css: string): Record<string, string>;   // "a: b; c: d" → { a: "b", c: "d" } (camelCased)
export function htmlToTrees(html: string, opts?: { resolveAssetUrl?(url: string): string }): { trees: NodeTree[]; warnings: string[] };
export function toReactStyle(styles: StyleMap): Record<string, string | number>;  // for the renderer
export function nodeToJsx(doc: FoldDocument, id: NodeId, opts: { format: "tailwind" | "inline-styles"; includeNodeIds?: boolean; includeRootPositioning?: boolean }): string;
export function nodeToHtml(doc: FoldDocument, id: NodeId, opts?: { includeNodeIds?: boolean }): string;
export function stylesToTailwind(styles: StyleMap, tokens: Token[]): { classes: string[]; rest: StyleMap };
export function parseColor(value: string): { mode: string; [k: string]: unknown } | undefined;   // culori
export function colorsEqual(a: string, b: string): boolean;
export function formatColor(value: string, mode: "hex" | "oklch" | "rgb" | "hsl"): string;
```

HTML parsing rules (used by MCP `write_html`, paste and Snapshot):
- Parse with htmlparser2. Only inline `style` attributes carry styling. `class`, `id` are ignored.
- `layer-name="..."` sets the node name.
- `<x-paper-clone node-id="X" style="...">` and `<x-clone ...>` become `{ cloneOf: "X", styles }`.
- `<img src>` → Image. `paper-asset://` and `asset://` URLs go through `resolveAssetUrl`.
- `<svg>` → SVG node with all descendants as SVGElement (attributes kept verbatim in `attrs`, element `style` parsed into styles). The svg's width/height attrs are copied to styles when no style size is set.
- An element whose children are only text/inline formatting (`span`, `b`, `strong`, `i`, `em`, `br`, `a`, `small`, `code`) → one Text node. `<br>` → "\n". Inline formatting is preserved as Text spans; a fully wrapped run can use the node style. Whitespace collapses like HTML except inside `<pre>` or `white-space: pre*`.
- An element with element children → Frame; bare text runs mixed with elements become Text children.
- An empty container with layout styles becomes a Frame; other empty elements become Rectangle nodes.
- `<canvas data-shader="MeshGradient" data-params='{"...":...}'>` → Shader node.
- Default styles: none, except `pre`/`code` get `whiteSpace: "pre"` and `fontFamily: "monospace"` when not set; `b/strong` fontWeight 700; `i/em` fontStyle italic; `h1`–`h6` get nothing (agents must style explicitly).
- Unsafe tags such as script, style and iframe are dropped. Unsupported safe markup is flattened where sensible and reported through warnings.

Round trip requirement: `htmlToTrees(nodeToHtml(x))` inserted into a doc reproduces the same structure, styles and text. Test it.

Tailwind export: map common properties to Tailwind v4 classes (flex, flex-col, items-*, justify-*, gap-[..], p-[..], w-[..], text-[..], font-*, rounded-[..], bg-[..]). Use token names when a style is `var(--x)` (`bg-(--color-primary)` → prefer `bg-primary` when the token is `--color-primary`). Unknown → keep in `style`.

### Paint and colour round trips

HTML serialisation stores optional paint as an escaped JSON `data-of-paint` attribute; HTML parsing restores it onto the node, rather than adding child layers. Standalone HTML needs a renderer for dynamic shader fills. JSX emits the shader component as an absolutely positioned child below content. `shaderComponentsIn(doc, id)` returns the visible shader component names needed for imports; the Code tab adds the `@paper-design/shaders-react` import for React and Tailwind.

`mapColorsInValue(value, fn)` rewrites colour literals and token references within composite CSS, preserving other syntax and URLs. The inspector uses it for bulk selection colour replacement, including SVG attributes and hidden fill CSS. Colour grouping uses unclipped RGB channels so wide-gamut values do not collapse onto sRGB primaries.

Components in code export:
- `nodeToJsx` emits `<Button variant="primary" label="Pay now" />` plus an import line (`import { Button } from "@acme/ui";`) for instances whose component (or component set) has `codeRef: { package, export, propsMap? }`. `propsMap` renames design props (`""` leaves a prop out); a prop mapped to `children` becomes the element's children; slots become children. Without a `codeRef`, instances export as their layers. `codeComponents: false` turns the mapping off.
- `nodeToHtml(..., { instances: "tags" })` writes instances as `<x-instance component="ID" props='{...}' overrides='{...}' layer-name="..." style="...">` with `<x-slot name="...">` children and the layers as fallback (used for copy and paste).
- `htmlToTrees` (and so `write_html`) accepts `<x-instance component="ID, name, set name or code export" library="fileId" label="Hi" variant="ghost">`. Attributes other than `component`, `code`, `library`, `props`, `overrides`, `style`, `layer-name`, `id`, `class` and `data-*` are prop values (design or code prop names; a bare attribute or `{true}` is `true`, `{false}` is `false`, `{"text"}` is JSX-style). `props='{...}'` passes them as JSON. `<x-slot name="content">...</x-slot>` fills a slot; plain text children set the prop mapped to `children`. Code component tags from `get_jsx` (`<Button variant="ghost">Shop</Button>`) are accepted too when a component in the file maps to that export.

## MCP protocol and tools

```ts
export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;                 // Paper-compatible names
  title: string;
  description: string;          // our own wording
  inputShape: S;                // zod raw shape (for McpServer.registerTool)
  readOnly: boolean;
  side: "server" | "editor";    // where it executes
  timeoutMs?: number;
}
export const TOOLS: ToolDef[];
export function getTool(name: string): ToolDef | undefined;

export type ContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface ToolResult { content: ContentBlock[]; isError?: boolean }
export function textResult(...parts: Array<string | object>): ToolResult;   // objects are JSON.stringified (2-space)
export function errorResult(message: string): ToolResult;

// Bridge (WebSocket /bridge). Editor ⇄ server.
export type EditorToServer =
  | { type: "hello"; editorId: string; version: string; openFiles: OpenFileInfo[]; activeFileId: string | null }
  | { type: "state"; openFiles: OpenFileInfo[]; activeFileId: string | null }
  | { type: "result"; callId: string; result: ToolResult };
export type ServerToEditor =
  | { type: "call"; callId: string; tool: string; args: Record<string, unknown>; client: AgentClientInfo }
  | { type: "open-file"; fileId: string; pageId?: string }
  | { type: "file-changed-on-disk"; fileId: string }
  | { type: "import-html"; callId: string; request: ImportHtmlRequest };
export interface ImportHtmlRequest { fileId: string; html: string; name: string; colorTokens?: boolean }
export interface OpenFileInfo { id: string; name: string; activePageId: string }
export interface AgentClientInfo { name: string; version?: string }   // from MCP initialize clientInfo
```

### Tool list

Every file-scoped tool takes `fileId` (string, required unless noted) and its result starts with a text block `{"file":{"id","name"},"contentHash":{"tokens": "<fnv1a of tokens JSON>"}}`.

Server side: `list_resources({limit?})`, `create_file({name?, cloneFileId?})`, `rename_resource({id, name})`, `open_file({fileId, pageId?})` (asks the editor to open it, returns the same payload as get_basic_info), `get_guide({topic})`.

Editor side:
- Read: `get_basic_info({fileId?, pageId?})` (fileId optional: active file), `get_selection({fileId?})`, `get_tree_summary({fileId, nodeId, depth?})`, `get_children({fileId, nodeId})`, `get_node_info({fileId, nodeId})`, `get_jsx({fileId, nodeId, format?, includeNodeIds?, includeRootPositioning?})`, `get_computed_styles({fileId, nodeIds})`, `get_screenshot({fileId, nodeId, scale?})`, `get_fill_image({fileId, nodeId})`, `get_font_family_info({fileId, familyNames})`, `get_tokens({fileId, format?, types?, namePattern?, mode?})`, `find_nodes({fileId, filters?, textValue?, pageId?, nodeId?})`.
- Write: `create_page({fileId, name?, icon?})`, `update_pages({fileId, updates})`, `arrange_pages({fileId, order, removeDividerIds?})`, `create_artboard({fileId, name, styles, pageId?})`, `write_html({fileId, targetNodeId, mode: "insert-children"|"replace", html})`, `update_styles({fileId, updates: [{nodeIds, styles}]})`, `set_text_content({fileId, updates: [{nodeId, textContent}]})`, `rename_nodes({fileId, updates: [{nodeId, name}]})`, `move_nodes({fileId, moves})`, `duplicate_nodes({fileId, nodes: [{id, parentId?}]})`, `delete_nodes({fileId, nodeIds})`, `create_tokens({fileId, tokens, mode?})`, `set_tokens({fileId, updates?, deletes?, mode?})` (tokens and updates take optional per-mode `modes: {dark: "#111"}`), `export({fileId, nodes, type?, pageId?})`, `export_combined_pdf({fileId, nodeIds})`, `finish_working_on_nodes({fileId, nodeIds?})`.
- OpenCrease extensions: `oc_set_mode({fileId, collections?: [{name, modes, renames?, delete?}], pins?: [{nodeId, mode|null}]})`, `oc_set_text_styles({fileId, styles?: [{name, styles?, newName?, description?, delete?}], apply?: [{nodeIds, style|null}]})`.

- Components (`oc_` tools, `packages/protocol/src/component-tools.ts`): `oc_list_components({fileId, includeLibraries?})`, `oc_create_component({fileId, nodeIds, name?, props?, codeRef?, description?})`, `oc_create_component_set({fileId, componentIds, name?, propName?, values?, codeRef?})`, `oc_set_component_props({fileId, componentId, props?, codeRef?, variant?, name?, description?})`, `oc_create_instance({fileId, componentId, parentId, index?, library?, props?, styles?, name?})`, `oc_set_instance_props({fileId, updates: [{instanceId, props}]})`, `oc_reset_overrides({fileId, nodeIds})`, `oc_detach_instance({fileId, nodeIds})`. `get_tree_summary` labels instances `Instance "Name" (id) of "Component" (mainId)`; `get_node_info` adds `kind`, `componentId`, `props`, `overrideCount` and `codeRef`.

Shapes follow Paper's public MCP tool interface (see SPEC §8.2). Results mirror Paper's: e.g. `write_html` returns `{ createdNodes: [{ id, name, component, worldX, worldY, x, y }] }`, `update_styles` returns per node `ignoredStyles`, `duplicate_nodes` returns `descendantIdMap`, `move_nodes` returns `affectedParents`.

Runtime input forgiveness lives in `packages/protocol/src/arguments.ts`, before canonical Zod validation. REST, stdio MCP and Streamable HTTP all use it; `tools/list` and WebMCP still publish the original Paper shapes. Omitted required `fileId` uses the connected editor's active file, never an arbitrary workspace file. `get_guide({})` loads the craft guide. Unambiguous single ids/lists and `id`/`nodeId`/`nodeIds` aliases are accepted, including component/instance targets, single edits instead of batches, top-level style/text edits, `text` for `textContent`, duplicate/export id lists and font-family names. `write_html` accepts `parentId` only for `insert-children`; replacement still requires an explicit target. Conflicting aliases and multi-id inputs for a single target fail before mutation. Validation errors include a valid canonical example for that tool.

Token names gain `--` when omitted. Missing types are inferred from CSS colours, dimensions (spacing by default), quoted or listed font families, and category names such as `font-weight-*`, `opacity-*` and `radius-*`. Ambiguous numeric values and aliases require an explicit supported type. General `number`, `dimension` and `shadow` categories are not part of the Paper-compatible token model. Artboard name and dimensions remain required, matching Paper's schema; an empty call returns a 1440×900 example.

Each agent write is one undo step with origin "agent". Agent writes mark the touched artboards as "agent working" until `finish_working_on_nodes` or 90 s of inactivity.

Review nudges (SPEC §8.5): after 5 writes to the same artboard without a `get_screenshot` of it, write tools append a text block: `Review checkpoint: take a screenshot of "<artboard name>" and check spacing, type, contrast, alignment and clipping before continuing.`

## Server

CLI (`src/cli.ts`):
- `opencrease [workspaceDir] [--port 29880] [--no-open]` starts the server (workspace default `~/Documents/OpenCrease`, created if missing) and opens the browser.
- `opencrease mcp [--port]` stdio MCP server. Tool calls go to `POST http://127.0.0.1:<port>/api/tools/call`. If the server is not running, spawn it detached (`opencrease --no-open <default workspace>`) and retry for 10 s.

HTTP (Node `http` + `ws`, no framework):
- `GET /api/status` → authenticated `{ app, version, port, mcpUrl, workspace, editorConnected, openFiles }`; public response is described below
- `GET /api/files` → `[{ id, name, path, folder, updatedAt, hasThumbnail }]` (recursive scan for `*.fold` dirs, ignore dot dirs)
- `POST /api/files` `{ name?, cloneFileId?, folder? }` → `{ id, name, path }`
- `GET /api/files/:id` → FoldDocument; `PUT /api/files/:id` (body FoldDocument) → `{ ok, updatedAt }`; `PATCH /api/files/:id` `{ name }`; `DELETE /api/files/:id` (moves to `<workspace>/.trash/`)
- `GET|PUT /api/files/:id/thumbnail` (image/png)
- `POST /api/files/:id/assets` (raw body, `content-type`, optional `x-filename`) → AssetMeta; `GET /api/files/:id/assets/:hash`
- `POST /api/files/:id/exports` (raw body, `x-filename`) → `{ path }`, written to `<workspace>/Exports/<file name>/` (the browser cannot write files, and the `export` tool returns paths)
- `GET /api/libraries` → `[{ fileId, name, version, publishedAt, componentCount, tokenCount }]` (files that published a library)
- `GET|PUT /api/files/:id/library` read or publish a `LibrarySnapshot`, stored as `<Name>.fold/library.json` (a cloned file's copy is ignored until it publishes itself); `POST /api/files/:id/library/copy-assets` `{ to }` copies the library's assets into a subscriber
- `GET /api/guide?fileId=` → `{ layers: [{ id: "builtin"|"user"|"file", label, path, content, editable }], merged }`; `PUT /api/guide/:layer?fileId=` (text body; builtin is read-only)
- `POST /api/snapshot` `{ html, name?, target?: {kind: "active"|"new"|"file", fileId?, name?}, colorTokens?, url? }` → `{ ok, fileId, fileName, nodeId, layers, url, delivered: "editor"|"disk", warnings }`. Inline image data becomes file assets. A connected editor imports through the bridge in one undo step; otherwise the server inserts on disk without launching a browser. Extension-origin CORS is limited to this endpoint and `GET /api/status`. See `docs/IMPORT.md`.
- `POST /api/tools/call` `{ tool, args, client }` → ToolResult (shared executor used by both transports)
- `GET /api/fonts/css2?…` and `/api/fonts/css?…` Google Fonts stylesheet proxy (font URLs rewritten to the proxy), `GET /api/fonts/files/<path>[?query]` font files, `GET /api/fonts/families` compact family list with styles and variable axes. Cached under `~/.opencrease/fonts` (`OPENCREASE_HOME`): stylesheets and the family list refresh weekly and fall back to the cached copy offline, font files are kept forever (`apps/server/src/fonts.ts`)
- `/mcp` Streamable HTTP MCP endpoint (stateful sessions, `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport`)
- `WS /bridge` editor connections; the last editor that sent `hello` or `state` is the active one
- Everything else: static files from `apps/editor/dist` with SPA fallback to `index.html`. If dist is missing, return a small HTML page telling you to run `pnpm build` or use `pnpm dev`.
- Bind to 127.0.0.1 only.

On-disk file: `<workspace>/<folder>/<Name>.fold/` with `manifest.json` (`{ formatVersion, id, name, app: "opencrease 0.1.0" }`), `document.json`, `assets/<hash>.<ext>`, `thumbnail.png`, optional `guide.md` and `library.json`. Writes are atomic (write temp + rename). The id index is rebuilt by scanning at startup and on demand.

Guide files: built-in `apps/server/guides/craft.md` (shipped), user `~/.opencrease/guide.md`, file `<file>.fold/guide.md`. `get_guide({topic: "craft" | "mcp-instructions"})` returns the merged guide (built-in, then user, then file of the active file). Unknown topic → list of topics.

### Authentication and agent access

The server binds only to loopback. REST, HTTP MCP and bridge upgrades require the random local token in `$OPENCREASE_HOME/token` (default `~/.opencrease/token`, mode 0600). It is created once and reused across restarts and ports. Concurrent first starts publish one complete token atomically. `OPENCREASE_TOKEN` overrides the saved token without replacing it; explicit overrides have temporary per-port discovery files under `sessions/` so stdio and Vite still find them. Normal shutdown leaves the shared token intact.

`GET /api/session` returns the authenticated token, header name and `canResetToken`. Settings → Agents calls `POST /api/session/reset-token` to atomically rotate the shared credential and refresh the current editor's cookie. Servers sharing the configuration directory observe the change, close existing MCP/bridge transports and reject the old token. HTTP clients and Snapshot must be updated; stdio and Vite read credentials automatically on each request. Reset returns 409 while a server token override is active; change the override at its source instead. Native clients send `Authorization: Bearer <token>` or `X-OpenCrease-Token`; HTTP MCP also accepts `?token=` for clients without header configuration. The unauthenticated `/api/status` response contains only app, version and auth-required state.

`/auth` exchanges a token for an HttpOnly, SameSite Strict cookie. Cookies are named per server port and accepted only for same-origin browser requests. Host checks reject DNS rebinding; foreign browser origins are refused even with a token. Loopback pages must send an explicit token for cross-origin API calls. Snapshot extension origins are restricted to status and snapshot import, with an explicit token for full status and imports; the minimal status remains public. The normal browser opener uses a private launch file to avoid putting the credential in a process command line. Vite reads the token on each proxied request, but adds it only to requests from its own origin. Stdio reads it for each HTTP call. Headless sessions install a cookie for their isolated editor and skip interactive agent approval because the CLI invocation authorizes the session. They do not forward credentials to external resource hosts.

Agent decisions persist per client name in `$OPENCREASE_HOME/agents.json`. The bridge carries `permission-request`/`permission-response` messages. `PermissionHost` presents the first-call question; Settings, Agents can allow, forget or revoke clients. Names are consent labels, not authentication identities. The token provides transport authentication. Read-only MCP tools carry `readOnlyHint`. WebMCP feature-detects both current `document.modelContext` and older `navigator.modelContext`, exposing the same schemas, annotations and server execution path. See the [Chrome imperative API documentation](https://developer.chrome.com/docs/ai/webmcp/imperative-api) for the current browser surface.

### Guide policy, history and plugins

Required-step policy comes from the layered guide and accompanies every editor call. `oc_post_brief` persists per-artboard or whole-file briefs. The editor wraps writes with the brief gate, token equivalence warnings, a 60-layer threshold and the existing five-write review tracker. See `docs/QUALITY.md` for the fixed prompt set and recording workflow.

History is `<file>.fold/history/{index.json,<version>.json}`. Saves snapshot changed content at most every five minutes; automatic history is capped at 100 entries, and named versions are retained. Version numbers are never reused. REST routes under `/api/files/:id/versions` list, create, read, rename and remove snapshots. Version history in the command palette lists and previews snapshots, compares nodes visually and restores in one undo step after saving the current state. `oc_get_diff({fileId,sinceVersion?})` compares a stored snapshot with the live document without writing anything. Omit `sinceVersion` to list available baselines.

Plugins are listed from `$OPENCREASE_HOME/plugins` and the bundled examples. The server serves modules but never executes them. The editor runs each module in a network-disabled, opaque-origin sandbox iframe and forwards source-checked tool messages through the usual router and permissions. The Plugins command opens available commands. See `docs/PLUGINS.md`.

## Editor

```
apps/editor/
  index.html, vite.config.ts           coordinator
  src/main.tsx, src/App.tsx            coordinator (routing: "/" home, "/file/:id/:pageId?" editor)
  src/state/                           coordinator: workspace store (open files, active file, DocStore per file,
                                       selection, hover, active tool, viewport per page, agent activity), React hooks, REST client, autosave
  src/styles/theme.css                 chrome tokens (--of-*)
  src/ui/                               shared primitives (Icon, Button, IconButton, Field, NumberField, Segmented, Toggle, Section, Menu, Popover, Tooltip)
  src/chrome/                           TitleBar with file tabs, sync/save status
  src/home/                             files home screen
  src/canvas/                           renderer, viewport, overlay, interactions, toolbar, text editing, fonts loader
  src/panels/left/                      file header, Layers/Theme/Assets tabs, pages, layer tree
  src/panels/right/                     header with agent status, Design/Code/Agent tabs, inspector sections
  src/agent/                            WebSocket client, tool executor, screenshot/export, agent activity
```

Rules for the canvas (SPEC §4.1):
- Content is real DOM. Each node element has `data-of-id="<id>"`. Artboards are absolutely positioned children of a world element transformed with `translate(x,y) scale(z)`. Node styles are applied with `toReactStyle` from `@opencrease/css`. Document tokens are injected as CSS custom properties on the content root.
- `src/canvas/registry.ts` exports `getNodeElement(id): HTMLElement | null`, `getWorldRect(id): { x, y, width, height } | null` (world coordinates, unaffected by zoom), and `screenToWorld/worldToScreen`. The agent bridge uses these.
- The overlay (selection, hover, handles, size badge, agent working outline) is drawn in screen space above the world. Rotated selections use oriented boxes; world angles include ancestor rotation. Gestures store the CSS `rotate` property, and multi-selection transforms adjust positioned nodes proportionally.
- `OFNode.constraints?` stores `{ horizontal: "left"|"right"|"center"|"scale"|"stretch", vertical: "top"|"bottom"|"center"|"scale"|"stretch" }`. Absence means left/top. `NodeTree` optionally carries constraints, visibility and lock state for clipboard transfer. Canvas resize, inspector size writes and MCP `update_styles` apply constraint patches in the same undo transaction.
- Grid is native DOM/CSS layout. `display: grid`, `gridTemplateColumns`, `gridTemplateRows`, `gridColumn`, `gridRow` and gaps are allowlisted and retained by HTML import/export. The Grid inspector edits templates and placement; the overlay reads resolved track sizes.
- `TopLayer`, `virtual.ts` and `lod.ts` replace offscreen subtrees with sized placeholders, with 20% viewport mounting and 40% unmounting margins. Below 10% zoom, visible artboards request idle raster captures. Selected, edited and agent-pinned artboards remain live. Unknown-size layers render live until measurable. Read-only responsive copies do not register elements with the canvas registry.
- Node refs register DOM elements in a map. `getWorldRect` caches measurements per animation frame; document, font and canvas-size changes invalidate the cache. Hit testing uses the browser's transformed DOM geometry, while snapping, overlay and MCP share world measurements. Agent calls pin referenced top-level layers before layout reads; direct screenshots/exports also mount placeholder subtrees.
- Node subscriptions fan out `ChangeEvent.touched` through one listener per store. The layer tree renders only visible rows plus overscan, and overlay labels/measurements are limited to visible artboards plus selected/working nodes. User content uses `contain: strict`.
- `state/prefs.ts` owns locally persisted theme, wheel zoom, inverted zoom, reduced agent motion and sidebar widths. `installPrefs` resolves system appearance and motion preferences to root attributes. Document styles and tokens remain independent.
- The clipboard retains interoperable HTML plus URI-encoded node trees in `data-of-trees`, with a source file ID for local asset transfers. Internal tree styles are allowlisted again when pasted. Paste to replace is Shift-Command-R; multi-selection PNG copy composites the selected layers with transparent spacing.
- Google Fonts used in the document are loaded on demand through the server's font cache (`/api/fonts/css2`). Variable families (known from `/api/fonts/families`) load their full axis ranges, so any weight, the axis sliders and automatic optical sizing work; others load the static weights in use. Exported code still links `fonts.googleapis.com`.

Home and Settings use the ICU message catalog in `apps/editor/src/i18n`; English is the fallback and partial locale catalogs can be registered. Remaining editor screens can migrate incrementally. Shortcut letters use `KeyboardEvent.code` for layout-independent physical keys; typing, composition, dialogs and panel controls retain their own keyboard handling. Modal focus is contained, chrome focus rings are visible and editor panels have accessible names.

### Artboard Preview

The inspector play button, command palette and Alt-P (Option-P on macOS) open `/preview/<fileId>/<nodeId>` in a browser tab or desktop window. Selection resolves to its containing artboard, then falls back to the active page's first top-level Frame. With no artboard the action explains that one must be added.

`src/preview/html.ts` wraps the existing `nodeToHtml` export in a script-free sandboxed page, resets only the artboard's canvas positioning, includes theme/mode variables, bundled Geist faces and cached Google Fonts, and resolves local assets through authenticated same-origin URLs. It keeps the artboard's actual size and scrolls naturally. This is HTML export fidelity; animated shader canvases/fills are not rendered by static HTML.

The Preview route starts no editor bridge or document store. The editor publishes its live document through a per-file `BroadcastChannel`, coalescing edits by 80 ms and stopping unsolicited updates after heartbeat expiry. Viewers request on open and every two seconds; saved-document polling supplies independently opened previews when no live editor responds. Reload works, scroll position survives updates, and removal of the previewed artboard shows an error. `scripts/ergonomics-review.ts [log.jsonl] [--desktop]` replays failed REST calls against a temporary workspace on 29912/5212 and checks browser/hidden Electron Preview. Evidence goes to `test-results/ergonomics`.

### Tokens and typography

- Token aliases are `var(--other)`; transactions reject alias cycles, also per mode (`findModeCycle`).
- Modes: `FoldDocument.modeCollections?: [{id, name, modes}]`. The first mode is the default and uses `Token.value`; other modes live in `Token.modes?: {dark: value}`. A token varies by at most one collection. Mode names are lowercase identifiers, unique across collections. Frames pin modes with `OFNode.mode?: "dark compact"`, rendered as `data-mode`; the canvas adds `<scope> [data-mode~="dark"] { … }` blocks (`modeScopeCss`) that re-declare varying tokens and every alias that depends on them. Export: `themeToCss` (`:root` plus `[data-mode~="x"]` blocks), `themeToTailwind` (`@theme`, a `@custom-variant` per mode, overrides in `@layer base`), `tokensToDtcg`/`parseDtcg` (W3C DTCG JSON, modes and exact CSS names in `$extensions.opencrease`). `importTokens(tx, data)` applies CSS, Tailwind or DTCG imports and pasted tokens.
- Theme tab: mode switcher per collection (shows that mode's values), per-mode values in the token detail, multi-select (⌘/⇧ click, ⌘A), ⌫ delete, ⌘D duplicate, ⌘C/⌘V copy and paste tokens between files (the clipboard carries DTCG JSON), hover or selection outlines the layers that use a token (`canvasUi.highlight`), text styles list, import (CSS with `[data-mode]`/`.dark` blocks, Tailwind `@theme`, DTCG JSON or a dropped file) and export (CSS, Tailwind, DTCG, downloads). Frames get a Token modes inspector section. ⌫ in a bound number or colour field detaches the token and keeps its value.
- Text styles: `FoldDocument.textStyles?: [{id, name, styles, description?}]`, `OFNode.textStyle?` links a Text node. Applying copies the values; updating a style rewrites linked nodes except overridden properties. Code export: Tailwind format emits the style's class (`@utility <slug>` from `textStylesToTailwind`), CSS classes come from `textStylesToCss`; the Code tab's "Copy theme" copies tokens, modes and text styles.
- Rich text: `OFNode.spans?: [{text, styles?}]` on Text nodes, texts joined equal `text`. HTML/JSX export nested `<span>`s; `write_html` keeps inline formatting (`<b>`, `<i>`, `<span style>`) as spans and plain text stays plain. Changing `text` without `spans` (e.g. `set_text_content`) drops spans unless the text is unchanged. In-place editing (`canvas/rich-edit.ts`) styles the selected range (⌘B, ⌘I, ⌘U, typography hotkeys), and while a range is selected the Typography section reads and writes that range (`inspector/text-range.ts`).
- Typography: Text details section with variable axis sliders from font metadata (weight writes `font-weight`, others `font-variation-settings`), automatic optical size, OpenType feature toggles, text stroke, gradient text (`background-clip: text`), line clamp, `text-wrap: balance|pretty` and `word-break: keep-all`. The font picker previews every Google family (a `text=` subset registered under a separate family name), lists fonts in the file and, where the Local Font Access API exists, installed fonts.

## Vector editing

`apps/editor/src/vector/` owns the path model and parser, cubic geometry, primitive shape generation, paint inheritance, boolean and stroke operations, tracing, and transient drawing/edit sessions. Persistent geometry uses existing `SVG`/`SVGElement` nodes and `attrs`; there are no new model fields or file-format changes. Generated polygons and stars keep optional `data-shape`, `data-sides`, `data-points` and `data-ratio` attributes for parameter editing.

Generated SVGs use explicit dimensions, a fitted viewBox and `preserveAspectRatio="none"`. Canvas resizing can rewrite fitted primitive geometry. Path edits refit positioned, untransformed SVGs while preserving world positions. Imported SVGs retain their viewBox and transforms; live SVG matrices map anchors and handles into screen space, including CSS rotation and nested group transforms. Canvas chrome stays screen-sized at any zoom. `vectorUi` only stores drafts, selected points, tools and the persisted half-pixel snap preference; geometry is always written through DocStore transactions. Drag transactions share one mergeKey, including the final bounds refit.

SVG presentation attributes and inline styles both remain editable. Styles take precedence over attributes; paint edits remove the shadowed representation. Group/SVG paint is inherited and a root selection edits its drawable descendants. SVG paste accepts text, HTML and SVG clipboard files.

Paper.js performs curve-preserving boolean operations; paperjs-offset expands strokes. Stroke expansion happens before affine transforms and preserves caps, joins, dash lengths and dash offsets. Flatten produces a compound path with the bottom layer's paint. Booleans, flatten and outlines reject referenced gradients, clipping/masks and unsupported SVG content before modifying the document. Conversion to path rewrites primitives in place and preserves presentation attributes. ImageTracer is loaded on demand for browser-local tracing (6/16/32 colours, working resolutions capped at 256/512/900 px). CORS-protected images cannot be read; failures leave the image unchanged.

OpenCrease MCP extensions are registered additively in `packages/protocol/src/vector-tools.ts` and `apps/editor/src/agent/tools/vector.ts`:

- `oc_boolean_op({fileId, nodeIds, operation: "union"|"subtract"|"intersect"|"exclude"})`
- `oc_flatten({fileId, nodeIds, operation?: "flatten"|"outline-stroke"|"convert-to-path"})`, default `flatten`

Inputs must be unlocked vector shapes or rectangles on one page. Both tools use document stacking order, perform one agent-origin transaction and return `{operation, createdNodes: [{id,name,component}], removedNodeIds}` after the standard file header. `write_html`, `update_styles` and HTML/JSX export work with their SVG results unchanged.

For a headless end-to-end check, run isolated server and Vite instances, then `OPENCREASE_PORT=29903 OPENCREASE_EDITOR_URL=http://localhost:5203 node scripts/vector-smoke.mjs`. It creates temporary design files in that server's workspace and saves screenshots under `test-results/track3/`.

## Styling inspector and shader rendering

Pure inspector parsing/writing lives in `panels/right/inspector/{gradient,fills,effects,box}.ts`, with round-trip tests. Unsupported gradient syntax (such as pixel stops and colour hints) and non-pixel shadows are retained as raw CSS, rather than rewritten with different geometry. Radial gradients use `radialSize` for their ending shape; fill `size` always means CSS `background-size`.

`fill-write.ts` joins background CSS and optional paint in one transaction. `canvas/gradient-edit.ts` identifies the gradient open in the inspector; `GradientHandles` exposes stops, angle, centre and radial radius in screen space. `crop.ts` preserves the top visible image fill's world rectangle during a modified resize when intrinsic dimensions are available. Numeric crop controls also work without intrinsic metadata.

`shader-schema.ts` derives available shaders and typed controls from the installed React presets and core metadata/enums, with supplemental numeric ranges and image-input definitions. The direct `@paper-design/shaders` dependency matches the React package. `ShaderView` resolves asset image references and always requests `preserveDrawingBuffer: true` for screenshot, raster export and eyedropper access. A shader fill creates an isolated stacking context and uses a negative child z-index to remain below content. It inherits the layer radius and clips only its own drawing surface. When WebGL2 is unavailable it shows a labelled fallback; no pre-rendered shader frames are bundled.

The colour picker renders its plane into a Display P3 2D canvas when supported and uses a per-value gamut limit. The native EyeDropper samples the screen; the fallback samples the OpenCrease canvas via retained WebGL pixels or a raster capture. Screen sampling is available only through the browser's native API. `color-value.ts` resolves tokens and browser-supported colour expressions without applying alpha twice.

Components in the editor (`src/state/component-actions.ts`, `src/state/libraries.ts`, `src/panels/right/inspector/components.tsx`, `src/panels/left/ComponentsAssets.tsx`, `src/dialogs/LibraryHost.tsx`): ⌥⌘K creates a component from the selection (frames directly, other layers wrapped in a frame first, several components combine into a set), ⌥⌘B detaches. Components, sets, instances and their layers use the `--of-component` colour in the layer tree, the selection overlay and artboard labels (`src/canvas/component-tone.ts`). Refused edits (for example deleting a layer inside an instance) show a canvas notice (`src/ui/Notice.tsx`).

## Import pipeline

Snapshot measures DOM boxes and text, materialises pseudo-elements, captures SVG/shadow trees, inlines images, then emits allowlisted HTML with flex spacing or absolute fallback. The editor bridge imports HTML and resolves uploaded asset metadata. The CSS package also exports `colorTokensForTrees` for repeated solid colours. Canvas paste recognizes Snapshot HTML through the existing OpenCrease marker. Figma paste uses a bounded interpreter of the clipboard's embedded Kiwi schema, then converts supported nodes into `NodeTree[]`. Tests currently use synthetic Figma samples. Setup, permissions and fidelity limits are in `docs/IMPORT.md`.

## AI features

`packages/protocol/src/ai.ts` owns provider kinds, Claude model IDs, REST request/result types, agent stream events and `gen://` parsing. `OFNode.gen` is optional and persists prompt, provider, model, supported seed, requested width/height, target (`src` or `fill`) and whether it was edited. Old documents load without it.

All provider calls run in `apps/server/src/ai/`. Settings and keys live at `$OPENCREASE_HOME/secrets.json` (default `~/.opencrease/secrets.json`), atomically written with mode 0600. Keys are accepted when configuring a provider but never returned; settings expose `hasKey` and a last-four-character hint. This is a permissions-protected local file, not encrypted storage or an OS keychain. Tests must use a temporary `OPENCREASE_HOME` or an explicit temporary server `userConfigDir`.

REST endpoints:

- `GET /api/ai`: providers, defaults and secrets path, without full keys.
- `POST /api/ai/providers`, `PATCH /api/ai/providers/:id`, `DELETE /api/ai/providers/:id`: configure providers; omitted keys remain unchanged, `apiKey: null` clears one.
- `POST /api/ai/providers/:id/test`: test the saved endpoint, returning a status and available models when supported.
- `PUT /api/ai/defaults`: default `image` and `chat` provider IDs.
- `POST /api/ai/image`: generate or edit a reference image, save bytes into the file's assets, return metadata and provider/model/seed.
- `POST /api/ai/svg`: pass prompt and optional selected-frame HTML/screenshot to a chat model, returning SVG for the existing HTML normalizer.
- `GET /api/ai/agent/:fileId`, `DELETE /api/ai/agent/:fileId`: load or clear the file's conversation.
- `POST /api/ai/agent/:fileId`: stream `AgentStreamEvent` JSON as SSE data lines; `POST /api/ai/agent/:fileId/stop` stops the run. Disconnecting the response also aborts it. An already-dispatched editor tool can finish; subsequent calls are stopped.

The agent uses Anthropic Messages or OpenAI-compatible chat completions. Its system prompt includes the merged craft guide, brief-first and screenshot-review rules. It advertises the same tool schemas as MCP, runs calls through the existing server executor and sends image results back as model image blocks. Conversations and model history are stored per file under `$OPENCREASE_HOME/chats/`; the guide is frozen for each conversation, so clear chat after changing it to start with new guidance.

The editor's `ai/` REST client, generation jobs and conversation stream bind these endpoints to Settings, ⇧⌘I, ⇧⌘J and the Agent tab. Document writes still use the existing DocStore. Image jobs track processing/ready/error outside the document and insert an asset with generation metadata when complete. Agent writes containing `gen://` or `paper-gen://` sources/fills start generation after the write; pending URLs remain retryable after reload. Canvas status and the inspector expose generation, retry, regenerate and editing. Edits send the existing image and nearby canvas text as reference and retain layer dimensions; provider output sizes may differ and use the layer's existing fit/crop.

ComfyUI uses a basic checkpoint text-to-image graph and does not support reference edits. xAI generation currently has no edit adapter. Replicate and fal edits need a model endpoint that accepts reference images. Generic OpenAI-compatible endpoints must implement the selected API; a chat-only endpoint cannot make images. No provider requires a cloud account for local ComfyUI, Automatic1111, Ollama or LM Studio endpoints.

`apps/server/src/ai/testing/fake-provider.ts` supplies local Anthropic/OpenAI chat SSE, scripted real tool calls and image responses for integration checks without paid credentials. Adapter HTTP request/response tests also cover Gemini, Replicate, fal, xAI, ComfyUI and Automatic1111. See `docs/LIVE-DATA.md` for agent-driven CMS/API content updates.

## Desktop app

`@opencrease/desktop` bundles an Electron main process, sandboxed CommonJS preload and standalone CLI with esbuild. The main process imports `startServer` and passes explicit built-editor and guide paths. Packaged resources live outside `app.asar` in `editor/`, `guides/` and `cli/`. `apps/server/src/config.ts` accepts `OPENCREASE_EDITOR_DIST`, `OPENCREASE_GUIDES_DIR` and `OPENCREASE_CLI_ENTRY` overrides for the bundled CLI. Playwright remains external and optional; packaged PDF exports use the existing raster fallback.

The preload exposes only the `DesktopBridge` contract in `packages/protocol/src/desktop.ts` as `window.opencreaseDesktop`. It has typed workspace, font and agent-config methods plus subscriptions for menu commands, navigation and full-screen changes. Main IPC validates the window, top-level frame, editor origin and arguments. Renderer Node integration is off, context isolation and the sandbox are on; external navigation and webviews are blocked. Browser tabs have no bridge and no automatic config-writing controls.

Workspace choice and normal window bounds persist in the app's user data `settings.json`. A single-instance lock receives validated deep links. Native menus send commands to the focused or last active editor; shortcut commands replay the existing editor handlers. `OPENCREASE_DESKTOP_TEST=1` enforces hidden/offscreen editor windows, prohibits macOS activation, hides the dock and disables native dialogs, protocol registration and updates. Tests capture through `webContents.capturePage()` with a temporary HOME. See [DESKTOP.md](DESKTOP.md).

Agent config writes use opaque, expiring preview plans, exact diffs, serialized writes, unique backups and atomic replacement. A changed file requires a new confirmation. JSONC edits preserve unrelated content; TOML edits are parsed and checked for semantic preservation outside `mcp_servers.opencrease`. The desktop launcher uses Electron's Node mode and `OPENCREASE_DESKTOP_LAUNCH` lets the stdio proxy start the app in the background when required.

## Export and headless rendering

`apps/editor/src/agent/export-settings.ts` owns scale parsing, names, video timing
and output limits. `export-presets.ts` defines inspector presets. `exporter.ts` is
the shared capture/export path for the inspector, MCP and CLI. Inner SVG elements are captured in a temporary SVG viewport with inherited presentation, referenced definitions and their screen matrix preserved (`svg-capture.ts`), so selecting a path or group does not export transparent pixels. PNG/JPG/WebP use
modern-screenshot; AVIF falls back to the libavif WebAssembly encoder. SVG uses model
serialization and resolves tokens. `shader-frames.ts` freezes the shader mounts,
reads WebGL buffers synchronously and restores their clocks and resolution after
capture. `video.ts` steps from time zero at frame/fps and encodes with WebCodecs and
MP4/WebM muxers. The pinned webm-muxer patch carries a separately encoded alpha plane
in BlockAdditional so transparent WebM is decodable by browsers and libvpx.

`ExportSetting` additionally accepts optional `durationSeconds`, `fps`, `pdfQuality`
and `pdfResampling`. Old files and settings remain valid. Video settings flow through
the existing `export` tool, including `type: "video"`; results include duration, fps
and codec. The tool still accepts `nodes-with-exports-only` for page exports. Combined
PDF pages are sorted by canvas y then x. PDF image quality/resampling affect images;
text stays vector and available font data is embedded.

`POST /api/render/pdf` accepts `{ title?, pages: [{ html, width, height }] }` and
returns `application/pdf`, printing static snapshots through hidden Chromium and
merging pages with pdf-lib. Missing Chromium returns 501 and allows the editor's
explicitly reported raster fallback. `render.ts` reuses the headless session's
browser when available and closes otherwise-owned renderers after idle time or
server shutdown. Export uploads may be up to 1 GB to accommodate videos.

`apps/server/src/headless.ts` owns an isolated server, pinned `.fold` workspace,
hidden Playwright Chromium and optional in-process Vite server. It prefers the
built editor. The `headless=1` startup query enables immediate disk saves after
editor mutations; the flag is captured at module initialization so routing does
not discard it. The full existing tool executor and bridge are used without mocks.
`export-cli.ts` handles export/render, token conversion and headless stdio MCP;
`cli.ts` only registers the dispatch. Regular GUI/stdio behavior remains available.
Asset output directories can be overridden through `WorkspaceOptions.exportDir`;
`WorkspaceOptions.files` restricts startup indexing to explicitly opened files.

Testing additions live in `tests/fixtures`, `tests/visual`, and `tests/sessions`.
The separate visual runner compares native Chromium canvas pixels with committed
platform baselines and exported 1x PNGs, allowing at most 0.5% differing pixels with
a pixelmatch color threshold of 0.1 and antialiasing excluded. Recorded MCP sessions
are replayed against schemas and the real editor handlers. Property tests generate
nested DOM-compatible trees, export HTML or render generated JSX, pass the HTML
through `write_html`, and compare canonical structure, styles, text and image URLs.

## Rendering boundaries

User HTML is converted into typed nodes, never inserted as HTML into the live canvas. SVG tags and attributes, image URLs, CSS URLs, token values and shader image parameters are filtered at parse/render boundaries. External images are restricted to the exact hosts in `packages/css/src/security.ts`; fonts use Google Fonts and bundled faces. Local assets remain supported. Static history previews have a separate script-free sandbox; PDF rendering disables JavaScript and blocks network requests outside the image/font policy. The interactive canvas retains its existing `contain: strict` DOM architecture for measurement and editing; it is not a separate-origin frame.

History previews use static HTML; animated shader fills and non-bundled fonts may differ from the full renderer. The WebMCP adapter is feature-detected and schema-tested; browser use requires the experimental API. The quality prompt recorder needs a configured real agent for a human comparison and does not synthesize model output.

## Conventions

- TypeScript strict. No `any` in exported signatures.
- UI copy: sentence case, plain words, no decorative point separators, no emoji.
- Claude-specific UI uses the real mark in `claude-mark.svg`, white on `#D97757`; general agent actions use neutral icons.
- Visual design: match the running editor and the screen list in EDITOR.md. Use `--of-*` tokens only.
- Tests: Vitest, colocated `*.test.ts`. Run `pnpm typecheck`, `npx vitest run`, the editor build and `pnpm test:visual` before integration. `node scripts/audit-shortcuts.mjs` checks the actual shortcut dispatchers with action stubs; [SHORTCUTS.md](SHORTCUTS.md) describes context precedence.
- Keep shared registrations small and place subsystem logic beside its tests.
