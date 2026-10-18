# Snapshot and Figma import

## Snapshot browser extension

Build from the repository root with `pnpm --filter @opencrease/extension build`.

- Chrome: open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select `apps/extension/dist/chrome`.
- Firefox: open `about:debugging#/runtime/this-firefox`, choose Load Temporary Add-on, and select `apps/extension/dist/firefox/manifest.json`. The MV3 build uses a Firefox background script rather than a Chrome service worker. Signing is needed for permanent installation.
- Safari packaging and signing remain a follow-up.

Start OpenCrease and keep an editor tab open. Paste the Snapshot extension token from **Connect an agent** into the popup. It is shared across server ports and survives restarts; update it after **Settings → Agents → Reset token**. Clipboard capture needs no token. The popup reports the local server connection. Click the port number to change it from the default 29880. Choose an open file, a new file, or the clipboard.

Pick an element starts a hover outline. Click to capture, use the up/down arrows to select ancestors and return to descendants, or Escape to cancel. Command+Enter on macOS (Ctrl+Enter elsewhere) captures the full page while the popup or picker is open. Visible area captures the viewport at the current scroll position. Full page captures the document's current rendered content; it does not scroll to trigger lazy loading.

Captures produce editable HTML layers, not a flat screenshot. Computed paint and typography pass through `@opencrease/css` normalization. Measured spacing becomes flex gap and padding, with absolute positions for overlapping content. The extension preserves font families, weights, variation axes and supported OpenType settings. It does not redistribute font files: install private fonts locally, or use the editor's Google Fonts loader.

Images and CSS background/mask URLs are downloaded in the extension background context and inlined. The server stores inline image data as content-addressed file assets. Clipboard captures keep data URLs. Failed image downloads keep their original URL and are reported in the capture notice. An individual download is limited to 15 MiB and the capture's inlined image data to 60 MiB. Canvas/video frames are raster images when readable; cross-origin tainted canvases and embedded frames cannot be reconstructed.

Inline SVG shapes and local sprite references are retained. Pseudo-elements are temporarily materialized as real nodes and removed after measurement. Open shadow trees, slots, and browser-supported closed shadow access are walked. Browser pages and extension stores cannot be captured. Mixed inline text styling, complex transforms, CSS counters, animations, external SVG sprites, masks and custom font availability may reduce fidelity. Compare the imported artboard with the original before relying on a capture.

When no editor is connected, Snapshot saves to disk and returns the file URL without opening a window. Sending to a connected editor inserts the capture in one undo step, reveals the artboard, and flushes it to disk before acknowledging delivery. Repeated solid colours can optionally become document tokens. Clipboard delivery writes OpenCrease HTML, ready for normal canvas paste.

### Permissions and local development

The extension requests `activeTab`, `scripting`, `storage`, `clipboardWrite`, and host access to all URLs. Host access lets the background script download cross-origin images and contact the local server on a configurable port. It sends captured content only to `http://127.0.0.1:<port>`. The host-access request is broad because captured page assets may come from arbitrary CDNs. Chrome may require enabling access to file URLs for local file captures.

The OpenCrease HTTP server remains bound to loopback. Extension origins (`chrome-extension://` and `moz-extension://`) receive CORS access only to `GET /api/status` and `POST /api/snapshot`, including their OPTIONS preflights. They cannot use file endpoints, MCP, agent tools or the WebSocket bridge. Normal website origins remain rejected. Requests without an Origin header retain the existing local CLI contract.

Capturing a local development page requires no additional CORS configuration on that page. Image downloads run with the extension's host permission. Authentication, expired URLs and blob URLs that are inaccessible to the background context can still prevent inlining. Do not enable arbitrary website origins on OpenCrease to work around an asset download failure.

### Browser verification

`apps/extension/test/smoke.mjs` loads the actual unpacked Chrome extension in Playwright using `headless: false` with `--headless=new`; this produces no visible browser window. It exercises selected-element, viewport, full-page, server and clipboard delivery, SVG gradients, pseudo-elements, a shadow tree, an external image, and synthetic Figma paste. It also attempts example.com. Run it with a temporary workspace and the track's server/Vite ports 29909 and 5209:

```sh
pnpm --filter @opencrease/extension build
OPENCREASE_NO_BROWSER=1 OPENCREASE_EDITOR_URL=http://127.0.0.1:5209 node apps/server/bin/opencrease.mjs /tmp/of-9/ws --no-open --port 29909
OPENCREASE_PORT=29909 pnpm --filter @opencrease/editor exec vite --host 127.0.0.1 --port 5209 --strictPort
# In a third terminal:
node --import tsx apps/extension/test/smoke.mjs
```

Screenshots and the run summary are written to `test-results/track9`. The local fixture's checked boxes differed by up to 4 px in the live canvas. A public example.com capture preserved editable multilingual text and its SVG icon in the live canvas; the existing MCP raster screenshot path omitted that icon. Stop both development servers after testing. Firefox is built and typechecked, but has not been exercised in a real Firefox browser by this track.

## Figma paste (experimental)

Canvas paste detects Figma's `<!--(figma)...(/figma)-->` comment before generic HTML or a bitmap fallback. The parser reads the `fig-kiwi` archive, inflates its embedded schema, and decodes the message with a bounded Kiwi interpreter. Both raw deflate and Zstandard message compression are supported. Clipboard-supplied schema identifiers are never evaluated as code. Optional `figmeta` is read independently.

Frames, layer names, fixed dimensions, visibility, local transforms, solid fills/strokes and horizontal/vertical auto layout map to normal nodes. Text retains the layer's family, inferred weight, size, line height and alignment. Path-command blobs become editable SVG paths. Embedded PNG, JPEG and WebP image blobs become Image nodes with data URLs. Missing embedded image bytes and unsupported vector network geometry preserve bounds and produce console warnings. Multiple fills, gradients, effects, masks, mixed text runs, component semantics, variables and advanced auto layout sizing are incomplete.

**Verification uses an encoded synthetic fixture, not real Figma clipboard output.** The fixture includes its own Kiwi schema, frames, text, vector commands and image bytes. A real Figma selection must still be tested before considering this importer production-ready. On decoding failure, paste falls back to an available clipboard image or plain text and logs the reason.

The MIT-licensed [`kiwi-schema`](https://github.com/evanw/kiwi) package supplies schema decoding and primitive readers. Compression uses [`fflate`](https://github.com/101arrowz/fflate) (MIT) and [`fzstd`](https://github.com/101arrowz/fzstd) (MIT). Archive framing and node-field interpretation were checked against the public [Grida Figma parser source](https://github.com/gridaco/grida/tree/main/packages/grida-canvas-io-figma/fig-kiwi). OpenCrease's interpreter and node converter are implemented locally.
