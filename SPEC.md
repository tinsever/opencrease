# OpenCrease — Product & Technical Specification

> Working title: **OpenCrease**. A free, open-source, self-hostable design tool whose canvas is real HTML/CSS and is built for working with AI agents. Feature-compatible in spirit with [Paper](https://paper.design).

| | |
|---|---|
| Status | Draft v0.1 |
| Date | 2026-10-17 |
| Reference product | Paper (Lost Coast Labs, Inc.), as of Paper's September 2026 build log |

---

## 0. Read this first: this is not a fork

Paper is **closed source**. Nothing exists to fork. OpenCrease is a **clean-room reimplementation** of Paper's publicly documented behaviour. That has legal consequences:

- **No Paper code, assets, fonts, icons, or UI copy** go into this repo. The one exception is the Apache-2.0 [`paper-design/shaders`](https://github.com/paper-design/shaders) library (see §9.4). Keep its `LICENSE` and `NOTICE` files.
- **No trademark use.** Don't use "Paper" in the product name, logo, domain, or package names. Use "Paper-compatible" only to describe interoperability, such as an import path.
- **Spec from public sources only.** Use paper.design docs, the build log, the pricing page, and observed behaviour of the public MCP tool interface. Contributors who have seen Paper's private source must not contribute to the matching areas.
- Copying MCP **tool names and argument shapes** is fine, and it's a deliberate choice: agents and prompts written for Paper should work against OpenCrease unchanged. Interface compatibility is a design goal (§8).

---

## 1. What Paper is (reference inventory)

This summary of the reference product's surface sets the scope. Each line maps to a section of this spec.

| Area | Paper today | OpenCrease § |
|---|---|---|
| Canvas model | Infinite canvas of artboards. Every node is real HTML/CSS (flexbox, absolute positioning, CSS colours, filters, blend modes). | 3, 4 |
| Node types | Frame, Text, Rectangle, SVG (with editable paths), Image fill, Shader | 3.2 |
| Layout | Flexbox (direction, wrap, gap including negative gap, padding, align), absolute positioning, constraints, fit-content/fill sizing. CSS Grid with editable tracks and cell placement. | 4.3 |
| Styling | Fills (solid, gradient, image; multiple and reorderable), borders, outlines, shadows, per-corner radius, opacity, blend modes, filters and backdrop filters, text stroke and text gradients | 4.4 |
| Colour | OKLCH/Oklab picker. Mix sRGB and Display-P3 per element. Paste LAB/LCH/named colours. Eyedropper. | 4.5 |
| Text | Plain text per node (rich text is "coming soon"), Google and local fonts, variable fonts with custom axes, OpenType features, auto optical size, casing/wrap/truncate, CJK word-keep | 4.6 |
| Vectors | Paste SVG, pen tool, path editing, pixel snapping. Shapes and booleans are on the roadmap. | 4.7 |
| Tokens | Tailwind v4 namespaces (colour, spacing, radius, font, text, leading, tracking, weight, opacity, container, breakpoint) exposed as CSS variables. Themes/modes are planned. | 5 |
| Pages | Multiple pages, dividers, icons, reorderable | 3.1 |
| Import | Paste Figma (objects, SVGs, images, slots), paste HTML with inline styles, paste images/SVG/text, Snapshot browser extension that turns web pages into layers | 6 |
| Export | PNG, JPG, WebP, AVIF, SVG, PDF (single and combined), MP4/WebM video, Copy as React (inline CSS) or Tailwind, export presets | 7 |
| AI | MCP server (stdio CLI and Streamable HTTP on `127.0.0.1:29880`), WebMCP in the browser app, AI image and SVG generation and editing, vectorize | 8, 10 |
| Shaders | About 30 WebGL shaders (mesh gradient, liquid metal, halftone, fluted glass, paper texture…) usable as fills | 9 |
| Collaboration | Real-time multiplayer, cursors, follow mode, cursor chat, comments (pin, reply, resolve, search, filter), presence of teammates *and agents*, view-only links, roles | 11 |
| Organisation | Teams, folders/subfolders, dashboard search, recents, multi-select | 11.4 |
| Apps | Web app, desktop app (tabs, MCP host, CLI installer) | 12 |
| Pricing | Free: 100 MCP calls/week. Pro ($16–20 per editor/month): 1M calls/week, video export, larger images. Orgs: SSO. | Not applicable: no paywalls (§2) |

---

## 2. Goals & non-goals

### Goals
1. **What you see is the code.** Every design is a tree of DOM elements with a well-defined subset of CSS. Exporting to code is a serialisation, not a translation.
2. **Agent-first.** A first-class MCP server, compatible with Paper's tool interface, with no rate limits other than local hardware.
3. **Local-first, single user.** v1 is a desktop app working on `.fold` files on disk, with no account and no server. Multiplayer is deferred (§11). The CRDT document model keeps that door open.
4. **Good taste by default.** Agents working in OpenCrease should produce deliberate, non-generic designs without the user writing a long prompt. This comes from a layered design guide plus a mandatory see-and-review loop (§8.5), not from a bundled model.
5. **Open, documented file format.** Files are inspectable, diffable, and can live in git next to the code they describe.
6. **Bring your own AI.** Image generation and other AI features call provider APIs the user configures (OpenAI-compatible, Replicate, fal, local ComfyUI…). The core never requires a vendor.
7. **No feature gating.** Video export, image size, and MCP throughput are limited only by the user's machine and server config.

### Non-goals (v1)
- Pixel-exact compatibility with Figma's rendering model, vector networks, or plugin API.
- Hosting a public SaaS. The project ships software. Others may host it.
- Built-in, bundled AI models.
- Prototyping and interaction flows (Paper doesn't have them either). Revisit after v1.
- Real-time collaboration, comments, sharing, accounts and the sync server. All of §11 is deferred until after v1.

---

## 3. Document model

### 3.1 Hierarchy

```
Workspace (local) / Team (server)
└── Folder (nestable)
    └── File                      id: ULID
        ├── Tokens[]               (§5)
        ├── Assets{}               content-addressed blobs (images, fonts, video)
        ├── Comments[]             (§11.3)
        └── PageList[]             ordered: Page | Divider
            └── Page               id: ULID, name, icon?
                └── Root node      id: "root_<pageId>"
                    └── Artboard   top-level Frame, absolutely positioned in world space
                        └── Node tree …
```

### 3.2 Node types

All nodes share these fields:

```ts
interface BaseNode {
  id: NodeId;            // "<lamport-base36>-<clientId-base36>", e.g. "3G8-0". Unique per file, stable across moves.
  type: NodeType;
  name: string;          // layer name; auto-derived if empty
  parent: NodeId;
  index: FractionalIndex;// sibling order (CRDT-friendly)
  visible: boolean;
  locked: boolean;
  styles: StyleMap;      // §4.2 — authored CSS, camelCase keys
  exportSettings?: ExportSetting[];
}
```

| Type | Renders as | Extra fields |
|---|---|---|
| `Frame` | `<div>` | children. An artboard is a Frame whose parent is the page root. Artboards default to `display:flex; flex-direction:column; overflow:clip`. |
| `Text` | `<div>` with `white-space: pre-wrap` | `text: string` (v1). `spans: TextSpan[]` (v2, rich text). |
| `Rectangle` | `<div>` with no children | Used for spacers, dividers, and shapes |
| `Image` | `<img>` or a background-image Frame | `assetId`, `objectFit`, `crop`. Note: image fills can also be set on any Frame's `backgroundImage`. |
| `SVG` | inline `<svg>` | `viewBox`, children are `SvgPath`/`SvgGroup`/… elements with `d`, `fill`, `stroke`, etc. Paths are editable (§4.7). |
| `Shader` | `<canvas>` (WebGL) | `shader: ShaderId`, `params: Record<string, number \| string \| Color \| AssetRef>`, `animated: boolean`, `speed`, `frame` |
| `Video` (P2) | `<video>` | `assetId`, `loop`, `muted`, `posterFrame` |
| `Embed` (P3) | sandboxed `<iframe>` | Lottie/Rive/YouTube (from Paper's roadmap) |

### 3.3 Collaboration-ready storage

- The document is a **CRDT**. Recommended: **[Loro](https://loro.dev)**, for its movable tree, fractional indexing, fast snapshots, and shallow history. **Yjs** is an acceptable alternative.
- One CRDT doc per file, sub-documents per page so large files load lazily.
- Undo/redo is per user, scoped to that user's own operations, and groups ops into transactions per tool gesture.
- Version history: named snapshots plus automatic checkpoints. Diff view is P2.

### 3.4 On-disk format: `.fold`

```
my-design.fold              (zip, or an unpacked directory in "git mode")
├── manifest.json           { formatVersion, fileId, name, createdAt, app }
├── document.loro           CRDT snapshot (authoritative)
├── pages/<pageId>.json     human-readable JSON projection (regenerated on save; for diffing/tools)
├── tokens.css              :root { --color-…: … }  (readable projection)
├── assets/<sha256>.<ext>
└── thumbnails/<pageId>.webp
```

- **Git mode** saves as a directory with deterministic, pretty-printed JSON, so `git diff` is readable.
- Publish a JSON Schema for the JSON projection, plus an MIT-licensed `@opencrease/format` package (read/write, no editor).
- Paper's format is proprietary and unavailable, so there is no `.paper` importer. Interop goes through paste (§6) and through an MCP-driven migration script that reads a Paper file with Paper's MCP and writes it with OpenCrease's.

---

## 4. Canvas & editor

### 4.1 Rendering architecture

- **Content layer:** the real DOM. Each artboard is a subtree of absolutely positioned elements inside a single "world" element that is transformed with `translate()/scale()` for pan and zoom. The browser does layout, text shaping, and painting, which is what makes the canvas match the exported code.
- **Overlay layer:** a separate, untransformed `<canvas>` (or SVG) for selection boxes, handles, guides, snapping lines, gap/padding handles, remote cursors, and comment pins. It is drawn in screen space so handles stay crisp at any zoom.
- **Virtualisation:** artboards outside the viewport plus a margin are unmounted, or replaced by a cached bitmap. Hidden pages aren't mounted at all.
- **Level of detail:** below about 10% zoom, show cached raster thumbnails per artboard, refreshed in an idle callback.
- **Measurement:** layout reads (`getBoundingClientRect`) are batched once per frame. The model keeps a cache of measured world rects that hit-testing, snapping, and the MCP `worldX/Y` fields use.
- **Isolation:** user content renders in a container with `contain: strict`. CSS custom properties for tokens are scoped to the file root. Editor chrome styles must never leak into content, so use shadow DOM or a strict prefix.

### 4.2 Supported CSS (authored style map)

Styles are a camelCase map like `React.CSSProperties`. **Only allowlisted properties are stored.** The editor reports the rest as `ignoredStyles`, which matches Paper's MCP behaviour. v1 allowlist:

- **Box:** `width height minWidth maxWidth minHeight maxHeight` (px, %, `fit-content`, `auto`), `padding*`, `boxSizing` (always border-box), `overflow` (`visible|clip|hidden|scroll`), `aspectRatio`
- **Position:** `position` (`relative|absolute`), `top right bottom left`, `zIndex`, `rotate`, `transform` (limited), `transformOrigin`
- **Flex:** `display` (`flex|grid|block|none`), `flexDirection flexWrap gap rowGap columnGap alignItems alignContent justifyContent alignSelf flexGrow flexShrink flexBasis order`
- **Paint:** `backgroundColor backgroundImage` (linear/radial/conic gradients, `url()`, multiple layers), `backgroundSize backgroundPosition backgroundRepeat backgroundBlendMode`, `border*` (per side, `borderStyle` solid/dashed/dotted), `outline*`, `borderRadius` (per corner), `boxShadow` (multiple, inset), `opacity`, `mixBlendMode`, `filter`, `backdropFilter`, `clipPath` (P2), `maskImage` (P2)
- **Text:** `color fontFamily fontSize fontWeight fontStyle fontStretch fontVariationSettings fontFeatureSettings fontOpticalSizing lineHeight letterSpacing textAlign textTransform textDecoration* textOverflow whiteSpace wordBreak overflowWrap lineClamp WebkitTextStroke backgroundClip:text` (gradient text), `textWrap` (balance/pretty), `fontSynthesis`
- **SVG attrs:** `fill stroke strokeWidth strokeLinecap strokeLinejoin strokeDasharray opacity`
- **Values:** any CSS colour syntax (hex, rgb, hsl, hwb, lab, lch, oklab, oklch, `color(display-p3 …)`, named colours), `var(--token)`, `color-mix()`.

Excluded in v1, as in Paper: `margin` (padding and gap only), `display:inline`, tables, pseudo-elements, `@media` (breakpoints are handled by separate artboards).

### 4.3 Layout features

| Feature | Priority |
|---|---|
| Flex auto layout: direction, wrap, gap (including negative gap), padding, alignment presets (a 3×3 matrix, "common layout modes"), distribute | P0 |
| Sizing modes per axis: Fixed / Hug (`fit-content`) / Fill (`flex-grow:1` or `100%`) | P0 |
| "Absolute position" toggle (ignore flex layout) on children | P0 |
| On-canvas gap and padding handles (drag to adjust, Shift for 8 px steps) | P1 |
| Constraints (left/right/center/scale/stretch) for absolute children when the parent resizes | P1 |
| Smart guides, snapping to edges, centres, and equal spacing, plus a pixel grid at high zoom | P0 |
| Scale tool (scale styles proportionally, K) | P2 (Paper: "coming soon") |
| CSS Grid | P2 |
| Responsive preview: one artboard rendered at several breakpoint widths | P2 |

### 4.4 Styling panels (right sidebar)

Panels appear for whatever the selection supports: **Layout** (X/Y/W/H/rotation, flex, sizing, clip content), **Constraints**, **Radius** (linked or per corner), **Appearance** (opacity, blend mode), **Fill** (stacked, reorderable: solid, linear/radial/conic gradient, image, shader), **Border**, **Outline**, **Shadow** (stacked, reorderable), **Filters** (blur, brightness, contrast, saturation, grayscale, sepia, invert, hue-rotate), **Backdrop filters**, **Text**, **Text details** (OpenType features, variable axes), **Text formatting** (casing, wrapping, truncation, CJK keep), **Text stroke**, **Selection colours** (every colour in the selection, editable in bulk, including SVG colours), **Export**, and **Other styles**, a raw key/value list for allowlisted properties that have no dedicated panel. Agents often set these.

Gradients have on-canvas handles and an angle field. Image fills support crop (⌘ + drag while resizing), fit/fill/tile, and stack with other fills.

### 4.5 Colour

- Picker modes: OKLCH (default), Oklab, sRGB hex/RGB, HSL, Display-P3. Gamut boundary drawn in the OKLCH picker.
- Gamut is set **per value**, not per file.
- Eyedropper picks from anywhere, including images and shaders. Shift adds the colour as a gradient stop.
- Paste any CSS colour string into any colour field.
- "Add as token" from any colour field.

### 4.6 Text

- P0: plain text nodes; Google Fonts with on-demand loading and an offline cache; local system fonts (desktop app via a font-enumeration API, web via the Local Font Access API with fallback); auto line height; text resize modes (auto width / auto height / fixed).
- P0: variable fonts with custom axis sliders, automatic optical size, OpenType feature toggles.
- P1: text gradients, text stroke, truncation with line clamp, `text-wrap: balance`.
- P2: **rich text**, meaning inline spans with distinct styles. Paper hasn't shipped this. Model it as `spans[]` that serialise to nested `<span>`s.
- Hotkeys (Paper-compatible): ⇧⌘, / ⇧⌘. for size, ⌥⌘, / ⌥⌘. for weight, ⌥, / ⌥. for tracking, ⇧⌥, / ⇧⌥. for line height, ⌘B bold, ⌘I italic.

### 4.7 Vector editing

- P0: paste SVG as an editable `SVG` node. Select inner elements. Edit fill, stroke, and stroke width.
- P1: pen tool (P), path edit mode (Enter / double-click, Esc to exit), bézier handles, convert point types, add and delete points, half-pixel snapping (⇧⌘').
- P1: primitive shapes (line, rectangle, ellipse, polygon, star) as SVG.
- P2: boolean ops (union, subtract, intersect, exclude), flatten and outline stroke, convert shape to path. Libraries: `paper.js`-style path ops, or `clipper2-wasm`.
- P2: vectorise a raster (potrace / `vtracer` WASM).
- P3: mirror drawing, repeat/array, shape builder.

### 4.8 Selection, navigation & tools

- Tools: Move (V/M), Frame (F/A), Rectangle (R), Text (T), Pen (P), Hand (H, or hold Space), Comment (C), Zoom (Z), image upload (⇧⌘K).
- Selection: click, Shift-click, marquee, ⌘-click for deep select, Enter/⇧Enter to go into children or out to the parent, Tab to step through siblings, ⌘ + right-click for a "layers under cursor" menu. Hover highlights shallow frames first.
- Transform: drag, resize from 8 handles (Shift keeps aspect ratio, ⌥ resizes from centre), rotate, arrow-key nudge (1 px; Shift for 10 px), ⌥-drag to duplicate (compounding rotation), ⌘D duplicate, ⌘G wrap in frame, ⇧A add flex layout.
- Canvas: wheel or trackpad pan, ⌘/pinch zoom, an option to scroll-zoom with the wheel, invertible scroll zoom, ⇧-scroll for horizontal scroll, arrow-key panning when nothing is selected, ⇧1 zoom to fit, ⇧2 zoom to selection, ⌘0 to 100%.
- Layers panel: tree, rename, show/hide, lock, drag to reorder and reparent, collapse all (⌥L), search.
- UI: minimal mode that hides all chrome (⌘\\). Resizable sidebars. Light and dark editor theme. A "reduce agent animations" setting.
- Clipboard: copy/paste within and between files, "Paste to replace" (⇧⌘R; ⌘R reloads the browser), copy as PNG, copy as React (⌥R), copy as Tailwind (⌥T), copy as HTML.

### 4.9 Components (P1, ahead of Paper)

Paper lists components as "coming soon". OpenCrease specifies them now, because agents and code sync depend on them.

- **Component** = a Frame marked as a main component with a set of **props**: `text`, `boolean` (visibility), `enum` (variant), `instance-swap`, `slot` (a child region that takes arbitrary content).
- **Instance** = a reference to the main component plus prop values plus per-node style overrides (keyed by the main node's ID path).
- Variants = an enum prop over sibling components grouped in a component set.
- Code mapping: a component can declare `codeRef: { package, export, propsMap }`, so `get_jsx` emits `<Button variant="primary">` instead of raw divs. This covers "use your code components" from Paper's roadmap.
- Libraries (P2): publish components and tokens from one file and subscribe from others, with update notifications.

---

## 5. Design tokens & themes

- Token types: `color, spacing, radius, fontFamily, fontWeight, fontSize, lineHeight, letterSpacing, opacity, container, breakpoint`. Names follow the Tailwind v4 namespaces (`--color-*`, `--spacing-*`, `--radius-*`, `--font-*`, `--font-weight-*`, `--text-*`, `--leading-*`, `--tracking-*`, `--opacity-*`, `--container-*`, `--breakpoint-*`).
- A value is a literal, or an **alias** written as `var(--other)`. Detect alias cycles and reject them.
- Each token has an optional description (≤1024 chars) and an ordered position. Order matters for display.
- Tokens are emitted as CSS custom properties on the file root, so a node references them as `var(--color-primary)`, `color-mix(in oklch, var(--color-primary) 40%, transparent)`, and so on.
- UI: a **Theme** tab in the left panel with add, edit, duplicate, and delete; multi-select; copy/paste between files; token pickers in every property dropdown; detach (Backspace); highlight usages.
- **Modes** (P1, ahead of Paper): a token collection can have modes (light/dark, compact/comfortable). Frames can pin a mode, which applies it to that subtree via `data-mode` and scoped custom properties.
- **Text styles** (P1): named bundles of typography tokens that can be applied in one click and export as Tailwind `@utility` or CSS classes.
- Import/export: CSS `:root {}`, Tailwind v4 `@theme {}`, W3C Design Tokens (DTCG) JSON, and an agent-driven "sync from codebase" via MCP.

---

## 6. Import

| Source | Behaviour | Priority |
|---|---|---|
| Images (PNG, JPG, WebP, AVIF, GIF, HEIC/HEIF, SVG) | Paste, drop, or upload as an Image node, or an SVG node for SVG | P0 |
| Plain text | Paste as a Text node | P0 |
| HTML with inline styles | Parse, normalise to the allowlist (§4.2), and convert unsupported layout (margins → padding/gap where possible, grid → flex approximation, inline → block) | P0 |
| OpenCrease clipboard | Lossless node JSON inside `text/html` with a `data-opencrease` payload | P0 |
| Figma clipboard | Parse Figma's `text/html` clipboard (base64 Kiwi-encoded buffer) into frames, text, vectors, and images, mapping auto layout to flex. Best-effort, with a separate maintainer. | P2 |
| **Snapshot** (browser extension) | WebExtension for Chrome, Firefox, and Safari. Capture the current page, a selected element, or the full page (⌘Enter) into editable layers: computed styles, inlined images, fonts, OpenType features. Send to the desktop app over localhost, or copy to the clipboard. Document CORS setup for local dev servers. | P1 |

The HTML normaliser is shared by paste, Snapshot, and MCP `write_html`. That makes it one of the most important modules in the codebase.

---

## 7. Export

### 7.1 Assets
- Formats: **PNG, JPG, WebP, AVIF** (scale `0.5x…4x`, or a target `512w`, `512h`, or `720p`), **SVG** (SVG nodes only), **PDF** (vector text, embedded fonts, image quality and resampling options), **combined PDF** (one page per node, ordered top-to-bottom then left-to-right).
- **Video:** MP4 (opaque) and WebM (transparent), 1–300 s, 24/30/60 fps, for any frame containing animated shaders or video.
- Per-node export settings with presets (for example, YouTube thumbnail, OG image, app icon set). "Export all with settings" on a page. Default scale is @2x.
- Implementation: rasterise the real DOM. In the desktop app, use Electron `webContents.capturePage` / `printToPDF` in an offscreen window. On the server or CLI, use headless Chromium (Playwright). Video: step the shader clock deterministically per frame, capture, then encode with WebCodecs + `mp4-muxer` / `webm-muxer` (or ffmpeg in the CLI).

### 7.2 Code
- **Copy as React (inline styles)**, **React + Tailwind v4** (with inline fallback for values Tailwind can't express), **HTML + CSS**, and **Vue/Svelte** (P2).
- Options: include node IDs (for agents), strip root positioning, use token variables or resolved values, and component mapping (§4.9).
- Export must round-trip: `write_html(get_jsx(x))` ≈ `x`. Run this as a property test in CI.

### 7.3 Headless CLI
`opencrease export file.fold --node <id|name> --format png --scale 2x -o out/`. Also `opencrease render`, `opencrease tokens export --format tailwind`, and `opencrease mcp`.

---

## 8. Agent interface (MCP)

### 8.1 Transports
| Transport | Use |
|---|---|
| **stdio** via `opencrease mcp` (the CLI is installed by the desktop app) | Default for Claude Code, Codex, Cursor, VS Code, Zed, OpenCode, and others. The CLI connects to the running app over a local socket. If the app isn't running, it can open files headlessly (§8.4). |
| **Streamable HTTP** on `127.0.0.1:<port>/mcp` | Legacy/compat. Default port `29880`, configurable. (Paper Desktop uses 29979, so OpenCrease avoids it and both can run side by side.) |
| **Remote MCP** on the sync server, `/mcp` | Authenticated with OAuth 2.1 per the MCP spec. Agents edit team files without a desktop app. (Paper: "coming soon".) |
| **WebMCP** (`navigator.modelContext`) | Exposes the same tools to browser-hosted agents from the web app |

There are no usage quotas. Server admins can configure per-user rate limits.

### 8.2 Tool catalogue (Paper-compatible names and shapes)

**Context & reading**
- `get_guide(topic)`: built-in usage guides for agents (`mcp-instructions`, `mobile-status-bar`, `figma-import`, `image-generation`). The text is user-overridable per workspace. Ship a neutral, non-plagiarised default guide.
- `list_resources(limit)`: files and folders. Flags: open, active tab, draft.
- `get_basic_info(fileId?, pageId?)`: file and page names, node count, artboards with sizes and world positions, page list, fonts in use, compact token list, URL.
- `get_selection(fileId?)`
- `get_tree_summary(nodeId, depth≤10)`: indented `Type "name" (id) W×H`
- `get_children(nodeId)`, `get_node_info(nodeId)`
- `get_jsx(nodeId, format: tailwind|inline-styles, includeNodeIds, includeRootPositioning)`
- `get_computed_styles(nodeIds[])`
- `get_screenshot(nodeId, scale)`: base64 image, size-capped
- `get_fill_image(nodeId)`: base64 JPEG of an image fill plus the source URL
- `get_font_family_info(familyNames[])`: availability, weights, styles, axes
- `get_tokens(format: json|css|tailwind, types?, namePattern?)`
- `find_nodes(filters[{styleName, styleValue}], textValue?, pageId?, nodeId?)`: wildcard matching, colour equivalence, matches token-bound usages

**Files & pages**
- `create_file(name?, cloneFileId?)`, `open_file(fileId|url, pageId?)`, `rename_resource`
- `create_page(name?, icon?)`, `update_pages`, `arrange_pages(order[], removeDividerIds?)`

**Writing**
- `create_artboard(name, styles{width,height,…}, pageId?)`: auto-placed in free space
- `write_html(targetNodeId, mode: insert-children|replace, html)`: parsed through the HTML normaliser. Supports the `layer-name` attribute, `<x-clone node-id="…" style="…"/>` (also accept `x-paper-clone` as an alias), `asset://` for local paths (also accept `paper-asset://`), and `gen://` for AI images (also accept `paper-gen://`) when an AI provider is configured.
- `update_styles(updates[{nodeIds[], styles}])`: returns `ignoredStyles`
- `set_text_content`, `rename_nodes`
- `move_nodes(moves[])`: sibling-relative or parent+index. Returns `affectedParents`.
- `duplicate_nodes(nodes[{id, parentId?}])`: returns `descendantIdMap`
- `delete_nodes(nodeIds[])`
- `create_tokens`, `set_tokens` (update/delete)
- `export(nodes, type: image|video, pageId?)`, `export_combined_pdf(nodeIds[])`: return file paths, or base64 for remote

**Collaboration**
- `list_comment_threads(…filters)`, `get_comment_thread`, `set_comment_thread_status`, `list_comment_thread_authors`, `create_comment` (new)
- `start_working_on_nodes` (implicit on first write) / `finish_working_on_nodes(nodeIds?)`: shows an "agent is working" indicator and presence on artboards

**Additions beyond Paper (namespaced so they don't collide)**
- `oc_create_component`, `oc_set_component_props`, `oc_create_instance` (§4.9)
- `oc_get_diff(sinceVersion)`: what changed, for agents syncing designs back to code
- `oc_set_mode(nodeId, mode)` (§5)

### 8.3 Agent UX rules
- Every file-scoped tool response starts with a header `{file:{id,name}, contentHash:{tokens}}`, so agents can detect a wrong file or tokens that changed under them.
- Agent edits stream to the canvas live and are attributed to an agent identity in presence and history. Each MCP call is one undo step.
- Permission prompt on first connection per agent client. Read-only tools are marked as such (`readOnlyHint`) so hosts can auto-allow them.
- Writes are refused on locked nodes or read-only files, and the tool returns a clear error.

### 8.4 Headless mode
`opencrease mcp --headless --file path.fold` runs a hidden Chromium instance (Electron with no window, or Playwright) so CI and agents can edit and render `.fold` files with no GUI. That makes "design in git, rendered in CI" possible.

### 8.5 Design quality layer (P0)
Paper's agent output is good mostly for two reasons. Its MCP server ships a long, opinionated design guide that agents are told to load before any other tool. And its tools force a loop of building in small steps, taking screenshots and self-critiquing. The model does the designing, and the product shapes how it works. OpenCrease treats this as a core feature, written from scratch in our own words.

**Layered guide.** `get_guide("craft")` returns these layers merged, later layers overriding earlier ones:
1. Built-in craft guide, shipped with the app and versioned with it.
2. User guide at `~/.opencrease/guide.md`, for personal taste.
3. Per-file guide at `<file>.fold/guide.md`, for the brand's mood, type, always and never rules.
Editable in Settings → Design guide. Agents may propose edits to layer 3 but never write layers 1 or 2.

**What the built-in guide covers** (topics only, original text to be written):
- Commit to a mood and derive every color from it. One strong accent, neutrals with a reason.
- Contrast between display and body type. Readable minimum sizes. Tight tracking on large type only.
- Spacing that groups and separates on purpose. Information on surfaces instead of nested cards.
- Realistic copy and data. Never placeholder slogans.
- A short list of overused looks to avoid.
- Repeated rows use fixed-width slots so columns line up.

**Required steps** (toggleable per file):
- *Brief first.* Before the first write to a new artboard, the agent must post mood, palette, type and direction. The server tracks this per artboard and returns a soft error from `write_html` until a brief exists, unless the file already has tokens.
- *Review checkpoints.* After each section the agent calls `get_screenshot` and checks spacing, type, contrast, alignment, clipping and repetition. The in-app agent panel shows this checklist.
- *Tokens over literals.* Writes that use a raw color or size matching an existing token value get a warning listing the token to use.
- *Small steps.* Each `write_html` call should add one visual group, so the user can watch and interrupt.

**Constraints that help taste.** The allowlisted CSS (§4.2) keeps agents on flex, padding and gap, which produces cleaner and more consistent layouts than margin-and-grid soup. Tool descriptions repeat the most important rules, because many agents read descriptions but skip guides.

**Measuring it.** Keep a fixed set of prompts (landing page, dashboard, mobile app, poster) and run them against each release with screenshots stored in CI. A guide change ships only if a human reviewer prefers the new outputs.

---

## 9. Shaders

### 9.1 Model
A `Shader` node or fill references a shader definition and its params. It renders into a `<canvas>` with WebGL2, falling back to a static first-frame image when WebGL isn't available.

### 9.2 Built-in set
Reuse **`@paper-design/shaders`** (Apache-2.0), which already implements the reference set: paper texture, fluted glass, water, image dithering, halftone dots, halftone CMYK, lens distortion, heatmap, liquid metal, gem smoke, mesh gradient (animated and static), static radial gradient, dithering, grain gradient, dot orbit, dot grid, warp, spiral, swirl, waves, neuro noise, perlin, simplex noise, voronoi, pulsing border, metaballs, colour panels, smoke ring, god rays.

### 9.3 Requirements
- An auto-generated property panel from each shader's param schema (number/slider, colour, colour list, enum, image/logo upload, angle).
- Shaders can take an image or another node's rasterisation as input (logo animations, image filters).
- Export: static raster, or MP4/WebM via deterministic frame stepping (§7.1). Code export emits `@paper-design/shaders-react` usage.
- P2: user-authored GLSL shaders with a declared param schema, sandboxed.

### 9.4 Licensing note
Vendor or depend on `@paper-design/shaders` and keep its `LICENSE` and `NOTICE` in `THIRD_PARTY_NOTICES`. Don't use the "Paper Shaders" name in the UI. Call them "Shaders".

---

## 10. AI features (bring your own provider)

All optional. They are off until the user configures a provider in Settings → AI. API keys are stored in the OS keychain (desktop) or as server-side encrypted secrets.

| Feature | Notes | Priority |
|---|---|---|
| Image generation into a fill or a new node (⇧⌘I) | Provider adapters: OpenAI Images, Google (Gemini image), Replicate, fal, xAI, any OpenAI-compatible endpoint, local ComfyUI or Automatic1111. The prompt persists on the node. Async status: `processing / ready / error`. | P1 |
| Image editing (in-paint, restyle) using the existing fill and canvas text as reference | Keeps aspect ratio and size | P1 |
| SVG generation (⇧⌘J) using a selected frame as context | Via an LLM that outputs SVG, or a dedicated SVG model | P2 |
| Vectorise raster | Local (vtracer), no AI needed | P2 |
| In-app agent panel | A chat panel that runs a user-configured LLM against the local MCP tools. "Canvas-aware agent assistant" from Paper's roadmap. | P2 |
| Live data | MCP-driven: agents fetch from CMS/APIs and write into layers. Docs and examples only, no special feature. | P1 (docs) |

`gen://` URL scheme: `gen://image?prompt=…&model=…&w=…&h=…`. The node stores the prompt, model, and seed so the image can be regenerated.

---

## 11. Collaboration, sharing & organisation (deferred, post-v1)

> Not in v1 scope. v1 ships as local-only (§11.5). This section stays as the target design so the document model and file format don't block it later.

### 11.1 Sync server (`opencrease-server`)
- Stateless WebSocket gateway plus a doc worker that applies Loro updates, persists snapshots and op logs, and compacts them.
- Storage: **Postgres** (metadata, comments, users, ACLs) and **S3-compatible object storage** (MinIO, R2, AWS) for snapshots and assets. SQLite plus local disk for single-node installs.
- Asset hosting: content-addressed, deduplicated, signed URLs. Covers "host assets" from Paper's roadmap.
- Deploy: one container image. Ship `docker compose` with Postgres and MinIO, and a Helm chart (P2).
- Offline: clients keep a local replica in IndexedDB (web) or on disk (desktop) and merge when they reconnect.

### 11.2 Presence
- Live cursors with name and colour. Selection outlines for others. Follow mode: click an avatar to follow that person's viewport. Cursor chat (`/`). Avatars in the toolbar.
- **Agents appear as participants**, with a distinct badge, their working-on indicators, and their cursor at the last edited node.

### 11.3 Comments
- Pin comments to a node, or to a canvas point relative to a node. Threads, replies, @mentions, reactions, attachments (lightbox), resolve and reopen.
- Right panel: search, filter (open/resolved, author, page), sort (page/created/updated), unread indicators.
- Comment mode (C), and comments can be hidden or shown.
- Exposed through MCP (§8.2) so agents can work through feedback and resolve it.

### 11.4 Accounts, teams, permissions
- Auth: local accounts (email + password or magic link), **OIDC** (Google, GitHub, Keycloak, Authentik…), **SAML** (P2). No paywall on SSO.
- Roles: Owner, Admin, Editor, Viewer at team level. Per-file overrides (P1; Paper: "coming soon").
- Sharing: invite by email, link sharing (off / team / anyone with the link) with view, comment, or edit permission. Anonymous view-only visitors see a banner.
- Dashboard: teams, nested folders, drafts, recents, cross-folder search, grid and list views, multi-select move/duplicate/delete, thumbnails.

### 11.5 Local-only mode
The desktop app works with no server or account. Files are `.fold` files on disk, and you open folders as workspaces. A file can later be "published" to a server, and the CRDT history is kept.

---

## 12. Applications

| App | Tech | Notes |
|---|---|---|
| **Web** | TypeScript, Vite, React for the editor chrome (not the canvas content), Loro WASM | Served by `opencrease-server` or as a static build pointing at a server |
| **Desktop** | **Electron** | Chosen over Tauri on purpose: the canvas *is* the browser engine, so every OS must render with the same engine (Chromium) for design and export fidelity. Tauri would use WebKit on macOS and WebKitGTK on Linux. Features: tabs (multiple files), local file access, system fonts, MCP host plus CLI installer ("Connect your agent" dialog that writes config for Claude Code, Codex, Cursor, VS Code, Zed, OpenCode…), auto-update, deep links `opencrease://file/<id>/<page>` |
| **CLI** | Node, single binary via `bun build --compile` or `pkg` | `mcp`, `export`, `render`, `tokens`, `serve` |
| **Browser extension** | WebExtension MV3 | Snapshot (§6) |

### 12.1 Monorepo layout (suggested)

```
apps/
  web/            editor web app
  desktop/        Electron shell
  server/         sync + API + remote MCP
  extension/      Snapshot
packages/
  format/         .fold schema, read/write          (MIT)
  model/          CRDT doc, node ops, undo           
  css/            allowlist, normaliser, HTML parser, JSX/Tailwind serializer
  renderer/       DOM canvas, virtualisation, measurement
  overlay/        selection/handles/guides
  editor/         tools, panels, shortcuts
  mcp/            tool implementations (transport-agnostic)
  export/         raster/pdf/video pipelines
  shaders/        adapter over @paper-design/shaders
  ai/             provider adapters
  cli/
```

---

## 13. Non-functional requirements

| Area | Target |
|---|---|
| Scale | 50,000 nodes per file and 5,000 per artboard while keeping 60 fps pan/zoom on a 2021 MacBook Air. Paper files of about 3.5k nodes are typical today. |
| Load | Open a 10k-node file in under 1.5 s from local cache. Lazy-load inactive pages. |
| Latency | Local edit to paint in under 16 ms. Remote edit propagation p95 under 150 ms on the same continent. MCP write tool round trip under 50 ms locally, excluding layout-heavy operations. |
| Memory | Under 500 MB for a 10k-node file in the desktop app |
| Fidelity | Exported PNG equals on-canvas render at 1x: pixel diff ≤ 0.5% in visual regression tests |
| Accessibility | Editor chrome meets WCAG 2.2 AA: keyboard reachable, screen-reader labels on panels, reduced-motion support |
| i18n | Editor UI is localisable (ICU messages). Keyboard shortcuts are layout-aware (e.g. Z on AZERTY/QWERTZ). |
| Security | User HTML is sanitised: no scripts, no event handlers, no external fetches except allowlisted font and image hosts. Content renders in a sandboxed context. MCP local transport binds to loopback only, using a per-session token. |
| Privacy | No telemetry by default. Opt-in anonymous crash reports. |
| Platforms | macOS 13+, Windows 10+, Linux (AppImage, deb, rpm, Flatpak). Web on evergreen Chromium, Firefox, and Safari. Desktop is the reference for fidelity. |

---

## 14. Testing strategy
- **Unit:** model ops, CSS normaliser (golden HTML in, node JSON out), token resolution, alias cycles.
- **Round-trip property tests:** node tree → JSX/HTML → `write_html` → node tree is stable.
- **Visual regression:** Playwright renders a corpus of `.fold` fixtures and compares against baselines.
- **CRDT fuzzing:** random concurrent op sequences from N clients must converge.
- **MCP conformance suite:** replay recorded agent sessions (prompt → tool calls) and assert the resulting trees. It doubles as a compatibility check against Paper's tool shapes.
- **Performance budget CI:** a synthetic 50k-node file, measuring frame time, load, and memory.

---

## 15. Roadmap

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0: Foundations** | `.fold` format, CRDT model, DOM renderer + overlay, select/move/resize, Frame/Text/Rectangle, flex layout panel, layers panel, undo/redo, local save | Rebuild a typical settings screen by hand |
| **M1: Agent-ready (MVP)** | HTML normaliser, local MCP (stdio + HTTP) with all read and write tools from §8.2, `get_jsx`, PNG/JPG export, Copy as React/Tailwind, tokens (no modes), Google and local fonts, paste HTML/images/SVG | Claude Code builds a 10-screen app design through MCP using only Paper-style prompts |
| **M2: Designer-grade** | All styling panels, OKLCH picker, gradients, image fills and crop, filters, constraints, guides and snapping, pages, SVG editing + pen tool, shaders, PDF/WebP/AVIF/SVG export, desktop app with tabs | A designer can replace Paper for solo work |
| **M3: Beyond Paper** | Components + variants + code mapping, token modes, text styles, video export, AI image providers, Snapshot extension, headless CLI rendering, in-app agent panel | Feature parity plus components |
| **M4** | Rich text, CSS Grid, booleans, libraries, Figma paste, plugins/scripting API, version-history diff | — |
| **Later: Multiplayer** | Sync server, accounts/OIDC, sharing and roles, presence, comments + MCP comment tools, remote MCP, Docker deploy | A team of 5 shares a self-hosted instance |

The design quality layer (§8.5) is part of M1. Without it, agents produce generic output, and nothing else in the product makes up for that.

---

## 16. Licensing & governance
- **App + server:** AGPL-3.0-or-later. It stops closed SaaS forks of the hosted server and leaves self-hosting free.
- **`@opencrease/format`, the document model, MCP tool schemas, the CSS normaliser, and SDKs:** MIT, so other tools can adopt the format freely.
- **Third-party:** `@paper-design/shaders` (Apache-2.0, keep NOTICE), Loro (MIT), Electron (MIT), fonts per their licences (OFL).
- DCO sign-off on contributions, plus a clean-room attestation in `CONTRIBUTING.md` (§0).

---

## 17. Open questions
1. **Name.** Is "OpenCrease" free of conflicts? There is an unrelated *OpenCrease* protein-structure project (AlphaFold reimplementation), which could cause SEO and search confusion. Consider alternatives before publishing.
2. **Loro vs Yjs.** Loro has better tree semantics. Yjs has a larger ecosystem (Hocuspocus, y-indexeddb). Decide with a 50k-node benchmark.
3. **Licence.** AGPL vs Apache-2.0 for the app depends on whether adoption or protection matters more.
4. **Web vs desktop fidelity.** Should the web app be supported for export on Firefox/Safari, or should export always happen server-side in Chromium?
5. **Figma paste.** Its clipboard format is undocumented and changes. Decide whether it's worth core maintenance or should be a community plugin.
6. **Plugin API.** Should plugins be MCP-only, which is simpler, or have an in-process JS API?

---

## Appendix A: sources
- paper.design homepage, /docs, /docs/mcp, /docs/tokens, /docs/svg, /docs/paste, /pricing, /roadmap, /build-log, /compare/figma
- shaders.paper.design (shader list) and github.com/paper-design/shaders (Apache-2.0)
- Observed Paper MCP tool interface (tool names, arguments, response shapes) and the structure of a sample file: node types Frame/Text/Rectangle/SVG; IDs like `3G8-0`; artboards as top-level absolutely positioned frames with `overflow: clip`; text nodes with `white-space: pre-wrap`.
