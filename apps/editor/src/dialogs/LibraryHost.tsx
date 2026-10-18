// Library update notification: when a library the open file uses publishes a newer version, a card on
// the canvas offers "Update" and "Review changes" (SPEC §4.9).
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { LibraryDiff, LibraryDiffEntry } from "@opencrease/model";
import { getCanvasElement } from "../canvas/registry";
import { useWorkspace } from "../state/hooks";
import { checkLibraryUpdates, getUpdates, reviewLibraryChanges, subscribeToLibrary, subscribeUpdates, type LibraryUpdate } from "../state/libraries";
import { Button, Icon } from "../ui";
import { Dialog } from "./Dialog";
import "../panels/components.css";

const POLL_MS = 15_000;

export function LibraryHost() {
  const fileId = useWorkspace((s) => (s.route.kind === "file" ? s.activeFileId : null));
  const hasLibraries = useWorkspace((s) => {
    const f = s.openFiles.find((o) => o.id === fileId);
    return !!f && Object.keys(f.store.doc.libraries ?? {}).length > 0;
  });
  const all = useSyncExternalStore(subscribeUpdates, getUpdates);
  const [dismissed, setDismissed] = useState<Record<string, number>>({});
  const [review, setReview] = useState<LibraryUpdate | null>(null);

  useEffect(() => {
    if (!fileId || !hasLibraries) return;
    const check = () => void checkLibraryUpdates(fileId).catch(() => {});
    check();
    const t = setInterval(check, POLL_MS);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", check);
    };
  }, [fileId, hasLibraries]);

  const pending = (fileId ? all[fileId] ?? [] : []).filter((u) => dismissed[`${fileId}|${u.libId}`] !== u.to);
  const first = pending[0];
  return (
    <>
      {first && fileId ? (
        <UpdateCard
          update={first}
          more={pending.length - 1}
          onUpdate={() => void subscribeToLibrary(fileId, first.libId)}
          onReview={() => setReview(first)}
          onDismiss={() => setDismissed((d) => ({ ...d, [`${fileId}|${first.libId}`]: first.to }))}
        />
      ) : null}
      {review && fileId ? <ReviewDialog fileId={fileId} update={review} onClose={() => setReview(null)} /> : null}
    </>
  );
}

function useCanvasCorner(): { top: number; right: number } | null {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    const measure = () => {
      const r = getCanvasElement()?.getBoundingClientRect();
      setPos(r ? { top: r.top + 12, right: window.innerWidth - r.right + 12 } : null);
    };
    measure();
    const t = setInterval(measure, 1000);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", measure);
    };
  }, []);
  return pos;
}

function UpdateCard({ update, more, onUpdate, onReview, onDismiss }: { update: LibraryUpdate; more: number; onUpdate: () => void; onReview: () => void; onDismiss: () => void }) {
  const pos = useCanvasCorner();
  if (!pos) return null;
  return createPortal(
    <div className="of-lib-card" role="status" style={{ top: pos.top, right: pos.right }}>
      <div className="of-lib-card-head">
        <span className="of-lib-card-icon"><Icon name="mainComponent" size={14} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="of-lib-card-title">Library update</div>
          <div className="of-lib-card-text">
            {update.name} has a new version ({update.from} to {update.to}).{more > 0 ? ` ${more} more ${more === 1 ? "library has" : "libraries have"} updates.` : ""}
          </div>
        </div>
        <button className="of-icon-btn xs" aria-label="Later" title="Later" onClick={onDismiss}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="of-lib-card-actions">
        <Button onClick={onReview}>Review changes</Button>
        <Button variant="primary" onClick={onUpdate}>Update</Button>
      </div>
    </div>,
    document.body,
  );
}

function DiffGroup({ title, entries, tone }: { title: string; entries: LibraryDiffEntry[]; tone: "added" | "changed" | "removed" }) {
  if (!entries.length) return null;
  return (
    <div className="of-lib-diff-group">
      <div className="of-lib-diff-title">
        <span className={`of-lib-diff-dot ${tone}`} />
        {title}
        <span className="of-mono of-muted">{entries.length}</span>
      </div>
      {entries.map((e) => (
        <div key={e.id} className="of-lib-diff-row">{e.name}</div>
      ))}
    </div>
  );
}

function ReviewDialog({ fileId, update, onClose }: { fileId: string; update: LibraryUpdate; onClose: () => void }) {
  const [state, setState] = useState<{ diff?: LibraryDiff; error?: string }>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    reviewLibraryChanges(fileId, update.libId)
      .then(({ diff }) => setState({ diff }))
      .catch((e: unknown) => setState({ error: e instanceof Error ? e.message : String(e) }));
  }, [fileId, update.libId]);
  const d = state.diff;
  const empty = d && [d.components, d.tokens].every((g) => !g.added.length && !g.changed.length && !g.removed.length);
  return (
    <Dialog onClose={onClose} width={480} label="Review library changes">
      <div className="of-dlg-head">
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="of-dlg-title">{update.name}</div>
          <div className="of-dlg-sub">Version {update.from} to {update.to}. Updating keeps the overrides on your instances.</div>
        </div>
        <button className="of-icon-btn sm" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="of-scroll" style={{ maxHeight: "50vh", padding: "8px 24px 16px" }}>
        {state.error ? <div className="of-hint" style={{ color: "var(--of-danger)" }}>{state.error}</div> : null}
        {!d && !state.error ? <div className="of-hint">Loading changes</div> : null}
        {empty ? <div className="of-hint">Only internal details changed. Nothing you placed looks different.</div> : null}
        {d ? (
          <>
            {d.components.added.length + d.components.changed.length + d.components.removed.length ? <div className="of-caps of-lib-diff-section">Components</div> : null}
            <DiffGroup title="Changed" entries={d.components.changed} tone="changed" />
            <DiffGroup title="Added" entries={d.components.added} tone="added" />
            <DiffGroup title="Removed" entries={d.components.removed} tone="removed" />
            {d.tokens.added.length + d.tokens.changed.length + d.tokens.removed.length ? <div className="of-caps of-lib-diff-section">Tokens</div> : null}
            <DiffGroup title="Changed" entries={d.tokens.changed} tone="changed" />
            <DiffGroup title="Added" entries={d.tokens.added} tone="added" />
            <DiffGroup title="Removed from the library" entries={d.tokens.removed} tone="removed" />
          </>
        ) : null}
      </div>
      <div className="of-dlg-foot">
        <span className="of-hint" style={{ flex: 1 }}>Instances of removed components keep their layers.</span>
        <Button onClick={onClose}>Not now</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            if (await subscribeToLibrary(fileId, update.libId)) onClose();
            setBusy(false);
          }}
        >
          Update
        </Button>
      </div>
    </Dialog>
  );
}
