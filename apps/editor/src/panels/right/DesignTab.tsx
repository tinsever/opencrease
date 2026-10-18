import { useMemo } from "react";
import { deleteSelection, duplicateSelection, renameNode, toggleLocked, toggleVisible, wrapSelection } from "../../state/actions";
import { useDoc, useWorkspace } from "../../state/hooks";
import { setRightTab, setSelection } from "../../state/workspace";
import { IconButton, InlineRename, useMenu } from "../../ui";
import { nodeKind } from "../nodeIcon";
import { usePanelState } from "../shared";
import { Ctx, InspectorBoundary, parentOf, type InspectorCtx } from "./inspector/common";
import { BackdropFiltersSection, BorderSection, FiltersSection, OutlineSection, ShadowSection } from "./inspector/effects-sections";
import { ClipMaskSection, OtherStylesSection, SelectionColorsSection } from "./inspector/styles-sections";
import { PageSection, ShaderSection } from "./inspector/export-shader";
import { ExportAllSection, ExportSection } from "./inspector/export";
import { FillSection } from "./inspector/fill";
import { ModeSection } from "./inspector/modes";
import { AiImageSection } from "./inspector/ai-image";
import { AppearanceSection, FlexSection, LayoutSection, PositionSection } from "./inspector/layout";
import { primaryFamily, useComputedText } from "./inspector/computed";
import { firstFamily, TypographySection, weightLabel } from "./inspector/typography";
import { TextDetailsSection } from "./inspector/text-details";
import { resolveToken, type FoldDocument, type StyleValue } from "@opencrease/model";

import { ArrangeControls, ConstraintsSection, GridSection } from "./inspector/canvas-layout";

const NO_IDS: string[] = [];

/** Family shown in the header: authored (token resolved) or the computed, inherited one. */
function textFamily(authored: StyleValue | undefined, computedList: string | undefined, doc: FoldDocument): string {
  if (authored !== undefined) {
    const token = /^var\(\s*(--[\w-]+)/.exec(String(authored))?.[1];
    return firstFamily(token ? (resolveToken(doc, token) ?? token) : authored);
  }
  const fam = primaryFamily(computedList ?? "");
  return fam ? `${fam} (inherited)` : "inherited font";
}
import { TokenDetail } from "./TokenDetail";
import { FillStrokeSection, isVectorSelection, PathEditPanel, VectorSections } from "./inspector/vector";
import { useEditingPath } from "../../vector/VectorOverlay";
import { ComponentSections, componentSubtitle } from "./inspector/components";
import { componentMenuItems } from "../left/component-menu";

export function DesignTab({ fileId }: { fileId: string }) {
  const doc = useDoc(fileId);
  const file = useWorkspace((s) => s.openFiles.find((f) => f.id === fileId));
  const leftTab = useWorkspace((s) => s.leftTab);
  const tokenId = usePanelState((s) => s.selectedTokenId);
  const selection = file?.selection;
  const [menu, openMenu] = useMenu();

  const ctx = useMemo<InspectorCtx | null>(() => {
    if (!doc || !selection) return null;
    const nodes = selection.map((id) => doc.nodes[id]).filter((n) => n && n.type !== "Root");
    if (nodes.length === 0) return null;
    return { fileId, doc, nodes, ids: nodes.map((n) => n.id) };
  }, [doc, selection, fileId]);
  const editingPath = useEditingPath(fileId);
  const computed = useComputedText(ctx?.nodes.length === 1 && ctx.nodes[0].type === "Text" ? ctx.ids : NO_IDS, doc);

  if (!doc || !file) return null;
  if (leftTab === "theme" && tokenId && doc.tokens.some((t) => t.id === tokenId)) return <TokenDetail fileId={fileId} tokenId={tokenId} />;
  if (editingPath) return <PathEditPanel fileId={fileId} />;
  if (!ctx) {
    return (
      <div className="of-inspector">
        <PageSection doc={doc} fileId={fileId} pageId={file.activePageId} />
        <ExportAllSection doc={doc} fileId={fileId} pageId={file.activePageId} />
      </div>
    );
  }

  const { nodes } = ctx;
  const single = nodes.length === 1 ? nodes[0] : null;
  const isArtboard = (n: (typeof nodes)[number]) => parentOf(doc, n)?.type === "Root" && n.type === "Frame";
  const compSubtitle = single ? componentSubtitle(doc, single) : null;
  const subtitle = compSubtitle ?? (single
    ? single.type === "Text"
      ? `Text, ${textFamily(single.styles.fontFamily, computed[single.id]?.fontFamily, doc)}, ${weightLabel(single.styles.fontWeight ?? computed[single.id]?.fontWeight)}`
      : single.type === "Shader"
        ? `Shader, ${single.shader?.name ?? "MeshGradient"}`
        : single.children.length
          ? `${nodeKind(single, isArtboard(single))} with ${single.children.length} ${single.children.length === 1 ? "child" : "children"}`
          : nodeKind(single, isArtboard(single))
    : `${nodes.length} layers selected`);
  const types = new Set(nodes.map((n) => n.type));
  const allText = types.size === 1 && types.has("Text");
  const shader = single?.type === "Shader";
  const svgEl = types.has("SVGElement");

  return (
    <Ctx.Provider value={ctx}>
      <div className="of-sel-header">
        <div className="titles">
          <div className="t1">{single ? <InlineRename value={single.name} onCommit={(n) => renameNode(single.id, n)} style={{ overflow: "hidden", textOverflow: "ellipsis" }} /> : "Mixed selection"}</div>
          <div className="t2">{subtitle}</div>
        </div>
        <ArrangeControls />
        <IconButton
          icon="more"
          outlined
          label="Layer actions"
          onClick={(e) =>
            openMenu(
              [
                { label: "Duplicate", shortcut: "⌘D", onSelect: duplicateSelection },
                { label: "Wrap in flex row", shortcut: "⇧A", onSelect: () => wrapSelection("flex-row") },
                { label: "Wrap in frame", shortcut: "⌘G", onSelect: () => wrapSelection("frame") },
                { type: "separator" as const },
                ...componentMenuItems(doc, ctx.ids),
                ...(single
                  ? [
                      { label: single.visible ? "Hide" : "Show", onSelect: () => toggleVisible(single.id) },
                      { label: single.locked ? "Unlock" : "Lock", onSelect: () => toggleLocked(single.id) },
                      ...(single.parentId && doc.nodes[single.parentId]?.type !== "Root" ? [{ label: "Select parent", onSelect: () => setSelection(fileId, [single.parentId!]) }] : []),
                    ]
                  : []),
                { label: "Show code", onSelect: () => setRightTab("code") },
                { type: "separator" as const },
                { label: "Delete", shortcut: "⌫", danger: true, onSelect: deleteSelection },
              ],
              e.currentTarget,
              { minWidth: 200 },
            )
          }
        />
      </div>
      <div className="of-inspector">
        <InspectorBoundary resetKey={ctx.ids.join(",")}>
        <ComponentSections />
        {!svgEl ? <LayoutSection /> : null}
        {!svgEl ? <PositionSection /> : null}
        {shader ? <ShaderSection /> : null}
        <ConstraintsSection />
        <FlexSection />
        <GridSection />
        {allText ? <TypographySection /> : null}
        {allText ? <TextDetailsSection /> : null}
        <AppearanceSection />
        <ModeSection />
        {isVectorSelection(nodes) ? <FillStrokeSection /> : !shader ? <FillSection /> : null}
        <AiImageSection />
        <VectorSections />
        <BorderSection />
        <OutlineSection />
        <ShadowSection />
        <FiltersSection />
        <BackdropFiltersSection />
        <ClipMaskSection />
        <SelectionColorsSection />
        <OtherStylesSection />
        <ExportSection />
        </InspectorBoundary>
        <div style={{ height: 24 }} />
      </div>
      {menu}
    </Ctx.Provider>
  );
}
