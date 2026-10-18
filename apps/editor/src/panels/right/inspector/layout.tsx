// Layout, Flex, Position and Appearance sections.
import { useState } from "react";
import type { StyleValue } from "@opencrease/model";
import { getWorldRect } from "../../../canvas/registry";
import { getOpenFile } from "../../../state/workspace";
import { Icon, IconButton, MIXED, NumberField, Section, Segmented, SelectField, ToggleRow, pxValue, useMenu, type FieldValue, type Mixed } from "../../../ui";
import { readCorners, readSides, writeCorners, writeSides, type Sides } from "./box";
import { applyStyles, common, measured, parentOf, styleValue, tokenOptions, tokenResolver, useCtx } from "./common";
import { flexDirection, INTENT_LABEL, isAbsolute, isFlex, sizeIntent, sizePatch, type Axis, type SizeIntent } from "./sizing";

const v = (x: FieldValue | null): StyleValue | null => x;
const INTENT_ICON = { fixed: "sizeFixed", hug: "sizeHug", fill: "sizeFill" } as const;

// ---------------------------------------------------------------- Layout

export function LayoutSection() {
  const ctx = useCtx();
  const { doc, nodes } = ctx;
  const [ratioLocked, setRatioLocked] = useState(false);
  const [showRotation, setShowRotation] = useState(false);
  const [menu, openMenu] = useMenu();
  const allAbs = nodes.every((n) => isAbsolute(n, parentOf(doc, n)));
  const single = nodes.length === 1 ? nodes[0] : null;
  const rotate = styleValue(nodes, "rotate");
  const rotationVisible = showRotation || (rotate !== undefined && rotate !== MIXED);

  const sizeField = (axis: Axis) => {
    const intent = common(nodes, (n) => sizeIntent(n, parentOf(doc, n), axis));
    const raw = styleValue(nodes, axis);
    let value: FieldValue | Mixed | undefined = raw;
    if (intent !== "fixed" && single) value = measured(single.id, axis) ?? undefined;
    else if (intent === MIXED) value = MIXED;
    const setIntent = (next: SizeIntent) =>
      applyStyles(ctx, (n) => sizePatch(next, n, parentOf(doc, n), axis, measured(n.id, axis)), `Size ${INTENT_LABEL[next]}`);
    return (
      <NumberField
        label={axis === "width" ? "W" : "H"}
        value={value}
        min={0}
        fallback={single ? (measured(single.id, axis) ?? 0) : 0}
        resolveToken={tokenResolver(doc)}
        tokens={tokenOptions(doc, ["spacing", "container"])}
        onCommit={(val, key) => {
          if (val === null) return;
          const n = pxValue(val);
          if (n !== null && ratioLocked) {
            const other: Axis = axis === "width" ? "height" : "width";
            applyStyles(ctx, (node) => {
              const a = measured(node.id, axis) ?? n;
              const b = measured(node.id, other) ?? 0;
              const patch = { ...sizePatch("fixed", node, parentOf(doc, node), axis, n), ...sizePatch("fixed", node, parentOf(doc, node), other, a ? (b * n) / a : b) };
              return patch;
            }, "Resize", key);
          } else if (n !== null) {
            applyStyles(ctx, (node) => sizePatch("fixed", node, parentOf(doc, node), axis, n), "Resize", key);
          } else if (val === "fit-content" || val === "auto") {
            setIntent("hug");
          } else {
            applyStyles(ctx, { [axis]: val }, "Resize", key);
          }
        }}
        trailing={
          <button
            type="button"
            className="of-field-tag icon"
            aria-label={`Sizing: ${intent === MIXED ? "Mixed" : INTENT_LABEL[intent]}`}
            title={`${intent === MIXED ? "Mixed sizing" : INTENT_LABEL[intent]}. Click to change`}
            onClick={(e) =>
              openMenu(
                (["fixed", "hug", "fill"] as SizeIntent[]).map((it) => ({
                  label: INTENT_LABEL[it],
                  checked: intent === it,
                  icon: <Icon name={INTENT_ICON[it]} size={12} style={{ color: "var(--of-muted)", transform: axis === "height" ? "rotate(90deg)" : undefined }} />,
                  onSelect: () => setIntent(it),
                })),
                e.currentTarget,
                { minWidth: 120 },
              )
            }
          >
            {intent === MIXED ? <span style={{ fontSize: 10, lineHeight: "12px" }}>~</span> : <Icon name={INTENT_ICON[intent]} size={12} style={{ transform: axis === "height" ? "rotate(90deg)" : undefined }} />}
          </button>
        }
      />
    );
  };

  return (
    <Section
      title="Layout"
      actions={
        <>
          <IconButton icon="rotate" iconSize={12} size="xs" label="Rotation" active={rotationVisible} onClick={() => setShowRotation((s) => !s)} />
          <IconButton icon={ratioLocked ? "link" : "unlink"} iconSize={12} size="xs" label={ratioLocked ? "Unlock aspect ratio" : "Lock aspect ratio"} active={ratioLocked} onClick={() => setRatioLocked((s) => !s)} />
        </>
      }
    >
      {allAbs ? (
        <div className="of-row">
          <NumberField label="X" value={styleValue(nodes, "left")} placeholder="0" onCommit={(x, key) => applyStyles(ctx, { left: v(x) }, "Move", key)} resolveToken={tokenResolver(doc)} tokens={tokenOptions(doc, ["spacing"])} />
          <NumberField label="Y" value={styleValue(nodes, "top")} placeholder="0" onCommit={(y, key) => applyStyles(ctx, { top: v(y) }, "Move", key)} resolveToken={tokenResolver(doc)} tokens={tokenOptions(doc, ["spacing"])} />
        </div>
      ) : null}
      <div className="of-row">
        {sizeField("width")}
        {sizeField("height")}
      </div>
      {rotationVisible ? (
        <div className="of-row">
          <NumberField
            icon="rotate"
            ariaLabel="Rotation"
            value={rotate === MIXED ? MIXED : rotate === undefined ? undefined : Number.parseFloat(String(rotate)) || 0}
            suffix="°"
            placeholder="0°"
            onCommit={(r, key) => applyStyles(ctx, { rotate: r === null || r === 0 ? null : `${pxValue(r) ?? 0}deg` }, "Rotate", key)}
          />
          <span style={{ flex: 1 }} />
        </div>
      ) : null}
      {menu}
    </Section>
  );
}

// ---------------------------------------------------------------- Flex

type Align = "flex-start" | "center" | "flex-end";
const ALIGNS: Align[] = ["flex-start", "center", "flex-end"];

function normAlign(v: StyleValue | undefined): Align | "stretch" | "space-between" | "other" {
  const s = String(v ?? "flex-start");
  if (s === "start" || s === "flex-start" || s === "normal" || s === "left" || s === "top") return "flex-start";
  if (s === "end" || s === "flex-end" || s === "right" || s === "bottom") return "flex-end";
  if (s === "center") return "center";
  if (s === "stretch") return "stretch";
  if (s === "space-between" || s === "space-around" || s === "space-evenly") return "space-between";
  return "other";
}

export function FlexSection() {
  const ctx = useCtx();
  const { doc, nodes } = ctx;
  const containers = nodes.filter((n) => n.type === "Frame");
  const [perSide, setPerSide] = useState(false);
  if (containers.length !== nodes.length) return null;
  const flexOn = common(nodes, isFlex);
  if (flexOn !== true) {
    return (
      <Section
        title="Flex"
        collapsed
        onHeaderClick={() => applyStyles(ctx, { display: "flex", flexDirection: "column" }, "Add flex layout")}
        actions={<IconButton icon="plus" iconSize={12} size="xs" label="Add flex layout" onClick={() => applyStyles(ctx, { display: "flex", flexDirection: "column" }, "Add flex layout")} />}
      />
    );
  }
  const first = nodes[0];
  const dir = flexDirection(first);
  const wrap = String(first.styles.flexWrap ?? "nowrap") === "wrap";
  const justify = normAlign(first.styles.justifyContent);
  const align = normAlign(first.styles.alignItems ?? "stretch");
  const between = justify === "space-between";

  const setCell = (col: number, row: number, dbl: boolean) => {
    const mainIdx = dir === "row" ? col : row;
    const crossIdx = dir === "row" ? row : col;
    const patch: Record<string, StyleValue | null> = { alignItems: ALIGNS[crossIdx] };
    patch.justifyContent = dbl ? (between ? ALIGNS[mainIdx] : "space-between") : between ? "space-between" : ALIGNS[mainIdx];
    if (patch.justifyContent === "flex-start") patch.justifyContent = null;
    applyStyles(ctx, patch, "Align");
  };

  const sidesCommon = (i: number) => common(nodes, (n) => readSides(n.styles, "padding")[i]);
  const pairValue = (a: number, b: number): FieldValue | Mixed | undefined => {
    const va = sidesCommon(a);
    const vb = sidesCommon(b);
    if (va === MIXED || vb === MIXED || String(va ?? "") !== String(vb ?? "")) return MIXED;
    return va;
  };
  const setSides = (idx: number[], val: FieldValue | null, key?: string) =>
    applyStyles(ctx, (n) => {
      const s = readSides(n.styles, "padding") as Sides<StyleValue | null | undefined>;
      for (const i of idx) s[i] = val;
      return writeSides("padding", s);
    }, "Padding", key);
  const spacing = tokenOptions(doc, ["spacing"]);
  const resolve = tokenResolver(doc);

  return (
    <Section
      title="Flex"
      actions={<IconButton icon="minus" iconSize={12} size="xs" label="Remove flex layout" onClick={() => applyStyles(ctx, { display: null, flexDirection: null, flexWrap: null, gap: null, rowGap: null, columnGap: null, alignItems: null, justifyContent: null }, "Remove flex layout")} />}
    >
      <div className="of-row" style={{ alignItems: "stretch" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <Segmented
            ariaLabel="Direction"
            style={{ flex: "0 0 28px" }}
            value={wrap ? "wrap" : dir}
            onChange={(d) =>
              applyStyles(ctx, d === "wrap" ? { flexDirection: "row", flexWrap: "wrap" } : { flexDirection: d === "row" ? "row" : "column", flexWrap: null }, "Flex direction")
            }
            options={[
              { value: "row", icon: "dirRow", title: "Row" },
              { value: "column", icon: "dirColumn", title: "Column" },
              { value: "wrap", icon: "wrap", title: "Wrap" },
            ]}
          />
          <NumberField
            icon="gap"
            ariaLabel="Gap"
            value={styleValue(nodes, "gap") ?? styleValue(nodes, dir === "row" ? "columnGap" : "rowGap")}
            placeholder="0"
            min={0}
            allowKeywords={false}
            resolveToken={resolve}
            tokens={spacing}
            onCommit={(g, key) => applyStyles(ctx, { gap: g === 0 ? null : v(g), rowGap: null, columnGap: null }, "Gap", key)}
          />
        </div>
        <AlignMatrix dir={dir} justify={justify} align={align} onCell={setCell} />
      </div>
      {perSide ? (
        <>
          <div className="of-row">
            <NumberField icon="padTop" ariaLabel="Padding top" value={sidesCommon(0)} placeholder="0" min={0} resolveToken={resolve} tokens={spacing} onCommit={(x, k) => setSides([0], x, k)} />
            <NumberField icon="padRight" ariaLabel="Padding right" value={sidesCommon(1)} placeholder="0" min={0} resolveToken={resolve} tokens={spacing} onCommit={(x, k) => setSides([1], x, k)} />
            <span className="of-row-slot">
              <IconButton icon="sides" iconSize={14} label="Same padding on opposite sides" active onClick={() => setPerSide(false)} />
            </span>
          </div>
          <div className="of-row">
            <NumberField icon="padBottom" ariaLabel="Padding bottom" value={sidesCommon(2)} placeholder="0" min={0} resolveToken={resolve} tokens={spacing} onCommit={(x, k) => setSides([2], x, k)} />
            <NumberField icon="padLeft" ariaLabel="Padding left" value={sidesCommon(3)} placeholder="0" min={0} resolveToken={resolve} tokens={spacing} onCommit={(x, k) => setSides([3], x, k)} />
            <span className="of-row-slot" />
          </div>
        </>
      ) : (
        <div className="of-row">
          <NumberField icon="padV" ariaLabel="Vertical padding" value={pairValue(0, 2)} placeholder="0" min={0} resolveToken={resolve} tokens={spacing} onCommit={(x, k) => setSides([0, 2], x, k)} />
          <NumberField icon="padH" ariaLabel="Horizontal padding" value={pairValue(1, 3)} placeholder="0" min={0} resolveToken={resolve} tokens={spacing} onCommit={(x, k) => setSides([1, 3], x, k)} />
          <span className="of-row-slot">
            <IconButton icon="sides" iconSize={14} label="Padding per side" onClick={() => setPerSide(true)} />
          </span>
        </div>
      )}
    </Section>
  );
}

function AlignMatrix({ dir, justify, align, onCell }: { dir: "row" | "column"; justify: string; align: string; onCell: (col: number, row: number, dbl: boolean) => void }) {
  const idx = (a: string) => (a === "center" ? 1 : a === "flex-end" ? 2 : 0);
  const between = justify === "space-between";
  const mainIdx = idx(justify);
  const crossIdx = align === "stretch" ? -1 : idx(align);
  const active = (col: number, row: number) => {
    const m = dir === "row" ? col : row;
    const c = dir === "row" ? row : col;
    const crossOk = crossIdx === -1 ? c === 1 : c === crossIdx;
    return crossOk && (between ? true : m === mainIdx);
  };
  const bars = (col: number, row: number) => {
    // three bars drawn along the cross axis, like the design
    const lengths = dir === "row" ? [8, 12, 10] : [12, 8, 10];
    const crossI = dir === "row" ? row : col;
    const just = crossIdx === -1 ? "stretch" : ["flex-start", "center", "flex-end"][crossI];
    return (
      <span className={`bars${dir === "row" ? "" : " col"}`} style={{ alignItems: just === "stretch" ? "stretch" : just, height: 12, width: 12, justifyContent: "center" }}>
        {lengths.map((l, i) => (
          <i key={i} style={dir === "row" ? { width: 3, height: just === "stretch" ? 12 : l } : { height: 3, width: just === "stretch" ? 12 : l }} />
        ))}
      </span>
    );
  };
  return (
    <div className="of-align-matrix" title="Alignment. Double-click for space between.">
      {[0, 1, 2].map((row) =>
        [0, 1, 2].map((col) => {
          const on = active(col, row);
          const show = on && (!between || (dir === "row" ? col === 1 : row === 1));
          return (
            <button key={`${row}-${col}`} className="of-align-cell" aria-label={`Align ${row}-${col}`} onClick={(e) => onCell(col, row, e.detail === 2)}>
              {show ? bars(col, row) : <span className="dotc" style={on ? { background: "var(--of-accent)" } : undefined} />}
            </button>
          );
        }),
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Position

export function PositionSection() {
  const ctx = useCtx();
  const { doc, nodes, fileId } = ctx;
  const inParent = nodes.every((n) => parentOf(doc, n)?.type !== "Root" && n.parentId !== null);
  if (!inParent) return null;
  const abs = common(nodes, (n) => n.styles.position === "absolute" || n.styles.position === "fixed");
  const setAbsolute = (on: boolean) => {
    const file = getOpenFile(fileId);
    if (!file) return;
    file.store.transact(on ? "Absolute position" : "Auto layout position", (tx) => {
      for (const n of nodes) {
        const parent = parentOf(doc, n);
        if (!parent || n.locked) continue;
        if (on) {
          const r = getWorldRect(n.id);
          const pr = getWorldRect(parent.id);
          const left = r && pr ? Math.round(r.x - pr.x) : 0;
          const top = r && pr ? Math.round(r.y - pr.y) : 0;
          tx.setStyles(n.id, { position: "absolute", left, top, ...(r ? { width: Math.round(r.width), height: Math.round(r.height) } : {}) });
          if (!parent.styles.position) tx.setStyles(parent.id, { position: "relative" });
        } else {
          tx.setStyles(n.id, { position: null, left: null, top: null, right: null, bottom: null, zIndex: null });
        }
      }
    });
  };
  return (
    <Section title="Position">
      <ToggleRow label="Absolute position" on={abs === true} onChange={setAbsolute} />
    </Section>
  );
}

// ---------------------------------------------------------------- Appearance

const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];

export function AppearanceSection() {
  const ctx = useCtx();
  const { doc, nodes } = ctx;
  const [perCorner, setPerCorner] = useState(false);
  const [showBlend, setShowBlend] = useState(false);
  const blend = styleValue(nodes, "mixBlendMode");
  const blendVisible = showBlend || (blend !== undefined && blend !== MIXED && blend !== "normal");
  const corners = (i: number) => common(nodes, (n) => readCorners(n.styles)[i]);
  const uniform = common(nodes, (n) => {
    const c = readCorners(n.styles);
    return c.every((x) => String(x ?? "") === String(c[0] ?? "")) ? String(c[0] ?? "") : "~mixed";
  });
  const radiusValue: FieldValue | Mixed | undefined = uniform === MIXED || uniform === "~mixed" ? MIXED : uniform === "" ? undefined : (pxValue(uniform) ?? uniform);
  const setCorner = (idx: number[], val: FieldValue | null, key?: string) =>
    applyStyles(ctx, (n) => {
      const c = readCorners(n.styles) as Sides<StyleValue | null | undefined>;
      for (const i of idx) c[i] = val;
      return writeCorners(c);
    }, "Corner radius", key);
  const radius = tokenOptions(doc, ["radius"]);
  const resolve = tokenResolver(doc);
  const canRadius = nodes.every((n) => n.type !== "SVGElement" && n.type !== "Text");
  const containers = nodes.every((n) => n.type === "Frame");
  const overflow = common(nodes, (n) => String(n.styles.overflow ?? "visible"));
  const opacity = styleValue(nodes, "opacity");

  return (
    <Section
      title="Appearance"
      actions={<IconButton icon="blend" iconSize={12} size="xs" label="Blend mode" active={blendVisible} onClick={() => setShowBlend((s) => !s)} />}
    >
      <div className="of-row">
        <NumberField
          icon="opacity"
          ariaLabel="Opacity"
          value={opacity === undefined ? 1 : opacity}
          scale={100}
          suffix="%"
          min={0}
          max={1}
          digits={0}
          resolveToken={resolve}
          tokens={tokenOptions(doc, ["opacity"])}
          onCommit={(o, key) => applyStyles(ctx, { opacity: o === null || o === 1 ? null : v(o) }, "Opacity", key)}
        />
        {canRadius ? (
          perCorner ? (
            <span style={{ flex: 1 }} />
          ) : (
            <NumberField icon="radius" ariaLabel="Corner radius" value={radiusValue} placeholder="0" min={0} resolveToken={resolve} tokens={radius} onCommit={(r, key) => setCorner([0, 1, 2, 3], r, key)} />
          )
        ) : (
          <span style={{ flex: 1 }} />
        )}
        <span className="of-row-slot">
          {canRadius ? <IconButton icon="corners" iconSize={14} label="Radius per corner" active={perCorner} onClick={() => setPerCorner((s) => !s)} /> : null}
        </span>
      </div>
      {perCorner && canRadius ? (
        <>
          <div className="of-row">
            <NumberField icon="radiusTL" ariaLabel="Top left radius" value={corners(0)} placeholder="0" min={0} resolveToken={resolve} tokens={radius} onCommit={(r, k) => setCorner([0], r, k)} />
            <NumberField icon="radiusTR" ariaLabel="Top right radius" value={corners(1)} placeholder="0" min={0} resolveToken={resolve} tokens={radius} onCommit={(r, k) => setCorner([1], r, k)} />
            <span className="of-row-slot" />
          </div>
          <div className="of-row">
            <NumberField icon="radiusBL" ariaLabel="Bottom left radius" value={corners(3)} placeholder="0" min={0} resolveToken={resolve} tokens={radius} onCommit={(r, k) => setCorner([3], r, k)} />
            <NumberField icon="radiusBR" ariaLabel="Bottom right radius" value={corners(2)} placeholder="0" min={0} resolveToken={resolve} tokens={radius} onCommit={(r, k) => setCorner([2], r, k)} />
            <span className="of-row-slot" />
          </div>
        </>
      ) : null}
      {blendVisible ? (
        <div className="of-row">
          <SelectField
            label="Blend"
            ariaLabel="Blend mode"
            value={blend === MIXED ? "" : String(blend ?? "normal")}
            options={BLEND_MODES.map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1).replace("-", " ") }))}
            onChange={(m) => applyStyles(ctx, { mixBlendMode: m === "normal" ? null : m }, "Blend mode")}
          />
          <span className="of-row-slot" />
        </div>
      ) : null}
      {containers ? (
        <ToggleRow
          label="Clip content"
          on={overflow === "hidden" || overflow === "clip"}
          onChange={(on) => applyStyles(ctx, { overflow: on ? "clip" : null, overflowX: null, overflowY: null }, on ? "Clip content" : "Show overflow")}
        />
      ) : null}
    </Section>
  );
}

