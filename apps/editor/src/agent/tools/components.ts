// Component tools (oc_*): list, create components and sets, edit props, place and edit instances.
import {
  codeRefOf, componentLabel, componentSetOf, componentStore, createComponent, createComponentSet, createInstance,
  detachInstance, getNode, hasOverrides, instanceOwner, instancePropStates, isSlotLayer, listComponents,
  mainComponentOf, overrideCount, resetOverrides, resolveComponentRef, setComponentDef, setComponentSetDef,
  setEnumProps, setInstanceProps, variantsOf,
  type CodeRef, type ComponentPropDef, type FoldDocument, type OFNode, type PropValue, type StyleValue,
} from "@opencrease/model";
import { normalizeStyles } from "@opencrease/css";
import { ToolError, type EditorTool } from "../env";
import { findFreeSpot } from "../placement";
import { asArray, assertUnlocked, nameOf, pageOfIds, plural, requireNode, sizeOf, positionOf, topLevelRects } from "./common";
import { pxNumber } from "../match";

type Args = Record<string, unknown>;

/** Code component names in a file, accepted as tags by write_html. */
export function codeComponentTags(doc: FoldDocument): string[] {
  const out = new Set<string>();
  for (const c of listComponents(doc)) if (c.codeRef && c.codeRef.export !== "default") out.add(c.codeRef.export);
  return [...out];
}

/** Component facts for get_node_info. */
export function componentInfo(doc: FoldDocument, n: OFNode): Record<string, unknown> | undefined {
  if (n.instance) {
    const main = mainComponentOf(doc, n);
    const store = componentStore(doc, n.instance.library);
    const out: Record<string, unknown> = {
      kind: n.source === undefined ? "instance" : "nested-instance",
      componentId: n.instance.componentId,
      componentName: main && store ? componentLabel(store, main) : null,
      mainMissing: !main,
      props: Object.fromEntries(instancePropStates(doc, n).map((s) => [s.def.name, s.value ?? null])),
    };
    if (n.instance.library) out.library = n.instance.library;
    if (n.source === undefined) out.overrideCount = overrideCount(n);
    else out.instanceId = instanceOwner(doc, n.id)?.id ?? null;
    if (main && store && codeRefOf(store, main)) out.codeRef = codeRefOf(store, main);
    return out;
  }
  if (n.source !== undefined) {
    return { kind: "instance-layer", instanceId: instanceOwner(doc, n.id)?.id ?? null, sourcePath: n.source, overridden: hasOverrides(doc, n), slot: isSlotLayer(doc, n) };
  }
  if (n.component) {
    const set = componentSetOf(doc.nodes, n);
    const out: Record<string, unknown> = {
      kind: "main",
      props: n.component.props,
      instanceCount: Object.values(doc.nodes).filter((o) => o.instance && o.source === undefined && !o.instance.library && o.instance.componentId === n.id).length,
    };
    if (set) {
      out.setId = set.id;
      out.variant = n.component.variant ?? {};
    }
    if (n.component.codeRef) out.codeRef = n.component.codeRef;
    return out;
  }
  if (n.componentSet) {
    return {
      kind: "set",
      variants: variantsOf(doc.nodes, n).map((v) => ({ id: v.id, variant: v.component!.variant ?? {} })),
      props: setEnumProps(doc.nodes, n),
      ...(n.componentSet.codeRef ? { codeRef: n.componentSet.codeRef } : {}),
    };
  }
  return undefined;
}

const oc_list_components: EditorTool = {
  write: false,
  run(args, env) {
    const components = listComponents(env.doc, { libraries: args.includeLibraries !== false });
    const libraries = Object.entries(env.doc.libraries ?? {}).map(([id, l]) => ({ id, name: l.name, version: l.version }));
    const out: Record<string, unknown> = { components, count: components.length };
    if (libraries.length) out.libraries = libraries;
    if (!components.length) out.next = "No components yet. Build one with write_html, then turn its frame into a component with oc_create_component.";
    return [out];
  },
};

function componentResult(doc: FoldDocument, id: string) {
  return listComponents(doc, { libraries: false }).find((c) => c.id === id);
}

const oc_create_component: EditorTool = {
  write: true,
  page: (args, doc) => pageOfIds(doc, asArray(args.nodeIds)),
  label: (args, doc) => {
    const ids = asArray<string>(args.nodeIds);
    return ids.length === 1 ? `Creating component "${nameOf(doc, ids[0])}"` : `Creating ${plural(ids.length, "component")}`;
  },
  run(args, env) {
    const ids = asArray<string>(args.nodeIds);
    if (!ids.length) throw new ToolError("Pass nodeIds: the frames to turn into components.");
    for (const id of ids) assertUnlocked(env.doc, requireNode(env.doc, id), "become a component");
    if (ids.length > 1 && (args.name || args.props)) throw new ToolError("name and props only work with a single frame. Call oc_set_component_props for each component afterwards.");
    env.transact((tx) => {
      for (const id of ids) {
        createComponent(tx, id, {
          name: typeof args.name === "string" ? args.name : undefined,
          props: args.props as ComponentPropDef[] | undefined,
          codeRef: (args.codeRef as CodeRef | undefined) ?? undefined,
          description: typeof args.description === "string" ? args.description : undefined,
        });
      }
    });
    env.touch(ids);
    return [{ components: ids.map((id) => componentResult(env.doc, id)), next: "Place instances with oc_create_instance (or <x-instance> in write_html). Declare props with oc_set_component_props." }];
  },
};

const oc_create_component_set: EditorTool = {
  write: true,
  page: (args, doc) => pageOfIds(doc, asArray(args.componentIds)),
  label: (args) => `Combining ${plural(asArray(args.componentIds).length, "variant")}`,
  run(args, env) {
    const ids = asArray<string>(args.componentIds);
    const setId = env.transact((tx) => {
      const id = createComponentSet(tx, ids, {
        name: typeof args.name === "string" ? args.name : undefined,
        propName: typeof args.propName === "string" ? args.propName : undefined,
        values: asArray<string>(args.values),
      });
      if (args.codeRef) setComponentSetDef(tx, id, { codeRef: args.codeRef as CodeRef });
      return id;
    });
    env.touch([setId]);
    const set = getNode(env.doc, setId)!;
    return [{ setId, name: set.name, props: setEnumProps(env.doc.nodes, set), variants: variantsOf(env.doc.nodes, set).map((v) => ({ id: v.id, name: v.name, variant: v.component!.variant })) }];
  },
};

const oc_set_component_props: EditorTool = {
  write: true,
  page: (args, doc) => pageOfIds(doc, [args.componentId]),
  label: (args, doc) => `Editing component "${nameOf(doc, String(args.componentId ?? ""))}"`,
  run(args, env) {
    const node = requireNode(env.doc, args.componentId);
    if (!node.component && !node.componentSet) throw new ToolError(`"${node.name}" is not a main component or a component set. Use oc_create_component first.`);
    env.transact((tx) => {
      if (node.componentSet) {
        if (args.props !== undefined || args.variant !== undefined) throw new ToolError("Props and variant values live on the components inside the set. Pass one of its variants.");
        setComponentSetDef(tx, node.id, {
          name: typeof args.name === "string" ? args.name : undefined,
          codeRef: args.codeRef as CodeRef | null | undefined,
          description: args.description as string | null | undefined,
        });
        return;
      }
      setComponentDef(tx, node.id, {
        name: typeof args.name === "string" ? args.name : undefined,
        props: args.props as ComponentPropDef[] | undefined,
        codeRef: args.codeRef as CodeRef | null | undefined,
        description: args.description as string | null | undefined,
        variant: args.variant as Record<string, string> | undefined,
      });
    });
    env.touch([node.id]);
    if (node.componentSet) {
      const set = getNode(env.doc, node.id)!;
      return [{ setId: set.id, name: set.name, codeRef: set.componentSet?.codeRef ?? null }];
    }
    return [{ component: componentResult(env.doc, node.id) }];
  },
};

function instanceResult(env: Parameters<EditorTool["run"]>[1], id: string) {
  const doc = env.doc;
  const n = getNode(doc, id)!;
  const rect = env.measure(id);
  const size = sizeOf(env, n, rect);
  return {
    id,
    name: n.name,
    ...positionOf(env, doc, n, rect),
    width: size.width,
    height: size.height,
    ...componentInfo(doc, n),
    layers: n.children.map((c) => ({ id: c, name: doc.nodes[c]?.name, sourcePath: doc.nodes[c]?.source })),
  };
}

const oc_create_instance: EditorTool = {
  write: true,
  page: (args, doc) => pageOfIds(doc, [args.parentId]),
  label: (args) => `Placing ${String(args.componentId ?? "component")}`,
  async run(args, env) {
    const doc = env.doc;
    const parent = requireNode(doc, args.parentId);
    if (parent.type !== "Root") assertUnlocked(doc, parent, "get new children");
    const ref = resolveComponentRef(doc, String(args.componentId ?? ""), typeof args.library === "string" ? args.library : undefined);
    if (!ref) throw new ToolError(`No component "${String(args.componentId)}" in this file. Use oc_list_components to see the available components.`);
    const { styles, ignored } = normalizeStyles((args.styles as Record<string, unknown>) ?? {});
    if (parent.type === "Root" && (styles.left === undefined || styles.top === undefined)) {
      const store = componentStore(doc, ref.library)!;
      const main = store[ref.id];
      const pageId = pageOfIds(doc, [parent.id]) ?? env.activePageId;
      const spot = findFreeSpot(topLevelRects(env, doc, pageId), { width: pxNumber(main.styles.width) ?? 200, height: pxNumber(main.styles.height) ?? 80 });
      styles.left ??= spot.x;
      styles.top ??= spot.y;
    }
    const id = env.transact((tx) =>
      createInstance(tx, ref.id, parent.id, {
        library: ref.library,
        index: typeof args.index === "number" ? args.index : undefined,
        props: args.props as Record<string, PropValue> | undefined,
        styles: styles as Record<string, StyleValue>,
        name: typeof args.name === "string" ? args.name : undefined,
      }),
    );
    env.touch(parent.type === "Root" ? [id] : [parent.id, id]);
    await env.settle();
    const out: Record<string, unknown> = { instance: instanceResult(env, id) };
    if (ignored.length) out.ignoredStyles = ignored;
    return [out];
  },
};

const oc_set_instance_props: EditorTool = {
  write: true,
  page: (args, doc) => pageOfIds(doc, asArray<{ instanceId: string }>(args.updates).map((u) => u?.instanceId)),
  label: (args) => `Setting props on ${plural(asArray(args.updates).length, "instance")}`,
  async run(args, env) {
    const updates = asArray<{ instanceId: string; props: Record<string, PropValue | null> }>(args.updates);
    for (const u of updates) {
      const n = requireNode(env.doc, u.instanceId);
      if (!n.instance) throw new ToolError(`"${n.name}" (${n.id}) is not an instance.`);
      assertUnlocked(env.doc, n);
    }
    env.transact((tx) => {
      for (const u of updates) setInstanceProps(tx, u.instanceId, u.props ?? {});
    });
    env.touch(updates.map((u) => u.instanceId));
    await env.settle();
    return [{ instances: updates.map((u) => instanceResult(env, u.instanceId)) }];
  },
};

const oc_reset_overrides: EditorTool = {
  write: true,
  page: (args, doc) => pageOfIds(doc, asArray(args.nodeIds)),
  label: (args) => `Resetting ${plural(asArray(args.nodeIds).length, "instance")}`,
  run(args, env) {
    const ids = asArray<string>(args.nodeIds);
    for (const id of ids) requireNode(env.doc, id);
    env.transact((tx) => {
      for (const id of ids) resetOverrides(tx, id);
    });
    env.touch(ids);
    return [{ reset: ids }];
  },
};

const oc_detach_instance: EditorTool = {
  write: true,
  page: (args, doc) => pageOfIds(doc, asArray(args.nodeIds)),
  label: (args) => `Detaching ${plural(asArray(args.nodeIds).length, "instance")}`,
  run(args, env) {
    const ids = asArray<string>(args.nodeIds);
    for (const id of ids) assertUnlocked(env.doc, requireNode(env.doc, id), "be detached");
    env.transact((tx) => {
      for (const id of ids) detachInstance(tx, id);
    });
    env.touch(ids);
    return [{ detached: ids.map((id) => ({ id, name: env.doc.nodes[id]?.name, childIds: env.doc.nodes[id]?.children ?? [] })) }];
  },
};

export const componentTools: Record<string, EditorTool<Args>> = {
  oc_list_components,
  oc_create_component,
  oc_create_component_set,
  oc_set_component_props,
  oc_create_instance,
  oc_set_instance_props,
  oc_reset_overrides,
  oc_detach_instance,
};
