// Token modes section for frames: pin a mode per collection (rendered as data-mode), or inherit it.
import { effectiveModes, modeLabel, parseModeList, type ModeCollection, type OFNode } from "@opencrease/model";
import { MIXED, Section, SelectField } from "../../../ui";
import { common, updateNodes, useCtx } from "./common";

/** The node's `mode` with the entry for one collection replaced (or removed with ""). */
export function withMode(current: string | undefined, collection: ModeCollection, mode: string): string {
  const rest = parseModeList(current).filter((m) => !collection.modes.includes(m));
  return [...rest, ...(mode ? [mode] : [])].join(" ");
}

export function ModeSection() {
  const ctx = useCtx();
  const { doc, nodes } = ctx;
  const collections = doc.modeCollections ?? [];
  if (!collections.length || !nodes.every((n) => n.type === "Frame")) return null;
  const pinned = (n: OFNode, c: ModeCollection) => parseModeList(n.mode).find((m) => c.modes.includes(m)) ?? "";
  return (
    <Section title="Token modes">
      {collections.map((c) => {
        const value = common(nodes, (n) => pinned(n, c));
        const inherited = nodes.length === 1 && !value ? (effectiveModes(doc, nodes[0].id).find((m) => c.modes.includes(m)) ?? c.modes[0]) : null;
        return (
          <SelectField
            key={c.id}
            ariaLabel={`${c.name} mode`}
            label={c.name}
            value={value === MIXED ? "" : value}
            options={[
              { value: "", label: value === MIXED ? "Mixed" : `Inherit${inherited ? ` (${modeLabel(inherited)})` : ""}` },
              ...c.modes.map((m) => ({ value: m, label: modeLabel(m) })),
            ]}
            onChange={(m) => updateNodes(ctx, m ? `${modeLabel(m)} mode` : "Inherit mode", (n) => ({ mode: withMode(n.mode, c, m) }))}
          />
        );
      })}
    </Section>
  );
}
