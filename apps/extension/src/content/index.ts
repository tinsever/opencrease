// Content script entry: element picker, capture runs, delivery to OpenCrease or the clipboard.
import { wrapForClipboard } from "../snapshot/emit";
import type { CaptureMode, SnapshotPayload } from "../snapshot/types";
import type { ContentState, DeliverResult, Settings, StatusMessage, ToBackground, ToContent } from "../shared/messages";
import { selectorLabel, UI_TAG } from "./capture";
import { shadowOf } from "./pseudo";
import { snapshot, type ImageFetcher } from "./snapshot";
import { hideToast, showHighlight, showHint, showToast } from "./ui";

declare global {
  interface Window {
    __opencreaseSnapshot?: boolean;
  }
}

const state: ContentState = { picking: false, busy: false };
let settings: Settings | null = null;
let hovered: Element | null = null;
/** Elements walked up from with ArrowUp, to walk back down with ArrowDown. */
let trail: Element[] = [];

function status(phase: StatusMessage["phase"], text: string): void {
  chrome.runtime.sendMessage({ type: "status", phase, text } satisfies StatusMessage).catch(() => undefined);
}

const fetchImages: ImageFetcher = async (urls) => {
  const res = (await chrome.runtime.sendMessage({ type: "fetch-images", urls } satisfies ToBackground)) as Record<string, string | null> | undefined;
  return res ?? {};
};

/** The innermost element under a point, looking through open and closed shadow roots. */
function deepElementAt(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y);
  for (let depth = 0; el && depth < 20; depth++) {
    const shadow = shadowOf(el);
    const inner = shadow?.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  if (el && el.tagName.toLowerCase() === UI_TAG) return null;
  return el;
}

function highlight(el: Element | null): void {
  hovered = el;
  if (!el) return showHighlight(null, "");
  const r = el.getBoundingClientRect();
  showHighlight(r, `${selectorLabel(el)} ${Math.round(r.width)} × ${Math.round(r.height)}`);
}

function onMove(e: MouseEvent): void {
  if (!state.picking) return;
  const el = deepElementAt(e.clientX, e.clientY);
  if (el !== hovered) {
    trail = [];
    highlight(el);
  }
}

function swallow(e: Event): void {
  if (!state.picking) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}

function onClick(e: MouseEvent): void {
  if (!state.picking) return;
  swallow(e);
  const el = hovered ?? deepElementAt(e.clientX, e.clientY);
  stopPicking();
  if (el) void run("element", el);
}

function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function onKey(e: KeyboardEvent): void {
  if (!state.picking) return;
  if (e.key === "Escape") {
    swallow(e);
    stopPicking();
    status("idle", "Picking cancelled.");
  } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    swallow(e);
    stopPicking();
    void run("page");
  } else if (e.key === "Enter" && hovered) {
    swallow(e);
    const el = hovered;
    stopPicking();
    void run("element", el);
  } else if (e.key === "ArrowUp" && hovered) {
    swallow(e);
    const p = parentOf(hovered);
    if (p && p !== document.documentElement) {
      trail.push(hovered);
      highlight(p);
    }
  } else if (e.key === "ArrowDown" && trail.length) {
    swallow(e);
    highlight(trail.pop() ?? null);
  }
}

function startPicking(): void {
  if (state.picking) return;
  state.picking = true;
  hideToast();
  showHint(true);
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("mousedown", swallow, true);
  document.addEventListener("mouseup", swallow, true);
  document.addEventListener("pointerdown", swallow, true);
  document.addEventListener("keydown", onKey, true);
  status("picking", "Click the highlighted section to capture it as editable layers.");
}

function stopPicking(): void {
  state.picking = false;
  showHint(false);
  highlight(null);
  trail = [];
  document.removeEventListener("mousemove", onMove, true);
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("mousedown", swallow, true);
  document.removeEventListener("mouseup", swallow, true);
  document.removeEventListener("pointerdown", swallow, true);
  document.removeEventListener("keydown", onKey, true);
}

/** Copies through a copy event (works without the async Clipboard API, needs a recent user gesture). */
function copyWithEvent(html: string, text: string): boolean {
  let done = false;
  const onCopy = (e: ClipboardEvent) => {
    e.clipboardData?.setData("text/html", html);
    e.clipboardData?.setData("text/plain", text);
    e.preventDefault();
    done = true;
  };
  document.addEventListener("copy", onCopy, true);
  try {
    document.execCommand("copy");
  } catch {
    // ignore
  } finally {
    document.removeEventListener("copy", onCopy, true);
  }
  return done;
}

async function copyToClipboard(html: string, text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && "write" in navigator.clipboard && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) }),
      ]);
      return true;
    }
  } catch {
    // fall through to the copy event
  }
  return copyWithEvent(html, text);
}

function summary(p: SnapshotPayload): string {
  const fonts = p.fonts.map((f) => f.family).slice(0, 3).join(", ");
  return `${p.stats.nodes} layers, ${p.width} × ${p.height}${fonts ? `. Fonts: ${fonts}` : ""}`;
}

async function run(mode: CaptureMode, target?: Element): Promise<void> {
  if (state.busy || !settings) return;
  state.busy = true;
  const s = settings;
  showToast({ title: "Snapshot", message: "Capturing the page", busy: true });
  status("capturing", "Capturing the page");
  try {
    const payload = await snapshot({ mode, keepFonts: s.keepFonts }, fetchImages, target);
    if (s.destination === "clipboard") {
      const html = wrapForClipboard(payload.html);
      const ok = await copyToClipboard(html, payload.name);
      if (ok) {
        showToast({ title: "Copied", message: `${summary(payload)}. Paste it into OpenCrease with ⌘V.`, warnings: payload.warnings });
        status("done", `Copied ${payload.stats.nodes} layers. Paste into OpenCrease.`);
      } else {
        // the capture took long enough for the click to stop counting as a user gesture
        showToast({
          title: "Ready to copy",
          message: summary(payload),
          warnings: payload.warnings,
          action: {
            label: "Copy to clipboard",
            run: () => {
              const copied = copyWithEvent(html, payload.name);
              showToast({ title: copied ? "Copied" : "Copy failed", message: copied ? "Paste it into OpenCrease with ⌘V." : "The browser blocked clipboard access on this page.", error: !copied });
            },
          },
        });
        status("done", "Snapshot ready. Use the button on the page to copy it.");
      }
      return;
    }
    const res = (await chrome.runtime.sendMessage({ type: "deliver", payload, settings: s } satisfies ToBackground)) as DeliverResult;
    showToast({ title: res.ok ? "Sent to OpenCrease" : "Not sent", message: res.ok ? res.message : res.message, warnings: res.ok ? payload.warnings : [], error: !res.ok });
  } catch (err) {
    const message = (err as Error).message || "The capture failed.";
    showToast({ title: "Snapshot failed", message, error: true });
    status("error", message);
  } finally {
    state.busy = false;
  }
}

if (!window.__opencreaseSnapshot) {
  window.__opencreaseSnapshot = true;
  chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
    const msg = raw as ToContent;
    if (msg.type === "state") {
      sendResponse(state);
      return false;
    }
    if (msg.type === "start") {
      settings = msg.settings;
      if (msg.mode === "element") startPicking();
      else {
        stopPicking();
        void run(msg.mode);
      }
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
}
