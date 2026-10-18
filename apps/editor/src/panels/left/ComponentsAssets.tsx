// Assets tab, Components section: local components and those of subscribed libraries. Drag one onto the
// canvas (or double-click it) to place an instance. Also publishes this file as a library and lists the
// libraries published in the workspace.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { listComponents, type ComponentSummary } from "@opencrease/model";
import { endComponentDrag, startComponentDrag } from "../../canvas/component-drop";
import { placeInstance, revealComponent, selectInstancesOf } from "../../state/component-actions";
import { useDoc } from "../../state/hooks";
import {
  checkLibraryUpdates, getUpdates, libraryApi, publishLibrary, stopUsingLibrary, subscribeToLibrary, subscribeUpdates,
  type LibraryListing,
} from "../../state/libraries";
import { Button, Icon, IconButton, useMenu } from "../../ui";
import "../components.css";

interface Group {
  key: string;
  title: string;
  library?: string;
  items: ComponentSummary[];
}

function groupComponents(list: ComponentSummary[], libNames: Record<string, string>): Group[] {
  const groups = new Map<string, Group>();
  for (const c of list) {
    const key = c.library ?? "";
    let g = groups.get(key);
    if (!g) {
      g = { key, title: c.library ? (libNames[c.library] ?? c.libraryName ?? "Library") : "This file", library: c.library, items: [] };
      groups.set(key, g);
    }
    g.items.push(c);
  }
  for (const g of groups.values()) g.items.sort((a, b) => a.label.localeCompare(b.label));
  return [...groups.values()].sort((a, b) => (a.key === "" ? -1 : b.key === "" ? 1 : a.title.localeCompare(b.title)));
}

export function ComponentsAssets({ fileId }: { fileId: string }) {
  const doc = useDoc(fileId);
  const [menu, openMenu] = useMenu();
  const [published, setPublished] = useState<LibraryListing[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const updates = useSyncExternalStore(subscribeUpdates, getUpdates)[fileId] ?? [];

  const refresh = () =>
    libraryApi.list().then((l) => {
      setPublished(l);
      void checkLibraryUpdates(fileId, l);
    }).catch(() => setPublished([]));
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, doc?.library?.version]);

  const components = useMemo(() => (doc ? listComponents(doc) : []), [doc]);
  const libNames = useMemo(() => Object.fromEntries(Object.entries(doc?.libraries ?? {}).map(([k, v]) => [k, v.name])), [doc?.libraries]);
  const groups = useMemo(() => groupComponents(components, libNames), [components, libNames]);
  if (!doc) return null;

  const localCount = components.filter((c) => !c.library).length;
  const available = (published ?? []).filter((l) => l.fileId !== fileId && !doc.libraries?.[l.fileId]);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const itemMenu = (c: ComponentSummary, anchor: HTMLElement) =>
    openMenu(
      [
        { label: "Place instance", onSelect: () => void placeInstance(c.id, c.library) },
        ...(!c.library
          ? [
              { label: "Select main component", onSelect: () => void revealComponent(c.id) },
              { label: "Select instances", disabled: c.instanceCount === 0, onSelect: () => selectInstancesOf(c.id) },
            ]
          : [{ label: `Open in ${c.libraryName ?? "library"}`, onSelect: () => void revealComponent(c.id, c.library) }]),
      ],
      anchor,
      { minWidth: 190 },
    );

  const libMenu = (libId: string, anchor: HTMLElement) => {
    const update = updates.find((u) => u.libId === libId);
    openMenu(
      [
        { label: update ? `Update to version ${update.to}` : "Up to date", disabled: !update, onSelect: () => void run(libId, () => subscribeToLibrary(fileId, libId)) },
        { type: "separator" },
        { label: "Remove library", danger: true, onSelect: () => stopUsingLibrary(fileId, libId) },
      ],
      anchor,
      { minWidth: 200 },
    );
  };

  return (
    <>
      <div className="of-list-head" style={{ padding: "12px 8px 4px 18px", height: "auto" }}>
        <span className="of-caps">Components</span>
        <span className="of-mono of-muted" style={{ fontSize: "var(--of-text-xs)", marginRight: 4 }}>{components.length}</span>
        <IconButton
          icon="upload"
          iconSize={12}
          size="xs"
          label={doc.library ? `Publish library update (now version ${doc.library.version})` : "Publish as library"}
          disabled={busy === "publish" || (localCount === 0 && doc.tokens.length === 0)}
          onClick={() => void run("publish", () => publishLibrary(fileId))}
        />
      </div>
      {components.length === 0 ? (
        <div className="of-empty">No components yet. Select a frame and press ⌥⌘K, or use a library below.</div>
      ) : null}
      {groups.map((g) => {
        const update = g.library ? updates.find((u) => u.libId === g.library) : undefined;
        return (
          <div className="of-comp-group" key={g.key}>
            <div className="of-comp-group-head">
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.title}</span>
              {update ? <button className="of-field-tag" style={{ color: "var(--of-component)" }} onClick={() => void run(g.key, () => subscribeToLibrary(fileId, g.key))}>Update</button> : null}
              {g.library ? <IconButton icon="more" iconSize={12} size="xs" label="Library actions" onClick={(e) => libMenu(g.library!, e.currentTarget)} /> : null}
            </div>
            {g.items.map((c) => (
              <div
                key={c.id}
                className="of-comp-item"
                draggable
                title="Drag onto the canvas, or double-click to place an instance"
                onDragStart={(e) => startComponentDrag(e, c.id, c.library)}
                onDragEnd={endComponentDrag}
                onDoubleClick={() => void placeInstance(c.id, c.library)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  itemMenu(c, e.currentTarget);
                }}
              >
                <Icon name={c.setId ? "componentSet" : "mainComponent"} size={13} />
                <span className="name">{c.label}</span>
                {c.instanceCount ? <span className="count" title={`${c.instanceCount} in this file`}>{c.instanceCount}</span> : null}
                <IconButton icon="plus" iconSize={11} size="xs" label="Place instance" onClick={() => void placeInstance(c.id, c.library)} />
              </div>
            ))}
          </div>
        );
      })}
      {available.length ? (
        <>
          <div className="of-comp-group-head" style={{ paddingTop: 6 }}>Libraries in this workspace</div>
          {available.map((l) => (
            <div className="of-lib-row" key={l.fileId}>
              <Icon name="componentSet" size={13} style={{ color: "var(--of-component)", flexShrink: 0 }} />
              <div className="grow">
                <span>{l.name}</span>
                <span className="meta">{l.componentCount} {l.componentCount === 1 ? "component" : "components"}, {l.tokenCount} {l.tokenCount === 1 ? "token" : "tokens"}, version {l.version}</span>
              </div>
              <Button size="sm" disabled={busy === l.fileId} onClick={() => void run(l.fileId, () => subscribeToLibrary(fileId, l.fileId))}>Use</Button>
            </div>
          ))}
        </>
      ) : null}
      {doc.library ? <div className="of-hint" style={{ padding: "4px 18px 8px" }}>Published as a library, version {doc.library.version}. Publish again to share changes.</div> : null}
      {menu}
    </>
  );
}
