import { useEffect, useState } from "react";
import type { HorizontalConstraint, VerticalConstraint } from "@opencrease/model";
import { constraintsOf } from "../../../canvas/constraints";
import { isAbsolutelyPositioned } from "../../../canvas/selection-logic";
import { ALIGN_ACTIONS, DISTRIBUTE_ACTIONS, arrangeLabel, arrangeSelection, canArrange } from "../../../canvas/arrange-actions";
import { IconButton, MIXED, NumberField, Section, SelectField, useMenu } from "../../../ui";
import { applyStyles, common, parentOf, styleValue, updateNodes, useCtx } from "./common";

export function ArrangeControls() {
  const [menu, openMenu] = useMenu();
  return <>
    <IconButton icon="alignCenter" outlined label="Align and distribute" onClick={(e) => openMenu(
      [...ALIGN_ACTIONS, ...DISTRIBUTE_ACTIONS].map((action) => ({ label: arrangeLabel(action), disabled: !canArrange(action), onSelect: () => arrangeSelection(action) })),
      e.currentTarget,
    )} />
    {menu}
  </>;
}

export function ConstraintsSection() {
  const ctx = useCtx();
  const { nodes, doc } = ctx;
  if (!nodes.every((n) => isAbsolutelyPositioned(doc, n) && parentOf(doc, n)?.type !== "Root")) return null;
  const h = common(nodes, (n) => constraintsOf(n).horizontal);
  const v = common(nodes, (n) => constraintsOf(n).vertical);
  const set = (axis: "horizontal" | "vertical", value: HorizontalConstraint | VerticalConstraint) =>
    updateNodes(ctx, "Change constraints", (node) => node.locked ? null : { constraints: { ...constraintsOf(node), [axis]: value } });
  const hp = h === "left" ? [true, false] : h === "right" ? [false, true] : h === "stretch" ? [true, true] : [false, false];
  const vp = v === "top" ? [true, false] : v === "bottom" ? [false, true] : v === "stretch" ? [true, true] : [false, false];
  return <Section title="Constraints">
    <div className="of-row" style={{ gap: 12 }}>
      <div className="of-constraints-widget" aria-label="Constraint anchors">
        <button aria-label="Pin left" aria-pressed={hp[0]} className="left" onClick={() => set("horizontal", hp[0] ? hp[1] ? "right" : "center" : hp[1] ? "stretch" : "left")} />
        <button aria-label="Pin right" aria-pressed={hp[1]} className="right" onClick={() => set("horizontal", hp[1] ? hp[0] ? "left" : "center" : hp[0] ? "stretch" : "right")} />
        <button aria-label="Pin top" aria-pressed={vp[0]} className="top" onClick={() => set("vertical", vp[0] ? vp[1] ? "bottom" : "center" : vp[1] ? "stretch" : "top")} />
        <button aria-label="Pin bottom" aria-pressed={vp[1]} className="bottom" onClick={() => set("vertical", vp[1] ? vp[0] ? "top" : "center" : vp[0] ? "stretch" : "bottom")} />
        <span />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
        <SelectField ariaLabel="Horizontal constraint" value={h === MIXED ? "" : h} options={(["left", "right", "center", "scale", "stretch"] as HorizontalConstraint[]).map((value) => ({ value, label: value === "stretch" ? "Left and right" : value[0].toUpperCase() + value.slice(1) }))} onChange={(x) => set("horizontal", x)} />
        <SelectField ariaLabel="Vertical constraint" value={v === MIXED ? "" : v} options={(["top", "bottom", "center", "scale", "stretch"] as VerticalConstraint[]).map((value) => ({ value, label: value === "stretch" ? "Top and bottom" : value[0].toUpperCase() + value.slice(1) }))} onChange={(x) => set("vertical", x)} />
      </div>
    </div>
  </Section>;
}

function GridField({ property, label, placeholder }: { property: string; label: string; placeholder: string }) {
  const ctx = useCtx();
  const raw = styleValue(ctx.nodes, property);
  const value = raw === MIXED ? "" : String(raw ?? "");
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next && !CSS.supports(property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), next)) { setDraft(value); return; }
    if (next !== value) applyStyles(ctx, { [property]: next || null }, `Change ${label.toLowerCase()}`);
  };
  return <label className="of-grid-field">
    <span>{label}</span>
    <input className="of-field" aria-label={label} placeholder={raw === MIXED ? "Mixed" : placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { commit(); e.currentTarget.blur(); } if (e.key === "Escape") { setDraft(value); e.currentTarget.blur(); } }} />
  </label>;
}

export function GridSection() {
  const ctx = useCtx();
  const containers = ctx.nodes.every((n) => n.type === "Frame");
  const grid = containers && ctx.nodes.every((n) => n.styles.display === "grid");
  const children = ctx.nodes.every((n) => parentOf(ctx.doc, n)?.styles.display === "grid");
  return <>
    {containers ? grid ? <Section title="Grid" actions={<IconButton icon="minus" size="xs" label="Remove grid layout" onClick={() => applyStyles(ctx, { display: "block" }, "Remove grid layout")} />}>
      <GridField property="gridTemplateColumns" label="Columns" placeholder="repeat(2, minmax(0, 1fr))" />
      <GridField property="gridTemplateRows" label="Rows" placeholder="auto" />
      <div className="of-row">
        <NumberField label="X gap" ariaLabel="Column gap" value={styleValue(ctx.nodes, "columnGap") ?? styleValue(ctx.nodes, "gap")} min={0} onCommit={(x, key) => applyStyles(ctx, { columnGap: x }, "Change grid gap", key)} />
        <NumberField label="Y gap" ariaLabel="Row gap" value={styleValue(ctx.nodes, "rowGap") ?? styleValue(ctx.nodes, "gap")} min={0} onCommit={(x, key) => applyStyles(ctx, { rowGap: x }, "Change grid gap", key)} />
      </div>
    </Section> : <Section title="Grid" collapsed actions={<IconButton icon="plus" size="xs" label="Add grid layout" onClick={() => applyStyles(ctx, { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }, "Add grid layout")} />} /> : null}
    {children ? <Section title="Grid cell"><GridField property="gridColumn" label="Column" placeholder="auto" /><GridField property="gridRow" label="Row" placeholder="auto" /></Section> : null}
  </>;
}
