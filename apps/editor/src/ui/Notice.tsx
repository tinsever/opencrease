// A short message at the bottom of the canvas, e.g. when an edit is refused ("Cannot delete a layer inside
// an instance"). One at a time; it fades after a few seconds.
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import "./notice.css";

interface NoticeState {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

let current: NoticeState | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function showNotice(text: string, action?: NoticeState["action"]) {
  current = { id: ++seq, text, action };
  clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    emit();
  }, action ? 6000 : 4000);
  emit();
}

export function dismissNotice() {
  current = null;
  emit();
}

/** Runs a document action and turns a thrown error into a notice instead of a console error. */
export function tryAction<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    showNotice(err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

export function NoticeHost() {
  const notice = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  if (!notice) return null;
  return createPortal(
    <div className="of-notice" role="status" key={notice.id}>
      <span>{notice.text}</span>
      {notice.action ? (
        <button
          className="of-notice-action"
          onClick={() => {
            notice.action!.run();
            dismissNotice();
          }}
        >
          {notice.action.label}
        </button>
      ) : null}
    </div>,
    document.body,
  );
}
