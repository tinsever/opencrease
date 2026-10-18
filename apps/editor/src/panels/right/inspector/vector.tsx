// Vector inspector: fill and stroke for SVG layers, shape parameters, boolean and path operations,
// image vectorising, and the path edit mode panel (point position and type).
import { useContext, useLayoutEffect, useState, type ReactNode } from "react";
import type { FoldDocument, NodeId, OFNode, Tx } from "@opencrease/model";
import { getOpenFile } from "../../../state/workspace";
import { useDoc } from "../../../state/hooks";
import { MIXED, NumberField, Section, Segmented, SelectField, Tooltip, IconButton, type Mixed } from "../../../ui";
import { getWorldRect } from "../../../canvas/registry";
import { containingBlockOrigin } from "../../../canvas/insert";
import { useStore } from "../../../canvas/store";
import { ColorField } from "../color/ColorField";
import { common, Ctx, useCtx, type InspectorCtx } from "./common";
import { PAINT, paintTargets, readPaint, writePaint, type PaintKey } from "../../../vector/paint";
import { regenerateShapeAttrs, shapeParams, editablePathOf, type ShapeParams } from "../../../vector/shapes";
import { booleanOp, isVectorOperand, runFlattenOp, VectorOpError, type BooleanOp, type FlattenOp, type OpsEnv } from "../../../vector/ops";
import { vectorUi, type PathEdit } from "../../../vector/state";
import {
  canEditPath, editModel, enterPathEdit, pointCount, pointPosition, setSelectedPointPosition, setSelectedPointType, typeOf, validRefs,
} from "../../../vector/edit";
import { ExcludeIcon, IntersectIcon, PathIcon, SubtractIcon, UnionIcon } from "../../../vector/icons";
import type { PointType, Pt } from "../../../vector/path";
import { vectorizeImage, type TraceDetail } from "../../../vector/vectorize";
import { setSelection } from "../../../state/workspace";
import "../../../vector/vector.css";
import { svgWorldMatrix } from "../../../vector/dom";

// ------------------------------------------------------------------ helpers

function opsEnv(doc: FoldDocument): OpsEnv {
  return { doc, measure: (id) => getWorldRect(id), origin: (id) => containingBlockOrigin(id), matrix: svgWorldMatrix };
}

function runOp(fileId: string, label: string, fn: (env: OpsEnv, tx: Tx) => { created: NodeId[] }): string | null {
  const file = getOpenFile(fileId);
  if (!file) return null;
  try {
    const res = file.store.transact(label, (tx) => fn(opsEnv(file.store.doc), tx));
    if (res.created.length) setSelection(fileId, res.created);
    return null;
  } catch (e) {
    if (e instanceof VectorOpError) return e.message;
    console.warn(label, e);
    return `${label} failed.`;
  }
}

function isVectorNode(n: OFNode): boolean {
  return n.type === "SVG" || n.type === "SVGElement";
}

/** Inspector should show vector paint instead of the box fill. */
export function isVectorSelection(nodes: OFNode[]): boolean {
  return nodes.length > 0 && nodes.every(isVectorNode);
}

function paintValueOf(doc: FoldDocument, targets: OFNode[], key: PaintKey): string | Mixed | undefined {
  if (targets.length === 0) return undefined;
  return common(targets, (n) => readPaint(doc, n, key) ?? "");
}

function writeAll(fileId: string, targets: OFNode[], key: PaintKey, value: string | null, label: string, mergeKey?: string) {
  const file = getOpenFile(fileId);
  if (!file || targets.length === 0) return;
  file.store.transact(
    label,
    (tx) => {
      for (const t of targets) writePaint(tx, t.id, key, value);
    },
    { mergeKey },
  );
}

function NoneChip({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <button type="button" className="of-fill-chip of-vector-none" onClick={onAdd} aria-label={`Add ${label.toLowerCase()}`}>
      <span className="of-vector-none-swatch" />
      <span className="ftext sans">None</span>
    </button>
  );
}

// ------------------------------------------------------------------ fill and stroke

export function FillStrokeSection({ ctx: given }: { ctx?: Pick<InspectorCtx, "fileId" | "doc" | "ids"> }) {
  const inspector = useOptionalCtx();
  const ctx = given ?? inspector;
  if (!ctx) return null;
  const { doc, fileId } = ctx;
  const targets = paintTargets(doc, ctx.ids);
  if (targets.length === 0) return null;
  const fill = paintValueOf(doc, targets, PAINT.fill);
  const stroke = paintValueOf(doc, targets, PAINT.stroke);
  const width = paintValueOf(doc, targets, PAINT.strokeWidth);
  const cap = paintValueOf(doc, targets, PAINT.strokeLinecap);
  const join = paintValueOf(doc, targets, PAINT.strokeLinejoin);
  const dash = paintValueOf(doc, targets, PAINT.strokeDasharray);
  // SVG's initial fill is black and its initial stroke none
  const fillValue = fill === MIXED ? MIXED : fill || "#000000";
  const strokeValue = stroke === MIXED ? MIXED : stroke || "none";
  const hasFill = fillValue === MIXED || fillValue !== "none";
  const hasStroke = strokeValue === MIXED || strokeValue !== "none";
  const set = (key: PaintKey, label: string) => (v: string | null, mk?: string) => writeAll(fileId, targets, key, v, label, mk);
  return (
    <Section title="Fill and stroke">
      <div className="of-fill-row">
        {!hasFill ? (
          <NoneChip label="Fill" onAdd={() => set(PAINT.fill, "Add fill")("#D9D9D9")} />
        ) : fillValue === MIXED ? (
          <MixedRow label="Mixed fills" onReset={() => set(PAINT.fill, "Fill")("#000000")} />
        ) : (
          <ColorField value={fillValue} doc={doc} fileId={fileId} onChange={(v, mk) => set(PAINT.fill, "Fill")(v, mk)} />
        )}
        {hasFill ? <IconButton icon="minus" iconSize={12} size="sm" label="Remove fill" onClick={() => set(PAINT.fill, "Remove fill")("none")} /> : <span className="of-vector-slot" />}
      </div>
      <div className="of-fill-row">
        {!hasStroke ? (
          <NoneChip label="Stroke" onAdd={() => {
            const file = getOpenFile(fileId);
            file?.store.transact("Add stroke", (tx) => {
              for (const t of targets) {
                writePaint(tx, t.id, PAINT.stroke, "#000000");
                if (!readPaint(tx.doc, tx.doc.nodes[t.id], PAINT.strokeWidth)) writePaint(tx, t.id, PAINT.strokeWidth, "1");
              }
            });
          }} />
        ) : strokeValue === MIXED ? (
          <MixedRow label="Mixed strokes" onReset={() => set(PAINT.stroke, "Stroke")("#000000")} />
        ) : (
          <ColorField value={strokeValue} doc={doc} fileId={fileId} onChange={(v, mk) => set(PAINT.stroke, "Stroke")(v, mk)} />
        )}
        {hasStroke ? (
          <NumberField
            icon="lineHeight"
            ariaLabel="Stroke width"
            style={{ flex: "0 0 72px" }}
            value={width === MIXED ? MIXED : Number(width || 1)}
            min={0}
            step={0.5}
            onCommit={(v, mk) => set(PAINT.strokeWidth, "Stroke width")(v === null ? null : String(v), mk)}
          />
        ) : (
          <span className="of-vector-slot" />
        )}
      </div>
      {hasStroke ? (
        <div className="of-row">
          <SelectField
            ariaLabel="Stroke cap"
            value={cap === MIXED ? "" : ((cap || "butt") as "butt")}
            placeholder="Mixed"
            options={[
              { value: "butt", label: "Butt cap" },
              { value: "round", label: "Round cap" },
              { value: "square", label: "Square cap" },
            ]}
            onChange={(v) => set(PAINT.strokeLinecap, "Stroke cap")(v)}
          />
          <SelectField
            ariaLabel="Stroke join"
            value={join === MIXED ? "" : ((join || "miter") as "miter")}
            placeholder="Mixed"
            options={[
              { value: "miter", label: "Miter join" },
              { value: "round", label: "Round join" },
              { value: "bevel", label: "Bevel join" },
            ]}
            onChange={(v) => set(PAINT.strokeLinejoin, "Stroke join")(v)}
          />
        </div>
      ) : null}
      {hasStroke ? (
        <div className="of-row">
          <DashField value={dash === MIXED ? MIXED : (dash ?? "")} onCommit={(v) => set(PAINT.strokeDasharray, "Dashes")(v ?? "none")} />
          <span className="of-row-slot" />
        </div>
      ) : null}
    </Section>
  );
}

function MixedRow({ label, onReset }: { label: string; onReset: () => void }) {
  return (
    <div className="of-row" style={{ flex: 1 }}>
      <span className="of-hint" style={{ flex: 1 }}>{label}</span>
      <button className="of-btn sm" onClick={onReset}>Set all</button>
    </div>
  );
}

function DashField({ value, onCommit }: { value: string | Mixed; onCommit: (v: string | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value === MIXED ? "" : value === "none" ? "" : value;
  const commit = (t: string) => {
    setDraft(null);
    const v = t.trim().replace(/\s*,\s*/g, " ");
    if (v === shown) return;
    if (v === "" || v === "0") onCommit(null);
    else if (/^[\d.\s]+$/.test(v)) onCommit(v);
  };
  return (
    <label className={`of-field${value === MIXED ? " mixed" : ""}`} title="Dash and gap lengths, for example 4 2">
      <span className="of-field-label" style={{ fontFamily: "var(--of-font-sans)" }}>Dashes</span>
      <input
        value={draft ?? shown}
        placeholder={value === MIXED ? "Mixed" : "None"}
        aria-label="Stroke dashes"
        spellCheck={false}
        onFocus={(e) => setDraft(e.target.value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => draft !== null && commit(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}

function useOptionalCtx(): InspectorCtx | null {
  return useContext(Ctx);
}

// ------------------------------------------------------------------ shape parameters and operations

function singleShape(doc: FoldDocument, nodes: OFNode[]): OFNode | undefined {
  if (nodes.length !== 1) return undefined;
  return editablePathOf(doc, nodes[0].id);
}

function ShapeParamsRows({ fileId, el, params }: { fileId: string; el: OFNode; params: ShapeParams }) {
  const update = (label: string, attrs: Record<string, string> | null, mk?: string) => {
    if (!attrs) return;
    getOpenFile(fileId)?.store.transact(label, (tx) => tx.updateNode(el.id, { attrs }), { mergeKey: mk });
  };
  if (params.kind === "rect") {
    return (
      <div className="of-row">
        <NumberField
          icon="radius"
          ariaLabel="Corner radius"
          value={params.radius ?? 0}
          min={0}
          onCommit={(v, mk) => {
            const attrs = { ...(el.attrs ?? {}) };
            const n = Number(v ?? 0) || 0;
            if (n > 0) attrs.rx = String(n);
            else delete attrs.rx;
            delete attrs.ry;
            update("Corner radius", attrs, mk);
          }}
        />
        <span className="of-row-slot" />
      </div>
    );
  }
  if (params.kind === "polygon") {
    return (
      <div className="of-row">
        <NumberField label="Sides" ariaLabel="Polygon sides" value={params.sides ?? 3} min={3} max={60} step={1} onCommit={(v, mk) => update("Polygon sides", regenerateShapeAttrs(el, { sides: Number(v) || 3 }), mk)} />
        <span className="of-row-slot" />
      </div>
    );
  }
  if (params.kind === "star") {
    return (
      <div className="of-row">
        <NumberField label="Points" ariaLabel="Star points" value={params.points ?? 5} min={3} max={60} step={1} onCommit={(v, mk) => update("Star points", regenerateShapeAttrs(el, { points: Number(v) || 5 }), mk)} />
        <NumberField
          label="Inner"
          ariaLabel="Star inner radius"
          value={Math.round((params.ratio ?? 0.382) * 100)}
          suffix="%"
          min={1}
          max={100}
          onCommit={(v, mk) => update("Star inner radius", regenerateShapeAttrs(el, { ratio: (Number(v) || 38) / 100 }), mk)}
        />
      </div>
    );
  }
  return null;
}

const BOOLEANS: Array<{ op: BooleanOp; label: string; icon: ReactNode }> = [
  { op: "union", label: "Union", icon: <UnionIcon color="var(--of-ink-2)" /> },
  { op: "subtract", label: "Subtract", icon: <SubtractIcon color="var(--of-ink-2)" /> },
  { op: "intersect", label: "Intersect", icon: <IntersectIcon color="var(--of-ink-2)" /> },
  { op: "exclude", label: "Exclude", icon: <ExcludeIcon color="var(--of-ink-2)" /> },
];

/** Shape section: parameters of a single shape, boolean operations, outline stroke, flatten, convert to path. */
export function ShapeSection({ fileId, doc, nodes, editing }: { fileId: string; doc: FoldDocument; nodes: OFNode[]; editing?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const operands = nodes.filter(isVectorOperand);
  const vectorish = nodes.some(isVectorNode);
  if (!vectorish || operands.length !== nodes.length) return null;
  const ids = nodes.map((n) => n.id);
  const el = singleShape(doc, nodes);
  const params = el ? shapeParams(el) : null;
  const canBool = operands.length >= 2 && !editing;
  const targets = paintTargets(doc, ids);
  const stroked = targets.some((t) => {
    const s = readPaint(doc, t, PAINT.stroke);
    return !!s && s !== "none";
  });
  const primitives = targets.some((t) => t.tag !== "path");
  const doOp = (label: string, fn: Parameters<typeof runOp>[2]) => setError(runOp(fileId, label, fn));
  const flat = (op: FlattenOp, label: string) => doOp(label, (env, tx) => runFlattenOp(env, tx, ids, op));
  return (
    <Section title="Shape">
      {params && el ? <ShapeParamsRows fileId={fileId} el={el} params={params} /> : null}
      <div className="of-vector-bools" role="group" aria-label="Boolean operations">
        {BOOLEANS.map((b) => {
          const btn = (
            <button
              type="button"
              className="of-vector-bool"
              aria-label={b.label}
              disabled={!canBool}
              onClick={() => doOp(b.label, (env, tx) => booleanOp(env, tx, ids, b.op))}
            >
              {b.icon}
            </button>
          );
          return (
            <Tooltip key={b.op} label={canBool ? b.label : `${b.label}: select two or more vector layers`}>
              {btn}
            </Tooltip>
          );
        })}
      </div>
      <div className="of-row">
        <button type="button" className="of-vector-action" disabled={!stroked} title={stroked ? undefined : "No stroke to outline"} onClick={() => flat("outline-stroke", "Outline stroke")}>
          Outline stroke
        </button>
        <button type="button" className="of-vector-action" onClick={() => flat("flatten", "Flatten")}>
          Flatten
        </button>
      </div>
      {primitives && !editing ? (
        <div className="of-row">
          <button type="button" className="of-vector-action" onClick={() => flat("convert-to-path", "Convert to path")}>
            Convert to path
          </button>
          {el && canEditPath(doc, nodes[0].id) ? (
            <button type="button" className="of-vector-action" onClick={() => enterPathEdit(fileId, nodes[0].id)}>
              Edit points
            </button>
          ) : null}
        </div>
      ) : !editing && el && canEditPath(doc, nodes[0].id) ? (
        <div className="of-row">
          <button type="button" className="of-vector-action" onClick={() => enterPathEdit(fileId, nodes[0].id)}>
            Edit points
          </button>
        </div>
      ) : null}
      {error ? <div className="of-hint" role="status" style={{ color: "var(--of-danger)" }}>{error}</div> : null}
    </Section>
  );
}

/** Boolean operations for a mixed selection of rectangles and vectors. */
export function VectorSections() {
  const ctx = useCtx();
  const { fileId, doc, nodes } = ctx;
  if (nodes.length === 1 && nodes[0].type === "Image") return <VectoriseSection fileId={fileId} imageId={nodes[0].id} />;
  return <ShapeSection fileId={fileId} doc={doc} nodes={nodes} />;
}

// ------------------------------------------------------------------ vectorise

function VectoriseSection({ fileId, imageId }: { fileId: string; imageId: NodeId }) {
  const [detail, setDetail] = useState<TraceDetail>("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Section title="Vectorise">
      <div className="of-row">
        <SelectField
          ariaLabel="Tracing detail"
          value={detail}
          options={[
            { value: "low", label: "Few colours" },
            { value: "medium", label: "Balanced" },
            { value: "high", label: "Detailed" },
          ]}
          onChange={setDetail}
        />
        <button
          type="button"
          className="of-vector-action"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            vectorizeImage(fileId, imageId, detail)
              .then((id) => setSelection(fileId, [id]))
              .catch((e: unknown) => setError(e instanceof Error ? e.message : "Tracing failed."))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Tracing" : "Trace to vector"}
        </button>
      </div>
      {error ? <div className="of-hint" role="status" style={{ color: "var(--of-danger)" }}>{error}</div> : <div className="of-hint">Replaces the image with editable SVG paths.</div>}
    </Section>
  );
}

// ------------------------------------------------------------------ path edit mode panel

const TYPE_OPTIONS: Array<{ value: PointType; label: string; title: string }> = [
  { value: "corner", label: "Corner", title: "Corner: no handles" },
  { value: "mirrored", label: "Mirror", title: "Mirrored: handles share angle and length" },
  { value: "asymmetric", label: "Asym", title: "Asymmetric: handles share angle, lengths differ" },
  { value: "disconnected", label: "Free", title: "Disconnected: handles move independently" },
];

function Keys() {
  const rows: Array<[string, string]> = [
    ["Break handles", "⌥ drag"],
    ["Add point", "Double-click"],
    ["Delete point", "⌫"],
    ["Snap ½ px", "⇧⌘'"],
    ["Exit path", "Esc"],
  ];
  return (
    <div className="of-section" style={{ gap: 6 }}>
      <div className="of-section-title">Keys</div>
      {rows.map(([label, key]) => (
        <div key={label} className="of-vector-key">
          <span>{label}</span>
          <span className="of-kbd">{key}</span>
        </div>
      ))}
    </div>
  );
}

export function PathEditPanel({ fileId }: { fileId: string }) {
  const doc = useDoc(fileId);
  const edit = useStore(vectorUi, (s) => s.edit) as PathEdit | null;
  const [positions, setPositions] = useState<Pt[]>([]);
  // Read live SVG matrices after React applies the new path/viewBox to the canvas DOM.
  useLayoutEffect(() => {
    if (!doc || !edit || edit.fileId !== fileId) return;
    const refs = validRefs(editModel(doc, edit.pathId), edit.selected);
    const next = refs.map((r) => pointPosition(doc, edit, r)).filter((p): p is Pt => !!p);
    setPositions((prev) => prev.length === next.length && prev.every((p, i) => Math.abs(p.x - next[i].x) < 0.0001 && Math.abs(p.y - next[i].y) < 0.0001) ? prev : next);
  }, [doc, edit, fileId]);
  if (!doc || !edit || edit.fileId !== fileId) return null;
  const svg = doc.nodes[edit.svgId];
  const pathNode = doc.nodes[edit.pathId];
  if (!svg || !pathNode) return null;
  const model = editModel(doc, edit.pathId);
  const refs = validRefs(model, edit.selected);
  const total = pointCount(doc, edit.pathId);
  const pos = positions[0] ?? null;
  const same = (k: "x" | "y") => positions.every((p) => Math.abs(p[k] - positions[0][k]) < 0.005);
  const types = new Set(refs.map((r) => typeOf(edit, model, r)));
  const type = types.size === 1 ? [...types][0] : null;
  const ctx = { fileId, doc, ids: [edit.pathId] };
  const name = svg.children.length > 1 ? pathNode.name || svg.name : svg.name;
  return (
    <>
      <div className="of-sel-header" style={{ paddingBottom: 12, borderBottom: "1px solid var(--of-hairline)" }}>
        <PathIcon color="var(--of-ink)" />
        <div className="titles">
          <div className="t1">{name}</div>
          <div className="t2">
            Path, {total} {total === 1 ? "point" : "points"}, {refs.length} selected
          </div>
        </div>
      </div>
      <div className="of-inspector">
        <Section title="Point">
          <div className="of-row">
            <NumberField
              label="X"
              ariaLabel="Point X"
              disabled={!refs.length}
              digits={2}
              value={!pos ? undefined : !same("x") ? MIXED : Math.round(pos.x * 100) / 100}
              onCommit={(v, mk) => typeof v === "number" && setSelectedPointPosition("x", v, mk)}
            />
            <NumberField
              label="Y"
              ariaLabel="Point Y"
              disabled={!refs.length}
              digits={2}
              value={!pos ? undefined : !same("y") ? MIXED : Math.round(pos.y * 100) / 100}
              onCommit={(v, mk) => typeof v === "number" && setSelectedPointPosition("y", v, mk)}
            />
          </div>
          <Segmented<PointType>
            ariaLabel="Point type"
            className={refs.length ? undefined : "of-vector-disabled"}
            options={TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label, title: o.title }))}
            value={refs.length ? type : null}
            onChange={(t) => refs.length && setSelectedPointType(t)}
          />
          {!refs.length ? <div className="of-hint">Select a point to move it or change its type. Drag on empty space to select several.</div> : null}
        </Section>
        <FillStrokeSection ctx={ctx} />
        <ShapeSection fileId={fileId} doc={doc} nodes={[svg]} editing />
        <Keys />
        <div style={{ height: 24 }} />
      </div>
    </>
  );
}
