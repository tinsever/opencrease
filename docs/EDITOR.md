# Editor build brief

Companion to `ARCHITECTURE.md` for editor implementation and visual conventions. [SHORTCUTS.md](SHORTCUTS.md) is the integrated keyboard reference.

## Visual reference

The running editor is the visual reference. Match the `--of-*` tokens in `src/styles/theme.css`, the primitives in `src/ui/`, 28px fields, 11px semibold section headers and the quiet neutral chrome, in both light and dark themes. Check new UI against the screens below in headless Chromium.

| Screen | Shows |
|---|---|
| Editor — Design | Main editor: title bar with file tabs, left panel (file header, Layers/Theme/Assets tabs, pages, layer tree), canvas with artboards, selection overlay with handles, padding/gap hatching and size badge, agent working outline and badge, floating bottom toolbar, right panel (agent chip, Design/Code tabs, selection header, Layout, Flex, Appearance, Fill, collapsed Border/Shadow/Filters/Export) |
| Editor — Agent chat | Right panel Agent tab: chat thread, tool steps, review checklist, composer |
| Editor — Theme & tokens | Left panel Theme tab (search, modes, grouped token list), right panel token detail |
| Editor — Text & colour picker | Text selected: Typography section, OKLCH colour picker popover |
| Editor — Component instance | Instance header, properties, code component mapping (implemented components and instance controls) |
| Editor — Shader | Shader node selected: header, shader picker, params with sliders, export snippet |
| Editor — Pen & path editing | Path edit mode: mode bar, anchors/handles, point inspector |
| Editor — Code | Code tab: React/Tailwind/HTML switch, options, dark code block, footer actions |
| Editor — Export | Export section expanded: rows, video options, preview, export button |
| Files — Local workspace | Home: sidebar (brand, Recent/Starred/Templates, folders, agent card), header with search and New file, file card grid |
| Dialog — Connect an agent | MCP setup dialog |
| Settings — Design guide | Settings window, design guide layers, required steps, guide editor |
| Command palette | ⌘K palette |

The Snapshot browser extension popup lives in `apps/extension`.

The real Claude mark SVG path is in `docs/claude-mark.svg`. Show it (white on `--of-claude`) for agent clients whose name contains "claude"; other agents get a two-letter monogram tile.

## State

Use `src/state/*` (workspace store, hooks, actions, REST client). Do not create a second store. Add small actions to `src/state/actions.ts` if you need them and mention it in your report. Selection lives per file (`OpenFile.selection`). Every document change goes through `file.store.transact(...)` so it is one undo step.

## Subsystems

| Subsystem | Directories |
|---|---|
| Canvas | `src/canvas/`, `src/chrome/` |
| Panels | `src/ui/`, `src/panels/`, `src/home/`, `src/dialogs/` |
| Bridge | `src/agent/` |

`src/canvas/registry.ts`, `src/canvas/shortcuts.ts`, `src/agent/bridge.ts` and the placeholder components already exist with the exported names `App.tsx` uses. Keep those export names.

## Canvas behaviour (canvas agent)

- Render the active page: Root children are artboards/loose layers, absolutely positioned with their own `left/top` styles inside a world layer transformed by the viewport. Render recursively: Frame/Rectangle → div, Text → div with `whiteSpace: pre-wrap`, Image → img (`resolveSrc`), SVG → svg with attrs + SVGElement children, Shader → `@paper-design/shaders-react` component by name (fallback: gradient placeholder). Hidden nodes render with `display: none`. Apply `toReactStyle(node.styles)`. Every element gets `data-of-id`.
- Memoise node components by node object identity (immer keeps unchanged nodes identical), so big files stay fast.
- Inject `tokenCssVars(doc)` on the content root. Load Google Fonts for font families used in the doc (skip generic families and Geist which is bundled).
- Pan: trackpad/wheel scroll pans, pinch or ⌘/Ctrl+wheel zooms around the cursor, Space or H for hand drag, ⇧1 zoom to fit page, ⇧2 zoom to selection, ⌘0 100%, ⌘+/⌘- zoom.
- Hit testing via `document.elementsFromPoint` + `data-of-id`. Click selects the top-level child of the artboard under the cursor (or the artboard when clicking its label); double-click drills into children; ⌘-click deep-selects the innermost; Shift adds/toggles; drag on empty canvas marquee-selects artboards/top-level layers; Esc selects parent then clears; Enter selects first child.
- Hover outline (thin accent), selection outline (1.5px accent) with 4 corner + 4 edge handles, size badge below ("1440 Fill × 640 Hug" when sizing intents apply), artboard name labels above artboards (click selects, double-click renames).
- Move: drag selected nodes. Absolutely positioned nodes (artboards, `position: absolute`) change `left/top`. Flex children reorder among siblings (show an insertion line) or move into another frame on drop. Resize via handles changes `width/height` (and left/top for top/left handles); Shift keeps aspect ratio, Alt from centre. Use `mergeKey` so one drag is one undo step. Snap to other artboards' edges/centres within 6 screen px, draw orange guide lines.
- Arrow keys nudge 1px (Shift 10px) for absolute nodes.
- Insertion tools: F frame (drag to draw; on empty canvas it creates an artboard with white background; inside a frame it creates a child), R rectangle, T text (click to place, starts editing), I image (file picker, uploads through `api.uploadAsset`, inserts Image with natural size), Shader tool inserts a Shader node (MeshGradient default). After insertion return to Move.
- Text editing: double-click a Text node to edit it in place (contentEditable on the rendered element, plain text only, Esc/blur commits via `updateNode({ text })`).
- Paste: HTML from the clipboard → `htmlToTrees` → insert under selected frame or as artboard; images → upload + Image node; SVG text → SVG tree; plain text → Text node. Copy: selected nodes as HTML (`nodeToHtml`) in `text/html` with a `data-opencrease` marker plus plain text. Cut = copy + delete.
- Agent working outline: for each artboard in `agentWork[fileId]` draw a 2px `--of-agent` outline and a badge under it with the Claude mark (or monogram), "<Client> is working" and the label.
- Bottom floating toolbar per the design (Move, Frame, Rectangle, Text, Pen, Image, Shader, separator, Ask agent → switches right panel to Agent tab). Pen (P) draws editable SVG paths. The Rectangle slot is a shape menu with SVG rectangle, line, ellipse, polygon and star tools; it stays inline when other tools overflow. Enter/double-click opens path edit mode with screen-space anchors/handles and the Point inspector.
- Title bar: traffic-light spacing on macOS-like left padding (no fake lights in the browser build; leave 12px padding), home button (logo), file tabs (active tab style, close button, unsaved dot), "+" opens Home, right side save status ("Saved" / "Saving" / "Unsaved changes" / "Save failed") and workspace path, bridge status dot.
- `useGlobalShortcuts` in `src/canvas/shortcuts.ts`: ⌘Z/⇧⌘Z undo/redo, Delete/Backspace delete, ⌘D duplicate, ⌘G wrap in frame, ⇧A flex row, ⌘A select all on page, ⌘C/⌘X/⌘V, V/F/R/T/I/H tools, ⌘\\ toggle UI, ⌘K command palette event (dispatch a `opencrease:command-palette` window event; the panels agent renders it). Ignore shortcuts while typing in inputs or editing text.

## Panels behaviour (panels agent)

- `src/ui/`: small primitives matching the design (sizes: fields 28px high, 4px radius, chrome background; section headers 11px semibold; segmented controls; toggles 26×16). Icons as inline SVG components in `src/ui/icons.tsx` (16/14/12 px, 1.2–1.4 stroke).
- Left panel: file header (folder + file name, rename on double-click), Layers/Theme/Assets tabs, Pages section (add, rename, delete via context menu, icon), layer tree (expand/collapse, select syncs with canvas, hover syncs, rename on double-click, visibility and lock toggles on hover, drag to reorder/reparent with insertion indicator, icons per node type, agent badge on artboards being edited). Theme tab: token search, grouped list by type with swatches/previews, add token, edit name/value/description inline, delete, export as CSS/Tailwind (copy to clipboard). Assets tab: images used in the file.
- Right panel header: agent status chip (connected agent clients from `agentClients` seen in the last 10 minutes, Claude mark; "No agent" with a "Connect" button that opens the Connect dialog otherwise) and a Preview button that opens the selected/containing/first artboard in a live browser page or desktop window (Alt-P).
- Tabs: Design, Code, Agent.
- Design tab inspector for the selection (multi-select edits all; show mixed values as "Mixed"):
  Selection header (name, type, child count); Layout (X, Y for absolute nodes, W/H with Fixed/Hug/Fill intent, rotation); Flex (toggle on/off, direction, wrap, align matrix 3×3 driving alignItems/justifyContent, gap with token hint, padding horizontal/vertical with per-side expand); Position (absolute toggle for flex children); Appearance (opacity, corner radius with per-corner expand, blend mode); Typography for Text (family picker with common Google fonts + doc fonts, weight, size, line height, letter spacing, align, case, decoration); Fill (multiple layers parsed from `background`/`backgroundColor`/`backgroundImage`: solid, linear gradient, image; colour swatch opens the colour picker; token picker; hide/remove/add); Border; Shadow (multiple); Filters (blur, brightness, contrast, saturate, grayscale) and backdrop blur; Export (per-node export settings, export button calling the bridge agent's export helper via `window.dispatchEvent(new CustomEvent("opencrease:export", { detail }))` or a shared function the bridge agent exposes in `src/agent/exporter.ts`); Shader params when a Shader is selected.
  Nothing selected: page background colour and a short hint.
  Number fields: drag the label to scrub, arrow keys ±1 (Shift ±10), accept expressions like `24*2`, accept `var(--token)`.
- Colour picker popover: OKLCH plane (lightness × chroma at the current hue) with hue and alpha sliders, mode switch (OKLCH/HEX/RGB/HSL), value inputs, eyedropper (`window.EyeDropper` when available), Tokens tab listing colour tokens, "Save as token". Use culori for conversions.
- Code tab: format switch (React inline / Tailwind / HTML), "Include node IDs" toggle, code from `nodeToJsx`/`nodeToHtml` for the selection, Copy button.
- Agent tab: Chat streams text and tool steps from the server's in-app agent. Configure Anthropic or an OpenAI-compatible model in Settings → AI providers. Conversations persist per file, include the design guide, and support Stop and clear. Claude-backed turns use the real Claude mark. Activity retains the MCP log, grouped reads and review checklist. Image generation (⇧⌘I), reference editing and SVG generation (⇧⌘J) use the same provider settings; see ARCHITECTURE.md "AI features" for routes and persistence.
- Home screen: sidebar (Recent, folders from file paths), header (title, search filter, Open folder available in desktop and disabled with an explanatory tooltip in browsers, New file), file cards with thumbnails from `api.thumbnailUrl` (fallback: a neutral canvas tile with the file's initial), name and "folder, edited <relative time>", context menu (Open, Rename, Duplicate, Delete). Agent card at the bottom of the sidebar opens the Connect dialog.
- Dialogs in `src/dialogs/`: Connect an agent (show `claude mcp add opencrease -- npx opencrease mcp`-style commands per client with copy buttons, the stdio command `opencrease mcp` and the HTTP URL `http://127.0.0.1:29880/mcp`; show manual instructions in browsers; desktop can preview and confirm config writes), Settings with the Design guide page (loads/saves layers via `api.getGuide/saveGuide`), Command palette (actions list with fuzzy filter, layers search, Enter runs). Open them through window events: `opencrease:connect-agent`, `opencrease:settings`, `opencrease:command-palette`. Mount the dialog host from `LeftPanel`/`Home` or export a `DialogHost` component from `src/dialogs/DialogHost.tsx` and tell the coordinator to mount it in `App.tsx`.

## Agent bridge behaviour (bridge agent)

See ARCHITECTURE.md "Tool list". Implement every editor-side tool against the store and the DOM in `src/agent/tools/*.ts`, the WebSocket client in `src/agent/bridge.ts` (`startBridge()`: connect to `/bridge` (same origin, ws/wss), send hello/state, reconnect with backoff, update `setBridgeConnected`, handle `open-file`), activity logging (`src/agent/activity.ts`), screenshots and exports (`src/agent/exporter.ts` using `modern-screenshot` for png/jpg/webp, jsPDF for pdf, SVG serialisation for SVG nodes, video via MediaRecorder or frame capture + WebCodecs if feasible, otherwise return a clear "not supported yet" error for video).
- Tools for a file that is not open: `await openFile(fileId, undefined, { focus: false })`... but the canvas only renders the active file, and layout-dependent tools (screenshots, computed styles, world positions) need it rendered. Simplest rule: any tool call focuses its file (`openFile(fileId)`) and switches to the needed page before running. Wait for two animation frames after changes before measuring.
- Mark agent work on touched artboards with `markAgentWork(fileId, artboardIds, client.name, label)` and log every call to the activity log.
- Review nudge per ARCHITECTURE.md.
- Return results in the shapes documented in ARCHITECTURE.md, with the file header block first.

## Integrated review

With an isolated server on 29911 and Vite on 5211, `pnpm exec tsx scripts/polish-review.ts` walks Home, tabs, node inspectors, Settings, dialogs and PNG export in both themes. `pnpm exec tsx scripts/polish-details.ts` expands inspector controls and verifies reset, plugin execution and history restore using that fixture. `pnpm exec tsx scripts/polish-svg.ts` compares inner SVG captures, including inherited paint and rotation, with native Chromium pixels. These scripts create test documents in the isolated workspace and write evidence under `test-results/polish`. Run both with a temporary `OPENCREASE_HOME`; they use headless Chromium and never open visible windows.
