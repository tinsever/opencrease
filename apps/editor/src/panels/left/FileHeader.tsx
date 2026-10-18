import { useState } from "react";
import { api } from "../../state/api";
import { useDoc, useWorkspace } from "../../state/hooks";
import { closeFile, getOpenFile, goHome, openFile, setLeftTab, type LeftTab } from "../../state/workspace";
import { Icon, InlineRename, Segmented, useMenu } from "../../ui";
import { folderLabel, refreshFiles, useFiles, useServerStatus } from "../files";
import { openConnectDialog, openSettings } from "../shared";

export function renameFile(fileId: string, name: string) {
  const file = getOpenFile(fileId);
  if (!file) return;
  file.store.transact("Rename file", (tx) => tx.setDocName(name));
  void api
    .renameFile(fileId, name)
    .catch((e) => console.warn("rename on disk failed", e))
    .finally(() => void refreshFiles());
}

export function FileHeader({ fileId }: { fileId: string }) {
  const doc = useDoc(fileId);
  const leftTab = useWorkspace((s) => s.leftTab);
  const { files } = useFiles();
  const status = useServerStatus();
  const entry = files?.find((f) => f.id === fileId);
  const [editing, setEditing] = useState(false);
  const [menu, openMenu] = useMenu();
  if (!doc) return null;

  const duplicate = async () => {
    const created = await api.createFile({ cloneFileId: fileId, name: `${doc.name} copy` });
    void refreshFiles();
    await openFile(created.id);
  };

  return (
    <div className="of-file-header">
      <div className="of-file-title">
        <div className="crumbs">
          <div className="folder" title={entry?.path}>{folderLabel(entry, status?.workspace) || " "}</div>
          <div className="name">
            <InlineRename value={doc.name} editing={editing} onEditingChange={setEditing} onCommit={(n) => renameFile(fileId, n)} style={{ overflow: "hidden", textOverflow: "ellipsis" }} />
          </div>
        </div>
        <button
          className="of-icon-btn sm"
          aria-label="File menu"
          onClick={(e) =>
            openMenu(
              [
                { label: "Rename", onSelect: () => setEditing(true) },
                { label: "Duplicate file", onSelect: () => void duplicate() },
                { type: "separator" },
                { label: "Design guide", onSelect: () => openSettings("guide") },
                { label: "Connect an agent", onSelect: openConnectDialog },
                { type: "separator" },
                { label: "All files", onSelect: goHome },
                { label: "Close file", onSelect: () => closeFile(fileId) },
              ],
              e.currentTarget,
              { minWidth: 200 },
            )
          }
        >
          <Icon name="chevronDown" size={16} />
        </button>
      </div>
      <Segmented<LeftTab>
        className="tabs"
        ariaLabel="Left panel"
        value={leftTab}
        onChange={setLeftTab}
        options={[
          { value: "layers", label: "Layers" },
          { value: "theme", label: "Theme" },
          { value: "assets", label: "Assets" },
        ]}
      />
      {menu}
    </div>
  );
}
