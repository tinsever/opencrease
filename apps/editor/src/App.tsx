import { useWorkspace } from "./state/hooks";
import { Home } from "./home/Home";
import { TitleBar } from "./chrome/TitleBar";
import { Canvas } from "./canvas/Canvas";
import { LeftPanel } from "./panels/left/LeftPanel";
import { RightPanel } from "./panels/right/RightPanel";
import { useGlobalShortcuts } from "./canvas/shortcuts";
import { PanelResize } from "./panels/PanelResize";
import { PermissionHost } from "./agent/PermissionHost";
import { DialogHost } from "./dialogs/DialogHost";

export function App() {
  const route = useWorkspace((s) => s.route);
  const activeFileId = useWorkspace((s) => s.activeFileId);
  const uiHidden = useWorkspace((s) => s.uiHidden);
  useGlobalShortcuts();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TitleBar />
      {route.kind === "home" || !activeFileId ? (
        <Home />
      ) : (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {!uiHidden && <><LeftPanel fileId={activeFileId} /><PanelResize side="left" /></>}
          <Canvas key={activeFileId} fileId={activeFileId} />
          {!uiHidden && <><PanelResize side="right" /><RightPanel fileId={activeFileId} /></>}
        </div>
      )}
      <DialogHost />
      <PermissionHost />
    </div>
  );
}
