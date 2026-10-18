# Canvas performance and verification

The repeatable fixture contains 50,000 design nodes plus a page root: ten artboards with 4,999 children each. A quarter of the children are text. Each artboard uses real CSS Grid and clips its overflowing content. No image network requests or animated shaders are included.

## Run

Use an isolated workspace and ports. These commands do not open visible windows:

```sh
node --import tsx scripts/generate-perf-file.ts /tmp/of-track4/ws/Canvas\ performance.fold
node apps/server/bin/opencrease.mjs /tmp/of-track4/ws --no-open --port 29904
OPENCREASE_PORT=29904 pnpm --filter @opencrease/editor exec vite --port 5204 --strictPort
```

Run the server and Vite in separate terminals, then:

```sh
node scripts/perf-canvas.mjs http://localhost:5204
node scripts/check-canvas.mjs http://localhost:5204
```

Restart Vite before benchmarking after source edits: importing a module by its plain URL while the mounted app uses an HMR timestamp can create separate module state. The benchmark detects this mismatch and fails. Run the benchmark alone, with the live regression check stopped. Stop both servers when finished.

The generator also accepts a design-node count and an artboard count as its third and fourth arguments. The benchmark defaults to the generated file ID; its optional second argument changes that ID, and its third argument changes the output directory.

## Measured run

18 October 2026, Apple M4, 16 GB RAM, macOS, headless Chromium 156.0.8078.4. Vite development mode, 1440 × 1000 CSS pixels, device scale 1. After a 12-frame warm-up, each scenario samples 180 animation frames while panning and varying zoom around 60%. The baseline disables viewport virtualisation in the same build. Other optimisations remain enabled in both scenarios.

| Measurement | Virtualisation disabled | Virtualisation enabled |
|---|---:|---:|
| Median frame interval | 33.7 ms | 16.7 ms |
| 95th percentile frame interval | 51.0 ms | 17.8 ms |
| Maximum frame interval | 113.7 ms | 260.9 ms |
| Mounted design node elements at the end | 50,000 | 30,004 |
| Live artboards at the end | 10 | 6 |

Navigation through network idle and the first canvas node took **2,387 ms**. Only **36 layer rows** were mounted with all 50k layers expanded. The reported JavaScript heap after the run was **131.1 MB** (`performance.memory.usedJSHeapSize`). CDP separately reported 118.1 MB of used V8 heap, 257.9 MB of embedder heap and 13.1 MB of backing storage; these are browser diagnostics, not total process RSS. There were no uncaught page errors.

The output is saved under `/tmp/of-track4/perf/`: `results.json`, `canvas-50k-light.png` and `canvas-50k-dark.png`. Results vary with system load and browser version. This machine is newer than the 2021 MacBook Air in the specification, so this run does not certify that hardware target. The p95 remains above a strict 16.7 ms frame budget. The large maximum is a remaining artboard mount/unmount transition cost; steady pan/zoom is substantially smoother, but large subtree transitions still need improvement.

## Changes behind the measurements

- Node refs provide constant-time DOM lookup instead of repeated selectors across the world.
- One store subscriber dispatches touched-node changes to node views, replacing a store-wide subscription for each node.
- Artboards outside the viewport margin become sized placeholders. Selection, text editing and MCP requests pin the necessary artboards live.
- The overlay measures and labels visible top-level layers rather than every artboard on every frame. Other selected/hovered/working nodes share a per-frame world-rect cache.
- The layer tree mounts visible 28px rows plus overscan. Selecting a remote row opens its ancestors and scrolls it into the virtual window.
- Below 10% zoom, idle raster captures replace visible artboard subtrees. Captures are versioned and stale results are discarded after switching files. Unknown-size layers remain live until measurable.
- Equal-spacing candidate discovery sorts targets before finding adjacent gaps, reducing repeated comparisons for rows and columns.

## Live regression coverage

`check-canvas.mjs` runs headless Chromium with clipboard permissions. It exercises grid template editing and grid lines, constraints through the real MCP bridge and percentage width changes, snapped rotation and rotated hit testing, multi-selection resize, scale typography, alignment, Tab navigation, arrow panning, click and area zoom, wheel modes, inverted zoom, Shift-scroll, sidebar resizing, Alt-drag and repeated duplication, layers-under-cursor menus, distance labels, PNG/React/Tailwind/HTML copy, paste to replace, and local-image transfers between files with constraints intact.

It captures Design, Code, Agent, Theme, Assets, Settings, colour picker, command palette and Home in both palettes. It also checks System theme resolution, system reduced motion, read-only responsive copies, MCP access to offscreen artboards, and an actual raster thumbnail below 10% zoom. Screenshots and a result summary are under `/tmp/of-track4/live/`.

Known bounds: scaling changes authored pixel lengths and retains percentages, relative units and token references. Responsive previews apply the same DOM/CSS at different widths; they do not introduce media-query rules or new document nodes. DOM visibility and advanced transforms such as skew are outside the oriented-rotation geometry model. Gradient handles and modifier cropping are limited to unrotated layers; rotation-aware selection and resize handles remain available. Raster capture can be limited by browser image/CORS rules; a failed capture leaves a sized placeholder and is logged.
