// Fill section: stacked background layers (solid, gradients, image, shader) for boxes, `color` for
// text, `fill` for SVG.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { FoldDocument, OFNode, ShaderSpec } from "@opencrease/model";
import { closeGradientEdit, gradientEdit, openGradientEdit } from "../../../canvas/gradient-edit";
import { useStore } from "../../../canvas/store";
import { resolveSrc } from "../../../state/api";
import { Button, clamp, IconButton, MIXED, NumberField, Popover, Section, Segmented, SelectField, useMenu, type MenuItem } from "../../../ui";
import { ColorField } from "../color/ColorField";
import { resolveColor } from "../color/ColorPicker";
import { applyStyles, common, useCtx } from "./common";
import { computedColorToHex, useComputedText } from "./computed";
import { readNodeFills, writeNodeFills } from "./fill-write";
import { imageFit, isGradientLayer, layerToCss, moveLayer, withImageFit, type FillLayer, type GradientLayer, type ImageFit } from "./fills";
import { convertGradient, gradientToCss, insertStop, moveStop, resolvedStops, type GradientKind, type GradientStop } from "./gradient";
import { assetHashOf, pickImage } from "./pick-image";
import { useReorder } from "./reorder";
import { newShaderSpec, ShaderParams, ShaderPicker, ShaderPresets, shaderSwatch } from "./shader-panel";
import { shaderLabel } from "./shader-schema";

const NO_IDS: string[] = [];

type FillMode = "background" | "color" | "svg";

function fillMode(node: OFNode): FillMode {
  if (node.type === "Text") return "color";
  if (node.type === "SVG" || node.type === "SVGElement") return "svg";
  return "background";
}

const resolveVars = (doc: FoldDocument, css: string) => css.replace(/var\(\s*(--[\w-]+)\s*\)/g, (m) => resolveColor(doc, m));

function swatchCss(layer: FillLayer, doc: FoldDocument, fileId: string): string {
  switch (layer.kind) {
    case "solid":
      return resolveVars(doc, layer.color);
    case "image":
      return `center / cover no-repeat url("${resolveSrc(fileId, layer.url) ?? layer.url}")`;
    case "shader":
      return shaderSwatch(layer.spec);
    default:
      return resolveVars(doc, layerToCss(layer, true));
  }
}

const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];
const blendLabel = (m: string) => m.charAt(0).toUpperCase() + m.slice(1).replace("-", " ");

const DEFAULT_STOPS: GradientStop[] = [
  { color: "#FFFFFF", position: 0 },
  { color: "#000000", position: 100 },
];

export function FillSection() {
  const ctx = useCtx();
  const { doc, nodes, fileId } = ctx;
  const [menu, openMenu] = useMenu();
  const computed = useComputedText(nodes.every((n) => n.type === "Text") ? ctx.ids : NO_IDS, doc);
  const modes = common(nodes, fillMode);
  const layersKey = modes === "background" ? common(nodes, (n) => JSON.stringify(readNodeFills(n))) : MIXED;
  const layers: FillLayer[] = layersKey === MIXED ? [] : (JSON.parse(layersKey) as FillLayer[]);
  const write = (next: FillLayer[], label = "Fill", mk?: string) => writeNodeFills(fileId, ctx.ids, () => next, label, mk);
  const reorder = useReorder(layers.length, (from, to) => write(moveLayer(layers, from, to), "Reorder fills"), (i) => layers[i]?.kind !== "shader");

  // close the canvas gradient handles when the selection changes
  const selKey = ctx.ids.join(",");
  useEffect(() => () => closeGradientEdit(), [selKey]);

  if (modes === MIXED) return null;
  const mode = modes;
  const colorTokens = doc.tokens.filter((t) => t.type === "color");

  // ---------------------------------------------------------- text colour / svg fill
  if (mode !== "background") {
    const key = mode === "color" ? "color" : "fill";
    const value = common(nodes, (n) => String(n.styles[key] ?? (mode === "svg" ? (n.attrs?.fill ?? "") : "")));
    const empty = value === "" || value === "none";
    const set = (v: string | null, mk?: string) => applyStyles(ctx, { [key]: v }, mode === "color" ? "Text colour" : "Fill", mk);
    // text without its own colour paints with the inherited one: show it and offer an override
    const inherited = mode === "color" && value === "" ? common(nodes, (n) => (computed[n.id] ? computedColorToHex(computed[n.id].color) : "")) : "";
    const inheritedHex = inherited === MIXED ? "" : inherited;
    const showInherited = mode === "color" && value === "";
    return (
      <Section
        title="Fill"
        collapsed={empty && !showInherited}
        onHeaderClick={empty && !showInherited ? () => set("#000000") : undefined}
        actions={
          <>
            {colorTokens.length ? (
              <IconButton icon="tokens" iconSize={12} size="xs" label="Colour tokens" onClick={(e) => openMenu(colorTokens.map((t) => ({ label: t.name.slice(2), onSelect: () => set(`var(${t.name})`) })), e.currentTarget)} />
            ) : null}
            {empty && !showInherited ? <IconButton icon="plus" iconSize={12} size="xs" label="Add fill" onClick={() => set("#000000")} /> : null}
          </>
        }
      >
        {value === MIXED ? (
          <div className="of-row">
            <span className="of-hint" style={{ flex: 1 }}>Mixed colours</span>
            <button className="of-btn sm" onClick={() => set("#000000")}>Set all</button>
          </div>
        ) : showInherited ? (
          <div className="of-fill-row">
            <button
              className="of-fill-chip"
              style={{ cursor: "default", font: "inherit", textAlign: "left" }}
              title="This text uses the colour of a parent layer. Click to set its own colour."
              onClick={() => set(inheritedHex || "#000000")}
            >
              <span className="swatch-btn" style={{ opacity: 0.75 }}><i style={{ background: inheritedHex || "transparent" }} /></span>
              <span className="ftext" style={{ color: "var(--of-muted)" }}>{inherited === MIXED ? "Mixed" : inheritedHex || "Default"}</span>
              <span className="fmeta" style={{ width: "auto", fontFamily: "var(--of-font-sans)" }}>Inherited</span>
            </button>
            <span className="of-row-slot" style={{ width: 28, display: "flex", justifyContent: "center" }}>
              <IconButton icon="plus" iconSize={12} size="sm" label="Override colour" onClick={() => set(inheritedHex || "#000000")} />
            </span>
          </div>
        ) : !empty ? (
          <div className="of-fill-row">
            <ColorField value={value} doc={doc} fileId={fileId} onChange={(v, mk) => set(v, mk)} />
            <span className="of-row-slot" style={{ width: 28, display: "flex", justifyContent: "center" }}>
              <IconButton icon="minus" iconSize={12} size="sm" label="Remove fill" onClick={() => set(mode === "svg" ? "none" : null)} />
            </span>
          </div>
        ) : null}
        {menu}
      </Section>
    );
  }

  // ---------------------------------------------------------- background layers
  const mixed = layersKey === MIXED;
  const canShader = nodes.every((n) => n.type === "Frame" || n.type === "Rectangle");
  const hasShader = layers.some((l) => l.kind === "shader");
  const insertAt = hasShader ? 1 : 0;
  const backgroundBlend = common(nodes, (n) => String(n.styles.backgroundBlendMode ?? "normal"));
  const add = (layer: FillLayer = { kind: "solid", color: layers.length ? "#FFFFFF" : "#D9D9D9" }) => {
    if (layer.kind === "shader") write([layer, ...layers], "Add shader fill");
    else write([...layers.slice(0, insertAt), layer, ...layers.slice(insertAt)], "Add fill");
  };
  const addMenu = (anchor: HTMLElement) => {
    const items: MenuItem[] = [
      { label: "Solid colour", onSelect: () => add() },
      { label: "Linear gradient", onSelect: () => add({ kind: "linear", angle: 180, stops: DEFAULT_STOPS }) },
      { label: "Radial gradient", onSelect: () => add({ kind: "radial", shape: "circle", stops: DEFAULT_STOPS }) },
      { label: "Conic gradient", onSelect: () => add({ kind: "conic", angle: 0, stops: [...DEFAULT_STOPS, { color: "#FFFFFF", position: 100 }].map((s, i) => ({ ...s, position: i * 50 })) }) },
      { label: "Image", onSelect: () => pickImage(fileId, (img) => add({ kind: "image", url: img.url, raw: `url("${img.url}")`, size: "cover", position: "center", repeat: "no-repeat" })) },
      { type: "separator" },
      {
        label: "Shader",
        disabled: !canShader || hasShader,
        onSelect: () => add({ kind: "shader", spec: newShaderSpec("MeshGradient") }),
      },
    ];
    openMenu(items, anchor);
  };

  return (
    <Section
      title="Fill"
      collapsed={!mixed && layers.length === 0}
      onHeaderClick={!mixed && layers.length === 0 ? () => add() : undefined}
      actions={
        <>
          {colorTokens.length ? (
            <IconButton
              icon="tokens"
              iconSize={12}
              size="xs"
              label="Colour tokens"
              onClick={(e) =>
                openMenu(
                  colorTokens.map((t) => ({
                    label: t.name.slice(2),
                    icon: <span className="of-swatch"><i style={{ background: resolveColor(doc, `var(${t.name})`) }} /></span>,
                    onSelect: () => {
                      const solidIdx = layers.findIndex((l) => l.kind === "solid" && !l.hidden);
                      if (solidIdx >= 0) write(layers.map((l, i) => (i === solidIdx ? { ...l, kind: "solid", color: `var(${t.name})` } as FillLayer : l)), "Fill token");
                      else add({ kind: "solid", color: `var(${t.name})` });
                    },
                  })),
                  e.currentTarget,
                )
              }
            />
          ) : null}
          <IconButton icon="plus" iconSize={12} size="xs" label="Add fill" onClick={(e) => addMenu(e.currentTarget)} />
        </>
      }
    >
      {mixed ? (
        <div className="of-row">
          <span className="of-hint" style={{ flex: 1 }}>Mixed fills</span>
          <button className="of-btn sm" onClick={() => write([{ kind: "solid", color: "#FFFFFF" }], "Fill")}>Replace all</button>
        </div>
      ) : (
        layers.map((layer, i) => {
          const update = (next: FillLayer, mk?: string) => write(layers.map((l, j) => (j === i ? next : l)), "Fill", mk);
          const remove = () => write(layers.filter((_, j) => j !== i), layer.kind === "shader" ? "Remove shader fill" : "Remove fill");
          const toggle = () => write(layers.map((l, j) => (j === i ? ({ ...l, hidden: !l.hidden } as FillLayer) : l)), layer.hidden ? "Show fill" : "Hide fill");
          const row = reorder.row(i);
          return (
            <div key={i} ref={row.ref} className={`${row.className}${layer.hidden ? " is-hidden" : ""}`}>
              {reorder.grip(i, "Drag to reorder fills")}
              <div className="of-fill-row">
                <LayerChip layer={layer} index={i} doc={doc} fileId={fileId} nodeId={ctx.ids.length === 1 ? ctx.ids[0] : null} onChange={update} />
                <span className="of-fill-actions">
                  <IconButton icon={layer.hidden ? "eyeOff" : "eye"} iconSize={14} size="sm" label={layer.hidden ? "Show fill" : "Hide fill"} onClick={toggle} />
                  <IconButton icon="minus" iconSize={12} size="sm" label="Remove fill" onClick={remove} />
                </span>
              </div>
            </div>
          );
        })
      )}
      {!mixed && layers.some((l) => l.kind !== "shader") ? (
        <SelectField
          label="Blend"
          ariaLabel="Background blend mode"
          value={backgroundBlend === MIXED || backgroundBlend.includes(",") ? "" : backgroundBlend}
          placeholder={backgroundBlend === MIXED ? "Mixed" : "Per layer"}
          options={BLEND_MODES.map((m) => ({ value: m, label: blendLabel(m) }))}
          onChange={(m) => applyStyles(ctx, { backgroundBlendMode: m === "normal" ? null : m }, "Background blend mode")}
        />
      ) : null}
      {menu}
    </Section>
  );
}

function LayerChip({ layer, index, doc, fileId, nodeId, onChange }: { layer: FillLayer; index: number; doc: FoldDocument; fileId: string; nodeId: string | null; onChange: (l: FillLayer, mk?: string) => void }) {
  if (layer.kind === "solid") {
    return (
      <ColorField
        value={layer.color}
        doc={doc}
        fileId={fileId}
        onChange={(c, mk) => onChange({ ...layer, color: c }, mk)}
        onAddStop={(c) => onChange({ kind: "linear", angle: 180, stops: [{ color: layer.color, position: 0 }, { color: c, position: 100 }] })}
      />
    );
  }
  if (isGradientLayer(layer)) return <GradientChip layer={layer} index={index} doc={doc} fileId={fileId} nodeId={nodeId} onChange={onChange} />;
  if (layer.kind === "image") return <ImageChip layer={layer} doc={doc} fileId={fileId} onChange={onChange} />;
  if (layer.kind === "shader") return <ShaderChip layer={layer} doc={doc} fileId={fileId} onChange={onChange} />;
  return (
    <div className="of-fill-chip">
      <span className="swatch-btn"><i style={{ background: swatchCss(layer, doc, fileId) }} /></span>
      <span className="ftext" title={layer.raw}>{layer.raw}</span>
    </div>
  );
}

// ---------------------------------------------------------------- gradients

const KIND_LABEL: Record<GradientKind, string> = { linear: "Linear", radial: "Radial", conic: "Conic" };

function GradientChip({ layer, index, doc, fileId, nodeId, onChange }: { layer: GradientLayer; index: number; doc: FoldDocument; fileId: string; nodeId: string | null; onChange: (l: FillLayer, mk?: string) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const open = () => {
    if (anchor) return close();
    setAnchor(chipRef.current);
    if (nodeId) openGradientEdit(fileId, nodeId, index);
  };
  const close = () => {
    setAnchor(null);
    if (nodeId) closeGradientEdit(nodeId);
  };
  const meta = layer.kind === "radial" ? (layer.shape === "circle" ? "Circle" : "Ellipse") : `${Math.round(layer.angle)}°`;
  return (
    <div className={`of-fill-chip${anchor ? " active" : ""}`} ref={chipRef}>
      <button className="swatch-btn" aria-label="Edit gradient" onClick={open}>
        <i style={{ background: swatchCss(layer, doc, fileId) }} />
      </button>
      <button className="ftext sans" onClick={open}>
        {layer.repeating ? "Repeating " + KIND_LABEL[layer.kind].toLowerCase() : KIND_LABEL[layer.kind]}
      </button>
      <span className="fmeta" style={{ width: "auto" }}>{meta}</span>
      {anchor ? <GradientEditor anchor={anchor} layer={layer} doc={doc} fileId={fileId} onChange={onChange} onClose={close} /> : null}
    </div>
  );
}

let stopDragSession = 0;

function GradientEditor({ anchor, layer, doc, fileId, onChange, onClose }: { anchor: HTMLElement; layer: GradientLayer; doc: FoldDocument; fileId: string; onChange: (l: FillLayer, mk?: string) => void; onClose: () => void }) {
  const selected = useStore(gradientEdit, (s) => s.stop);
  const setSelected = (i: number) => gradientEdit.set({ stop: i });
  const setStops = (stops: GradientStop[], mk?: string) => onChange({ ...layer, stops } as FillLayer, mk);
  const resolved = resolvedStops(layer.stops);
  const preview = resolveVars(doc, gradientToCss({ kind: "linear", angle: 90, stops: resolved }));
  const barRef = useRef<HTMLDivElement>(null);
  const sel = Math.min(selected, layer.stops.length - 1);

  const addStopAt = (pos: number, color?: string) => {
    const c = color ?? colorAt(resolved, pos);
    const r = insertStop(layer.stops, c, pos);
    setStops(r.stops);
    setSelected(r.index);
  };

  const dragStop = (e: ReactPointerEvent<HTMLElement>, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(i);
    const bar = barRef.current;
    if (!bar) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const mk = `stop-${++stopDragSession}`;
    const startStops = resolvedStops(layer.stops);
    const move = (ev: PointerEvent) => {
      const r = bar.getBoundingClientRect();
      const p = Math.round(clamp(((ev.clientX - r.left) / r.width) * 100, 0, 100) * 10) / 10;
      const moved = moveStop(startStops, i, p);
      setStops(moved.stops, mk);
      setSelected(moved.index);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <Popover anchor={anchor} onClose={onClose} placement="left" gap={12} width={264}>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="of-row">
          <Segmented
            ariaLabel="Gradient type"
            value={layer.kind}
            onChange={(k) => onChange({ ...convertGradient(layer, k), ...boxOf(layer) } as FillLayer)}
            options={[
              { value: "linear", label: "Linear" },
              { value: "radial", label: "Radial" },
              { value: "conic", label: "Conic" },
            ]}
            style={{ flex: 1 }}
          />
        </div>
        <div className="of-row">
          {layer.kind !== "radial" ? (
            <NumberField
              icon="rotate"
              ariaLabel="Angle"
              value={layer.angle}
              suffix="°"
              allowUnits={false}
              onCommit={(a, mk) => typeof a === "number" && onChange({ ...layer, angle: ((a % 360) + 360) % 360 }, mk)}
            />
          ) : (
            <SelectField
              ariaLabel="Shape"
              value={layer.shape ?? "ellipse"}
              options={[
                { value: "ellipse", label: "Ellipse" },
                { value: "circle", label: "Circle" },
              ]}
              onChange={(s) => onChange({ ...layer, shape: s })}
            />
          )}
          {layer.kind !== "linear" ? (
            <>
              <NumberField label="X" ariaLabel="Centre X" value={layer.at?.x ?? 50} suffix="%" allowUnits={false} onCommit={(x, mk) => typeof x === "number" && onChange({ ...layer, at: { x, y: layer.at?.y ?? 50 } }, mk)} style={{ flex: "0 0 64px" }} />
              <NumberField label="Y" ariaLabel="Centre Y" value={layer.at?.y ?? 50} suffix="%" allowUnits={false} onCommit={(y, mk) => typeof y === "number" && onChange({ ...layer, at: { x: layer.at?.x ?? 50, y } }, mk)} style={{ flex: "0 0 64px" }} />
            </>
          ) : null}
        </div>
        {layer.kind === "radial" ? (
          <SelectField
            label="Size"
            ariaLabel="Radial size"
            value={layer.radialSize ?? "farthest-corner"}
            options={[
              { value: "farthest-corner", label: "Farthest corner" },
              { value: "farthest-side", label: "Farthest side" },
              { value: "closest-corner", label: "Closest corner" },
              { value: "closest-side", label: "Closest side" },
            ]}
            onChange={(s) => onChange({ ...layer, radialSize: s === "farthest-corner" ? undefined : s })}
          />
        ) : null}

        {/* stops bar: drag markers, click the bar to add a stop */}
        <div style={{ position: "relative", padding: "0 7px" }}>
          <div
            ref={barRef}
            role="presentation"
            title="Click to add a stop"
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              addStopAt(clamp(((e.clientX - r.left) / r.width) * 100, 0, 100));
            }}
            style={{ height: 20, borderRadius: 4, background: `${preview}, repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 8px 8px`, boxShadow: "inset 0 0 0 1px #00000014" }}
          />
          {resolved.map((s, i) => (
            <button
              key={i}
              className={`of-stop-marker${i === sel ? " on" : ""}`}
              aria-label={`Stop ${i + 1} at ${Math.round(s.position)}%`}
              style={{ left: `calc(7px + (100% - 14px) * ${s.position / 100})`, ["--c" as string]: resolveVars(doc, s.color) }}
              onPointerDown={(e) => dragStop(e, i)}
            />
          ))}
        </div>

        <div className="of-row" style={{ justifyContent: "space-between" }}>
          <span className="of-section-title">Stops</span>
          <IconButton icon="plus" iconSize={12} size="xs" label="Add stop" onClick={() => addStopAt(midGap(resolved))} />
        </div>
        {layer.stops.map((s, i) => (
          <div className={`of-row${i === sel ? " of-stop-row on" : " of-stop-row"}`} key={i} style={{ gap: 6 }} onPointerDown={() => setSelected(i)}>
            <NumberField
              ariaLabel="Stop position"
              value={s.position}
              placeholder="auto"
              suffix="%"
              min={0}
              max={100}
              allowUnits={false}
              style={{ flex: "0 0 64px" }}
              onCommit={(p, mk) => setStops(layer.stops.map((x, j) => (j === i ? { ...x, position: typeof p === "number" ? p : undefined } : x)), mk)}
            />
            <ColorField
              value={s.color}
              doc={doc}
              fileId={fileId}
              nested
              onChange={(c, mk) => setStops(layer.stops.map((x, j) => (j === i ? { ...x, color: c } : x)), mk)}
              onAddStop={(c) => addStopAt(midGap(resolved, i), c)}
            />
            <IconButton icon="minus" iconSize={12} size="xs" label="Remove stop" disabled={layer.stops.length <= 2} onClick={() => setStops(layer.stops.filter((_, j) => j !== i))} />
          </div>
        ))}
        <SelectField
          label="Blend"
          ariaLabel="Layer blend mode"
          value={layer.blend ?? "normal"}
          options={BLEND_MODES.map((m) => ({ value: m, label: blendLabel(m) }))}
          onChange={(m) => onChange({ ...layer, blend: m === "normal" ? undefined : m })}
        />
        <span className="of-hint">Drag the handles on the canvas to move stops and endpoints. Shift with the eyedropper adds the picked colour as a stop.</span>
      </div>
    </Popover>
  );
}

function boxOf(l: FillLayer) {
  return { size: l.size, position: l.position, repeat: l.repeat, blend: l.blend, hidden: l.hidden };
}

/** Middle of the widest gap between stops (after stop `after` when given). */
function midGap(stops: Array<{ position: number }>, after?: number): number {
  if (after !== undefined && after < stops.length - 1) return (stops[after].position + stops[after + 1].position) / 2;
  let best = 50;
  let width = -1;
  for (let i = 0; i < stops.length - 1; i++) {
    const w = stops[i + 1].position - stops[i].position;
    if (w > width) {
      width = w;
      best = stops[i].position + w / 2;
    }
  }
  return best;
}

/** The colour of the nearest stop at a position (CSS mixing between stops is left to the browser). */
function colorAt(stops: Array<{ color: string; position: number }>, pos: number): string {
  let best = stops[0]?.color ?? "#000000";
  let d = Infinity;
  for (const s of stops) {
    const dd = Math.abs(s.position - pos);
    if (dd < d) {
      d = dd;
      best = s.color;
    }
  }
  return best;
}

// ---------------------------------------------------------------- image

const FIT_LABEL: Record<ImageFit, string> = { fill: "Fill", fit: "Fit", tile: "Tile", crop: "Crop" };

function ImageChip({ layer, doc, fileId, onChange }: { layer: Extract<FillLayer, { kind: "image" }>; doc: FoldDocument; fileId: string; onChange: (l: FillLayer, mk?: string) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const hash = assetHashOf(layer.url);
  const name = (hash && doc.assets[hash]?.name) || (hash ? "Image" : layer.url.split("/").pop() || "Image");
  const toggle = () => setAnchor(anchor ? null : chipRef.current);
  return (
    <div className={`of-fill-chip${anchor ? " active" : ""}`} ref={chipRef}>
      <button className="swatch-btn" aria-label="Edit image fill" onClick={toggle}>
        <i style={{ background: swatchCss(layer, doc, fileId) }} />
      </button>
      <button className="ftext sans" onClick={toggle} title={name}>{name}</button>
      <span className="fmeta" style={{ width: "auto", fontFamily: "var(--of-font-sans)" }}>{FIT_LABEL[imageFit(layer)]}</span>
      {anchor ? <ImageEditor anchor={anchor} layer={layer} fileId={fileId} onChange={onChange} onClose={() => setAnchor(null)} /> : null}
    </div>
  );
}

function splitPair(v: string | undefined, fallback: [string, string]): [string, string] {
  if (!v) return fallback;
  const p = v.trim().split(/\s+/);
  return [p[0] ?? fallback[0], p[1] ?? (p[0] === "center" ? "center" : fallback[1])];
}

function ImageEditor({ anchor, layer, fileId, onChange, onClose }: { anchor: HTMLElement; layer: Extract<FillLayer, { kind: "image" }>; fileId: string; onChange: (l: FillLayer, mk?: string) => void; onClose: () => void }) {
  const fit = imageFit(layer);
  const [sw, sh] = splitPair(layer.size, ["auto", "auto"]);
  const [px, py] = splitPair(layer.position, ["0%", "0%"]);
  const url = resolveSrc(fileId, layer.url) ?? layer.url;
  const field = (v: string) => (/^-?\d*\.?\d+px$/.test(v) ? Number.parseFloat(v) : v === "center" ? "50%" : v);
  const asCss = (v: unknown) => (typeof v === "number" ? `${Math.round(v * 100) / 100}px` : String(v));
  return (
    <Popover anchor={anchor} onClose={onClose} placement="left" gap={12} width={248}>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div
          style={{
            height: 120, borderRadius: 4, boxShadow: "inset 0 0 0 1px #00000014",
            background: `url("${url}") ${layer.position ?? "0% 0%"} / ${layer.size ?? "auto"} ${layer.repeat ?? "repeat"}, repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 0 0 / 8px 8px`,
          }}
        />
        <Segmented
          ariaLabel="Image fit"
          value={fit}
          onChange={(f) => onChange(withImageFit(layer, f))}
          options={(["fill", "fit", "tile", "crop"] as ImageFit[]).map((f) => ({ value: f, label: FIT_LABEL[f] }))}
        />
        {fit === "crop" || fit === "tile" ? (
          <>
            <div className="of-row">
              <NumberField label="W" ariaLabel="Image width" value={field(sw)} placeholder="auto" allowKeywords onCommit={(w, mk) => onChange({ ...layer, size: `${w === null ? "auto" : asCss(w)} ${sh}`.replace(/ auto$/, "") }, mk)} />
              <NumberField label="H" ariaLabel="Image height" value={sh === "auto" ? undefined : field(sh)} placeholder="auto" allowKeywords onCommit={(h, mk) => onChange({ ...layer, size: `${sw} ${h === null ? "auto" : asCss(h)}`.replace(/ auto$/, "") }, mk)} />
            </div>
            {fit === "crop" ? (
              <div className="of-row">
                <NumberField label="X" ariaLabel="Image X" value={field(px)} onCommit={(x, mk) => onChange({ ...layer, position: `${x === null ? "50%" : asCss(x)} ${py}` }, mk)} />
                <NumberField label="Y" ariaLabel="Image Y" value={field(py)} onCommit={(y, mk) => onChange({ ...layer, position: `${px} ${y === null ? "50%" : asCss(y)}` }, mk)} />
              </div>
            ) : null}
          </>
        ) : null}
        <SelectField
          label="Blend"
          ariaLabel="Layer blend mode"
          value={layer.blend ?? "normal"}
          options={BLEND_MODES.map((m) => ({ value: m, label: blendLabel(m) }))}
          onChange={(m) => onChange({ ...layer, blend: m === "normal" ? undefined : m })}
        />
        <div className="of-row">
          <Button size="sm" style={{ flex: 1 }} onClick={() => pickImage(fileId, (img) => onChange({ ...layer, url: img.url, raw: `url("${img.url}")` }))}>
            Replace image
          </Button>
        </div>
        <span className="of-hint">Hold ⌘ while dragging a resize handle on the canvas to crop: the image stays in place while the frame changes.</span>
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------- shader fill

function ShaderChip({ layer, doc, fileId, onChange }: { layer: Extract<FillLayer, { kind: "shader" }>; doc: FoldDocument; fileId: string; onChange: (l: FillLayer, mk?: string) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const toggle = () => setAnchor(anchor ? null : chipRef.current);
  const setSpec = (spec: ShaderSpec, mk?: string) => onChange({ ...layer, spec }, mk);
  return (
    <div className={`of-fill-chip${anchor ? " active" : ""}`} ref={chipRef}>
      <button className="swatch-btn" aria-label="Edit shader fill" onClick={toggle}>
        <i style={{ background: shaderSwatch(layer.spec) }} />
      </button>
      <button className="ftext sans" onClick={toggle}>{shaderLabel(layer.spec.name)}</button>
      <span className="fmeta" style={{ width: "auto", fontFamily: "var(--of-font-sans)" }}>Shader</span>
      {anchor ? (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} placement="left" gap={12} width={272}>
          <div className="of-scroll" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, maxHeight: "min(640px, calc(100vh - 32px))", overflowY: "auto" }}>
            <ShaderPicker value={layer.spec.name} onPick={(n) => setSpec(newShaderSpec(n))} />
            <ShaderPresets spec={layer.spec} onChange={setSpec} />
            <div style={{ height: 1, background: "var(--of-hairline)", margin: "4px 0" }} />
            <ShaderParams spec={layer.spec} onChange={setSpec} doc={doc} fileId={fileId} />
            <span className="of-hint">Shader fills draw above the other fills and below the layer's children.</span>
          </div>
        </Popover>
      ) : null}
    </div>
  );
}
