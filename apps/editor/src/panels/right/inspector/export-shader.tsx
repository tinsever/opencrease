// Shader section and the page section shown when nothing is selected. The Export section lives in export.tsx.
import { useState } from "react";
import type { FoldDocument, OFNode, ShaderSpec } from "@opencrease/model";
import { getOpenFile } from "../../../state/workspace";
import { copyText, IconButton, Section } from "../../../ui";
import { newShaderSpec, ShaderParams, ShaderPicker, ShaderPresets, shaderSnippet } from "./shader-panel";
import { ColorField } from "../color/ColorField";
import { updateNodes, useCtx } from "./common";

// ---------------------------------------------------------------- Shader

export function ShaderSection() {
  const ctx = useCtx();
  const { nodes, doc, fileId } = ctx;
  const node = nodes[0];
  const spec = node.shader ?? { name: "MeshGradient", params: {} };
  const [copied, setCopied] = useState(false);
  const setSpec = (next: ShaderSpec, mk?: string) => updateNodes(ctx, "Shader", () => ({ shader: next }), mk);
  const snippet = shaderSnippet(spec);

  return (
    <>
      <Section title="Shader">
        <ShaderPicker value={spec.name} onPick={(n) => setSpec(newShaderSpec(n))} />
        <ShaderPresets spec={spec} onChange={setSpec} />
      </Section>
      <Section title="Parameters">
        <ShaderParams spec={spec} onChange={setSpec} doc={doc} fileId={fileId} />
      </Section>
      <Section title="Exports as" actions={<IconButton icon="copy" iconSize={12} size="xs" label={copied ? "Copied" : "Copy snippet"} onClick={() => void copyText(snippet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })} />}>
        <pre className="of-snippet">{snippet}</pre>
        <span className="of-hint">From @paper-design/shaders-react, Apache-2.0.</span>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- Page (nothing selected)

export function PageSection({ doc, fileId, pageId }: { doc: FoldDocument; fileId: string; pageId: string }) {
  const page = doc.pages[pageId];
  const root = page ? doc.nodes[page.rootId] : undefined;
  if (!page || !root) return null;
  const bg = String(root.styles.backgroundColor ?? root.styles.background ?? "");
  const set = (v: string | null, mk?: string) => {
    const file = getOpenFile(fileId);
    file?.store.transact("Page background", (tx) => tx.setStyles(root.id, { backgroundColor: v, background: null }), { mergeKey: mk });
  };
  const artboards = root.children.map((id) => doc.nodes[id]).filter((n): n is OFNode => !!n);
  return (
    <>
      <div className="of-sel-header">
        <div className="titles">
          <div className="t1">{page.name}</div>
          <div className="t2">Page with {artboards.length} {artboards.length === 1 ? "layer" : "layers"}</div>
        </div>
      </div>
      <Section
        title="Page background"
        collapsed={!bg}
        onHeaderClick={!bg ? () => set("#E3E3E0") : undefined}
        actions={!bg ? <IconButton icon="plus" iconSize={12} size="xs" label="Set page background" onClick={() => set("#E3E3E0")} /> : <IconButton icon="minus" iconSize={12} size="xs" label="Reset page background" onClick={() => set(null)} />}
      >
        {bg ? <ColorField value={bg} doc={doc} fileId={fileId} onChange={(c, mk) => set(c, mk)} /> : null}
      </Section>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="of-hint">Select a layer to edit it. Click selects a top-level layer, double-click goes inside, ⌘-click picks the innermost layer.</span>
        <span className="of-hint">Press F to draw an artboard, R for a rectangle and T for text. ⌘K opens the command palette.</span>
      </div>
    </>
  );
}
