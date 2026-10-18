// Component sections of the inspector (SPEC §4.9, artboard "Editor — Component instance"):
// instance header with props, overrides and detach; main component prop definitions and variant values;
// component sets; layers inside instances; and the code component mapping.
import type { CSSProperties, ReactNode } from "react";
import { nodeToJsx } from "@opencrease/css";
import {
  allProps, codeRefOf, componentLabel, componentSetOf, componentStore, hasOverrides, instanceOwner, instancePropStates,
  listComponents, mainComponentOf, overrideCount, propsBoundTo, setComponentDef, setComponentSetDef, variantsOf,
  type CodeRef, type ComponentPropDef, type ComponentPropType, type FoldDocument, type NodeId, type OFNode, type PropState,
} from "@opencrease/model";
import {
  addVariantOf, detachSelection, goToMainComponent, removeComponentDef, resetOverridesOf, selectInstancesOf, selectOwnerInstance,
  setPropValue,
} from "../../../state/component-actions";
import { getOpenFile, setSelection } from "../../../state/workspace";
import { Button, Icon, IconButton, Section, SelectField, Toggle, useMenu, type IconName, type MenuItem } from "../../../ui";
import { tryAction } from "../../../ui/Notice";
import { useCtx } from "./common";
import "../../components.css";

// ------------------------------------------------------------------ helpers

const TYPE_LABEL: Record<ComponentPropType, string> = { text: "Text", boolean: "Boolean", enum: "Variant", "instance-swap": "Instance swap", slot: "Slot" };
const TYPE_ICON: Record<ComponentPropType, IconName> = { text: "text", boolean: "eye", enum: "componentSet", "instance-swap": "component", slot: "frame" };

function transact(fileId: string, label: string, fn: Parameters<NonNullable<ReturnType<typeof getOpenFile>>["store"]["transact"]>[1]) {
  const file = getOpenFile(fileId);
  if (file) tryAction(() => file.store.transact(label, fn));
}

/** Text input that commits on Enter or blur and resets when the value changes elsewhere. */
function TextInput({ value, onCommit, placeholder, mono, ariaLabel, style }: { value: string; onCommit: (v: string) => void; placeholder?: string; mono?: boolean; ariaLabel: string; style?: CSSProperties }) {
  return (
    <input
      key={value}
      className="of-textfield"
      aria-label={ariaLabel}
      defaultValue={value}
      placeholder={placeholder}
      style={{ flex: 1, minWidth: 0, fontFamily: mono ? "var(--of-font-mono)" : undefined, ...style }}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          (e.target as HTMLInputElement).value = value;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function CompCard({ icon, title, sub, action }: { icon: IconName; title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="of-comp-card">
      <span className="of-comp-card-icon"><Icon name={icon} size={14} /></span>
      <div className="of-comp-card-text">
        <div className="t1">{title}</div>
        {sub ? <div className="t2">{sub}</div> : null}
      </div>
      {action}
    </div>
  );
}

function PropLabel({ def, overridden, onReset }: { def: ComponentPropDef; overridden?: boolean; onReset?: () => void }) {
  return (
    <span className={`of-prop-label${overridden ? " overridden" : ""}`} title={`${def.name} (${TYPE_LABEL[def.type]})${overridden ? ". Set on this instance, click to reset." : ""}`} onClick={overridden ? onReset : undefined}>
      {overridden ? <span className="of-override-dot" /> : null}
      <span className="name">{def.name}</span>
    </span>
  );
}

/** Subtitle for the inspector header. */
export function componentSubtitle(doc: FoldDocument, node: OFNode): string | null {
  if (node.componentSet) {
    const n = variantsOf(doc.nodes, node).length;
    return `Component set with ${n} ${n === 1 ? "variant" : "variants"}`;
  }
  if (node.component) {
    const set = componentSetOf(doc.nodes, node);
    return set ? `Variant of ${set.name}` : "Main component";
  }
  if (node.instance) {
    const main = mainComponentOf(doc, node);
    if (!main) return "Instance, main component missing";
    return `Instance of ${componentLabel(componentStore(doc, node.instance.library)!, main)}`;
  }
  if (node.source !== undefined) {
    const owner = instanceOwner(doc, node.id);
    return owner ? `Layer in ${owner.name}` : null;
  }
  return null;
}

// ------------------------------------------------------------------ entry

/** All component sections for the current single selection. */
export function ComponentSections() {
  const { nodes, doc } = useCtx();
  if (nodes.length !== 1) return null;
  const node = nodes[0];
  if (node.instance) return <><InstanceSection node={node} /><CodeSection node={node} /></>;
  if (node.componentSet) return <><SetSection node={node} /><CodeSection node={node} /></>;
  if (node.component) return <><ComponentSection node={node} /><CodeSection node={node} /></>;
  if (node.source !== undefined) return <LinkedLayerSection node={node} />;
  if (propsBoundTo(doc, node).length) return <BoundLayerSection node={node} />;
  return null;
}

// ------------------------------------------------------------------ instance

function PropControl({ instance, state, doc, fileId }: { instance: OFNode; state: PropState; doc: FoldDocument; fileId: string }) {
  const { def, value } = state;
  const set = (v: string | boolean | null) => setPropValue(instance.id, def.name, v);
  switch (def.type) {
    case "enum":
      return <SelectField ariaLabel={def.name} value={String(value ?? "")} options={(def.options ?? []).map((o) => ({ value: o, label: o }))} onChange={(v) => set(v)} />;
    case "boolean":
      return (
        <div className="of-row" style={{ flex: 1, justifyContent: "flex-end", height: 28 }}>
          <Toggle label={def.name} on={value === true} onChange={(v) => set(v)} />
        </div>
      );
    case "text":
      return <TextInput ariaLabel={def.name} value={String(value ?? "")} onCommit={(v) => set(v)} />;
    case "instance-swap": {
      const options = listComponents(doc).filter((c) => (c.library ?? undefined) === (instance.instance?.library ?? undefined)).map((c) => ({ value: c.id, label: c.label }));
      return <SelectField ariaLabel={def.name} value={String(value ?? "")} options={options} onChange={(v) => set(v)} />;
    }
    case "slot": {
      const main = mainComponentOf(doc, instance);
      const slot = instance.children.map((c) => doc.nodes[c]).find((c) => c?.source === def.target);
      const n = slot?.children.length ?? 0;
      return (
        <button className="of-slot-chip" disabled={!slot || !main} onClick={() => slot && setSelection(fileId, [slot.id])} title="Select the slot frame, then add or drop layers into it">
          <Icon name="frame" size={12} />
          {n ? `${n} ${n === 1 ? "layer" : "layers"}` : "Empty slot"}
        </button>
      );
    }
  }
}

function InstanceSection({ node }: { node: OFNode }) {
  const { doc, fileId } = useCtx();
  const [menu, openMenu] = useMenu();
  const main = mainComponentOf(doc, node);
  const nested = node.source !== undefined;
  const store = componentStore(doc, node.instance!.library);
  const lib = node.instance!.library ? doc.libraries?.[node.instance!.library] : undefined;
  const states = main ? instancePropStates(doc, node) : [];
  const count = nested ? (hasOverrides(doc, node) ? Object.keys(instanceOwner(doc, node.id)?.instance?.overrides ?? {}).filter((k) => k === node.source || k.startsWith(`${node.source}/`)).length : 0) : overrideCount(node);
  const owner = nested ? instanceOwner(doc, node.id) : undefined;

  const more: MenuItem[] = [
    { label: "Go to main component", disabled: !main, onSelect: () => void goToMainComponent(node.id) },
    ...(owner ? [{ label: `Select ${owner.name}`, onSelect: () => selectOwnerInstance(node.id) }] : []),
    { label: "Reset overrides", disabled: count === 0, onSelect: () => resetOverridesOf([node.id]) },
    ...(!nested ? [{ type: "separator" as const }, { label: "Detach instance", shortcut: "⌥⌘B", onSelect: () => detachSelection([node.id]) }] : []),
  ];

  return (
    <Section
      title={nested ? "Nested instance" : "Instance"}
      actions={<IconButton icon="more" iconSize={12} size="xs" label="Instance actions" onClick={(e) => openMenu(more, e.currentTarget, { minWidth: 200 })} />}
    >
      <CompCard
        icon="component"
        title={main && store ? componentLabel(store, main) : "Missing component"}
        sub={main ? (lib ? `From ${lib.name}` : "Local component") : "The main component was deleted. Detach to keep the layers."}
        action={main ? (
          <button className="of-comp-link" onClick={() => void goToMainComponent(node.id)} title="Go to main component">
            <Icon name="goTo" size={12} />
          </button>
        ) : null}
      />
      {states.length ? (
        <div className="of-prop-list">
          {states.map((s) => (
            <div className="of-prop-row" key={s.def.name}>
              <PropLabel def={s.def} overridden={s.overridden && s.def.type !== "enum"} onReset={() => setPropValue(node.id, s.def.name, null)} />
              <PropControl instance={node} state={s} doc={doc} fileId={fileId} />
            </div>
          ))}
        </div>
      ) : main ? (
        <span className="of-hint">This component has no properties. Add them on the main component.</span>
      ) : null}
      <div className="of-override-row">
        {count ? <span className="of-override-dot" /> : null}
        <span style={{ flex: 1 }}>{count ? `${count} ${count === 1 ? "override" : "overrides"}${nested && owner ? ` in ${owner.name}` : ""}` : "No overrides"}</span>
        {count ? <Button size="sm" onClick={() => resetOverridesOf([node.id])}>Reset</Button> : null}
        {!nested ? <Button size="sm" onClick={() => detachSelection([node.id])} title="Turn the instance into ordinary layers">Detach</Button> : null}
      </div>
      {menu}
    </Section>
  );
}

// ------------------------------------------------------------------ main component

function eligibleLayers(doc: FoldDocument, main: OFNode, type: ComponentPropType): OFNode[] {
  const out: OFNode[] = [];
  const walk = (id: NodeId) => {
    for (const c of doc.nodes[id]?.children ?? []) {
      const n = doc.nodes[c];
      if (!n || n.source !== undefined) continue;
      const ok =
        type === "text" ? n.type === "Text"
        : type === "boolean" ? true
        : type === "instance-swap" ? !!n.instance
        : type === "slot" ? n.type === "Frame" && !n.instance && !n.component
        : false;
      if (ok) out.push(n);
      if (!n.instance) walk(n.id);
    }
  };
  walk(main.id);
  return out;
}

function propNameFor(layer: OFNode, type: ComponentPropType, taken: Set<string>): string {
  const base = type === "slot" ? "content" : type === "boolean" ? `show${layer.name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).map((w) => w[0]?.toUpperCase() + w.slice(1)).join("")}` : layer.name;
  let camel = base.replace(/[^A-Za-z0-9]+(.)?/g, (_, ch: string | undefined) => (ch ? ch.toUpperCase() : "")).replace(/^[A-Z]/, (c) => c.toLowerCase()) || "prop";
  if (/^\d/.test(camel)) camel = `prop${camel}`;
  let name = camel.slice(0, 32);
  for (let i = 2; taken.has(name); i++) name = `${camel}${i}`;
  return name;
}

function ComponentSection({ node }: { node: OFNode }) {
  const { doc, fileId } = useCtx();
  const [menu, openMenu] = useMenu();
  const def = node.component!;
  const set = componentSetOf(doc.nodes, node);
  const enumProps = allProps(doc.nodes, node).filter((p) => p.type === "enum");
  const instances = Object.values(doc.nodes).filter((n) => n.instance && n.source === undefined && !n.instance.library && n.instance.componentId === node.id).length;
  const writeProps = (props: ComponentPropDef[], label = "Edit component properties") => transact(fileId, label, (tx) => setComponentDef(tx, node.id, { props }));

  const addProp = (type: ComponentPropType) => {
    const layers = eligibleLayers(doc, node, type);
    const bound = new Set(def.props.filter((p) => p.type === type).map((p) => p.target));
    const layer = layers.find((l) => !bound.has(l.id)) ?? layers[0];
    if (!layer) return;
    const taken = new Set(allProps(doc.nodes, node).map((p) => p.name));
    const p: ComponentPropDef = { name: propNameFor(layer, type, taken), type, target: layer.id };
    if (type === "boolean") p.default = layer.visible;
    if (type === "text") p.default = layer.text ?? "";
    writeProps([...def.props, p], "Add property");
  };

  const addMenu: MenuItem[] = (["text", "boolean", "instance-swap", "slot"] as const).map((t) => {
    const layers = eligibleLayers(doc, node, t);
    return {
      label: TYPE_LABEL[t],
      icon: <Icon name={TYPE_ICON[t]} size={12} />,
      disabled: layers.length === 0,
      shortcut: layers.length === 0 ? (t === "text" ? "no text layer" : t === "instance-swap" ? "no instance" : "no layer") : undefined,
      onSelect: () => addProp(t),
    };
  });
  const more: MenuItem[] = [
    { label: "Select instances", disabled: instances === 0, onSelect: () => selectInstancesOf(node.id) },
    ...(set ? [{ label: "Add variant", onSelect: () => addVariantOf(node.id) }] : []),
    { type: "separator" },
    { label: "Remove component", danger: true, onSelect: () => removeComponentDef(node.id) },
  ];

  return (
    <Section
      title={set ? "Variant" : "Component"}
      actions={
        <>
          <IconButton icon="plus" iconSize={12} size="xs" label="Add property" onClick={(e) => openMenu([{ type: "label", label: "Add property" }, ...addMenu], e.currentTarget, { minWidth: 200 })} />
          <IconButton icon="more" iconSize={12} size="xs" label="Component actions" onClick={(e) => openMenu(more, e.currentTarget, { minWidth: 200 })} />
        </>
      }
    >
      <CompCard
        icon="mainComponent"
        title={set ? `${set.name} / ${node.name}` : node.name}
        sub={`${instances ? `${instances} ${instances === 1 ? "instance" : "instances"}` : "No instances yet"}${set ? `, in ${set.name}` : ""}`}
        action={set ? (
          <button className="of-comp-link" onClick={() => setSelection(fileId, [set.id])} title="Select the component set">
            <Icon name="componentSet" size={12} />
          </button>
        ) : null}
      />
      {set ? (
        <div className="of-prop-list">
          {Object.entries(def.variant ?? {}).map(([k, v]) => (
            <div className="of-prop-row" key={k}>
              <span className="of-prop-label" title={`Variant property ${k}`}><span className="name">{k}</span></span>
              <TextInput ariaLabel={`${k} value`} value={v} onCommit={(nv) => nv.trim() && transact(fileId, "Rename variant", (tx) => setComponentDef(tx, node.id, { variant: { ...def.variant, [k]: nv.trim() } }))} />
            </div>
          ))}
        </div>
      ) : null}
      {enumProps.length && set ? <span className="of-hint">{enumProps.map((p) => `${p.name}: ${p.options?.join(", ")}`).join("; ")}</span> : null}
      {def.props.length ? (
        <div className="of-propdef-list">
          {def.props.map((p, i) => (
            <PropDefRow
              key={`${p.name}-${i}`}
              doc={doc}
              main={node}
              def={p}
              onChange={(next) => writeProps(def.props.map((x, j) => (j === i ? next : x)))}
              onRemove={() => writeProps(def.props.filter((_, j) => j !== i), "Remove property")}
            />
          ))}
        </div>
      ) : (
        <span className="of-hint">No properties. Use + to expose a text, a visibility toggle, an instance swap or a slot to instances.</span>
      )}
      {menu}
    </Section>
  );
}

function PropDefRow({ doc, main, def, onChange, onRemove }: { doc: FoldDocument; main: OFNode; def: ComponentPropDef; onChange: (d: ComponentPropDef) => void; onRemove: () => void }) {
  const layers = eligibleLayers(doc, main, def.type);
  const target = def.target ? doc.nodes[def.target] : undefined;
  const swapOptions = def.type === "instance-swap" ? listComponents(doc, { libraries: false }).map((c) => ({ value: c.id, label: c.label })) : [];
  return (
    <div className="of-propdef">
      <div className="of-row tight">
        <span className="of-propdef-type" title={TYPE_LABEL[def.type]}><Icon name={TYPE_ICON[def.type]} size={12} /></span>
        <TextInput ariaLabel="Property name" value={def.name} onCommit={(name) => name.trim() && onChange({ ...def, name: name.trim() })} mono />
        <IconButton icon="minus" iconSize={12} size="sm" label="Remove property" onClick={onRemove} />
      </div>
      <div className="of-row tight" style={{ paddingLeft: 24 }}>
        <SelectField
          ariaLabel="Layer"
          label={<Icon name="link" size={11} />}
          value={def.target ?? ""}
          placeholder={target?.name ?? "Missing layer"}
          options={layers.map((l) => ({ value: l.id, label: l.name }))}
          onChange={(id) => onChange({ ...def, target: id, ...(def.type === "instance-swap" ? { default: undefined } : {}) })}
        />
        {def.type === "boolean" ? <Toggle label="Default" on={def.default !== false} onChange={(v) => onChange({ ...def, default: v })} /> : null}
      </div>
      {def.type === "text" ? <span className="of-hint" style={{ paddingLeft: 24 }}>Instances start with the text of {target?.name ?? "this layer"}.</span> : null}
      {def.type === "instance-swap" && swapOptions.length ? (
        <span className="of-hint" style={{ paddingLeft: 24 }}>Swaps {target?.name ?? "the nested instance"} for any of {swapOptions.length} components.</span>
      ) : null}
      {def.type === "slot" ? <span className="of-hint" style={{ paddingLeft: 24 }}>Each instance fills this frame with its own layers.</span> : null}
    </div>
  );
}

// ------------------------------------------------------------------ component set

function SetSection({ node }: { node: OFNode }) {
  const { doc, fileId } = useCtx();
  const variants = variantsOf(doc.nodes, node);
  const enumProps = variants[0] ? allProps(doc.nodes, variants[0]).filter((p) => p.type === "enum") : [];
  return (
    <Section
      title="Component set"
      actions={variants.length ? <IconButton icon="plus" iconSize={12} size="xs" label="Add variant" onClick={() => addVariantOf(variants[variants.length - 1].id)} /> : undefined}
    >
      <CompCard icon="componentSet" title={node.name} sub={`${variants.length} ${variants.length === 1 ? "variant" : "variants"}${enumProps.length ? `, by ${enumProps.map((p) => p.name).join(" and ")}` : ""}`} />
      <div className="of-variant-list">
        {variants.map((v) => (
          <button key={v.id} className="of-variant" onClick={() => setSelection(fileId, [v.id])}>
            <Icon name="mainComponent" size={12} />
            <span className="name">{v.name}</span>
            <span className="vals">{Object.values(v.component?.variant ?? {}).join(", ")}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ layers inside instances / components

function LinkedLayerSection({ node }: { node: OFNode }) {
  const { doc } = useCtx();
  const owner = instanceOwner(doc, node.id);
  const overridden = hasOverrides(doc, node);
  return (
    <Section title="Instance layer">
      <CompCard
        icon="component"
        title={owner?.name ?? "Instance"}
        sub={overridden ? "This layer has overrides" : "Edits become overrides"}
        action={<button className="of-comp-link" onClick={() => selectOwnerInstance(node.id)} title="Select the instance"><Icon name="goTo" size={12} /></button>}
      />
      {overridden ? (
        <div className="of-override-row">
          <span className="of-override-dot" />
          <span style={{ flex: 1 }}>Overridden</span>
          <Button size="sm" onClick={() => resetOverridesOf([node.id])}>Reset</Button>
        </div>
      ) : null}
    </Section>
  );
}

function BoundLayerSection({ node }: { node: OFNode }) {
  const { doc } = useCtx();
  const props = propsBoundTo(doc, node);
  return (
    <Section title="Component property">
      {props.map((p) => (
        <div className="of-override-row" key={p.name}>
          <Icon name={TYPE_ICON[p.type]} size={12} style={{ color: "var(--of-component)" }} />
          <span style={{ flex: 1 }}><span className="of-mono">{p.name}</span> <span className="of-muted">{TYPE_LABEL[p.type].toLowerCase()}</span></span>
        </div>
      ))}
    </Section>
  );
}

// ------------------------------------------------------------------ code component mapping

function CodeSection({ node }: { node: OFNode }) {
  const { doc, fileId } = useCtx();
  const instance = !!node.instance;
  const main = instance ? mainComponentOf(doc, node) : node.componentSet ? node : node;
  const store = instance ? componentStore(doc, node.instance!.library) : doc.nodes;
  if (!main || !store) return null;
  // variants share the set's mapping; a set edits its own
  const set = main.component ? componentSetOf(store, main) : undefined;
  const ownerOfRef = node.componentSet ? node : set && !main.component?.codeRef ? set : main;
  const ref: CodeRef | undefined = node.componentSet ? node.componentSet.codeRef : codeRefOf(store, main);
  const props = node.componentSet ? (variantsOf(doc.nodes, node)[0] ? allProps(doc.nodes, variantsOf(doc.nodes, node)[0]) : []) : allProps(store, main);

  const write = (next: CodeRef | null) => {
    if (ownerOfRef.componentSet) transact(fileId, "Code component", (tx) => setComponentSetDef(tx, ownerOfRef.id, { codeRef: next }));
    else transact(fileId, "Code component", (tx) => setComponentDef(tx, ownerOfRef.id, { codeRef: next }));
  };

  if (instance) {
    let snippet = "";
    if (ref) {
      try {
        snippet = nodeToJsx(doc, node.id, { format: "tailwind" });
      } catch {
        snippet = "";
      }
    }
    return (
      <Section title="Code component">
        {ref ? (
          <>
            <div className="of-code-map">
              <div className="row"><span className="k">Package</span><span className="v">{ref.package}</span></div>
              <div className="row"><span className="k">Export</span><span className="v">{ref.export}</span></div>
            </div>
            {snippet ? <pre className="of-code-snippet">{snippet.split("\n").slice(0, 8).join("\n")}</pre> : null}
          </>
        ) : (
          <span className="of-hint">Not mapped to code yet. Map the main component to export {"<"}{(main.name.split("/")[0] || "Component").replace(/[^A-Za-z0-9]/g, "") || "Component"} {"/>"} instead of markup.</span>
        )}
        {!node.instance!.library && main ? (
          <Button size="sm" style={{ alignSelf: "flex-start" }} onClick={() => void goToMainComponent(node.id)}>{ref ? "Edit mapping on main component" : "Map on main component"}</Button>
        ) : null}
      </Section>
    );
  }

  const shared = ownerOfRef !== node && ownerOfRef.componentSet;
  return (
    <Section
      title="Code component"
      collapsed={!ref}
      onHeaderClick={!ref ? () => write({ package: "@/components", export: (ownerOfRef.name.replace(/[^A-Za-z0-9]+/g, "") || "Component").replace(/^./, (c) => c.toUpperCase()) }) : undefined}
      actions={
        ref ? <IconButton icon="minus" iconSize={12} size="xs" label="Remove code mapping" onClick={() => write(null)} />
        : <IconButton icon="plus" iconSize={12} size="xs" label="Map to a code component" onClick={() => write({ package: "@/components", export: (ownerOfRef.name.replace(/[^A-Za-z0-9]+/g, "") || "Component").replace(/^./, (c) => c.toUpperCase()) })} />
      }
    >
      {ref ? (
        <>
          {shared ? <span className="of-hint">Shared by every variant of {ownerOfRef.name}.</span> : null}
          <div className="of-prop-row">
            <span className="of-prop-label"><span className="name">Package</span></span>
            <TextInput ariaLabel="Package" mono value={ref.package} placeholder="@acme/ui" onCommit={(v) => v.trim() && write({ ...ref, package: v.trim() })} />
          </div>
          <div className="of-prop-row">
            <span className="of-prop-label"><span className="name">Export</span></span>
            <TextInput ariaLabel="Export" mono value={ref.export} placeholder="Button" onCommit={(v) => v.trim() && write({ ...ref, export: v.trim() })} />
          </div>
          {props.filter((p) => p.type !== "slot").length ? <div className="of-caps" style={{ marginTop: 4 }}>Props</div> : null}
          {props.filter((p) => p.type !== "slot").map((p) => {
            const mapped = ref.propsMap?.[p.name];
            return (
              <div className="of-prop-row" key={p.name}>
                <span className="of-prop-label" title={`Design property ${p.name}`}><span className="name of-mono">{p.name}</span></span>
                <TextInput
                  ariaLabel={`Code prop for ${p.name}`}
                  mono
                  value={mapped ?? p.name}
                  placeholder="left out"
                  onCommit={(v) => {
                    const map = { ...(ref.propsMap ?? {}) };
                    if (v.trim() === p.name) delete map[p.name];
                    else map[p.name] = v.trim();
                    write({ ...ref, propsMap: Object.keys(map).length ? map : undefined });
                  }}
                />
              </div>
            );
          })}
          <span className="of-hint">Code export and get_jsx emit {"<"}{ref.export}{" />"} with an import line. Clear a prop name to leave it out.</span>
        </>
      ) : null}
    </Section>
  );
}
