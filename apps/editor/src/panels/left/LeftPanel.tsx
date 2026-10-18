import "../../ui";
import "../panels.css";
import { useWorkspace } from "../../state/hooks";
import { AssetsTab } from "./AssetsTab";
import { FileHeader } from "./FileHeader";
import { LayerTree } from "./LayerTree";
import { PagesSection } from "./PagesSection";
import { ThemeTab } from "./ThemeTab";

export function LeftPanel({ fileId }: { fileId: string }) {
  const tab = useWorkspace((s) => s.leftTab);
  return (
    <aside className="of-panel left" aria-label="Layers and pages">
      <FileHeader fileId={fileId} />
      {tab === "layers" ? (
        <>
          <PagesSection fileId={fileId} />
          <LayerTree fileId={fileId} />
        </>
      ) : tab === "theme" ? (
        <ThemeTab fileId={fileId} />
      ) : (
        <AssetsTab fileId={fileId} />
      )}
    </aside>
  );
}
