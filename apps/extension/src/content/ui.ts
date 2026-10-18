// In-page UI: the element picker highlight (per the "Snapshot — Browser extension" mock) and a result toast.
// Lives in a closed shadow root so page styles cannot reach it, and it is skipped by the capture.
import { UI_TAG } from "./capture";

const CSS = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font-family: system-ui, -apple-system, sans-serif; }
.box { position: fixed; box-sizing: border-box; border: 1.5px dashed #FF5B14; background: color-mix(in srgb, #FF5B14 6%, transparent); border-radius: 4px; display: none; }
.tag { position: absolute; left: -1.5px; top: -22px; background: #FF5B14; color: #FFFFFF; border-radius: 3px; padding: 2px 7px; font: 10px/14px ui-monospace, "SF Mono", Menlo, monospace; white-space: nowrap; }
.tag.below { top: auto; bottom: -22px; }
.hint { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #141414; color: #FFFFFF; border-radius: 8px; font-size: 12px; line-height: 16px; box-shadow: 0 8px 24px rgba(0,0,0,.24); }
.hint kbd { font: 10px/14px ui-monospace, "SF Mono", Menlo, monospace; color: #FFFFFF; background: rgba(255,255,255,.14); border-radius: 3px; padding: 1px 5px; margin-right: 4px; }
.hint span { color: rgba(255,255,255,.72); }
.toast { position: fixed; right: 16px; bottom: 16px; width: 300px; box-sizing: border-box; background: #FFFFFF; color: #141414; border-radius: 12px; box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 16px 40px rgba(0,0,0,.18); padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; pointer-events: auto; font-size: 12px; line-height: 16px; }
.toast .head { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; letter-spacing: -0.01em; }
.toast .head .grow { flex: 1; }
.toast .msg { color: #45453F; }
.toast .warn { color: #767673; font-size: 11px; line-height: 14px; }
.toast.error .msg { color: #D3341C; }
.toast button { all: unset; cursor: pointer; font-size: 12px; font-weight: 500; color: #FFFFFF; background: #141414; border-radius: 6px; padding: 6px 10px; align-self: flex-start; }
.toast .close { background: none; color: #767673; padding: 0 2px; font-size: 16px; line-height: 16px; }
.spinner { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid #E6E6E3; border-top-color: #FF5B14; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
`;

const LOGO = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2h8l4 4v8H2z" fill="#141414"/><path d="M10 2v4h4z" fill="#FF5B14"/></svg>`;

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;

function ensure(): ShadowRoot {
  if (root && host?.isConnected) return root;
  host = document.createElement(UI_TAG);
  host.style.cssText = "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;";
  root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>${CSS}</style><div class="layer"><div class="box"><div class="tag"></div></div></div>`;
  document.documentElement.appendChild(host);
  return root;
}

function layer(): HTMLElement {
  return ensure().querySelector(".layer") as HTMLElement;
}

export function showHighlight(rect: DOMRect | null, label: string): void {
  const box = ensure().querySelector(".box") as HTMLElement;
  if (!rect) {
    box.style.display = "none";
    return;
  }
  box.style.display = "block";
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
  const tag = box.querySelector(".tag") as HTMLElement;
  tag.textContent = label;
  tag.classList.toggle("below", rect.top < 26);
}

export function showHint(on: boolean): void {
  const l = layer();
  l.querySelector(".hint")?.remove();
  if (!on) return;
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.innerHTML = `<div><kbd>Click</kbd><span>capture</span></div><div><kbd>↑</kbd><span>parent</span></div><div><kbd>⌘↵</kbd><span>full page</span></div><div><kbd>Esc</kbd><span>cancel</span></div>`;
  l.appendChild(hint);
}

export interface ToastOptions {
  title: string;
  message: string;
  warnings?: string[];
  error?: boolean;
  busy?: boolean;
  action?: { label: string; run: () => void };
  /** ms; 0 keeps it open */
  timeout?: number;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(opts: ToastOptions): void {
  const l = layer();
  l.querySelector(".toast")?.remove();
  clearTimeout(toastTimer);
  const t = document.createElement("div");
  t.className = `toast${opts.error ? " error" : ""}`;
  const head = document.createElement("div");
  head.className = "head";
  head.innerHTML = LOGO;
  const title = document.createElement("div");
  title.className = "grow";
  title.textContent = opts.title;
  head.appendChild(title);
  if (opts.busy) {
    const s = document.createElement("div");
    s.className = "spinner";
    head.appendChild(s);
  } else {
    const close = document.createElement("button");
    close.className = "close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    close.onclick = () => t.remove();
    head.appendChild(close);
  }
  t.appendChild(head);
  const msg = document.createElement("div");
  msg.className = "msg";
  msg.textContent = opts.message;
  t.appendChild(msg);
  for (const w of (opts.warnings ?? []).slice(0, 3)) {
    const el = document.createElement("div");
    el.className = "warn";
    el.textContent = w;
    t.appendChild(el);
  }
  if (opts.action) {
    const b = document.createElement("button");
    b.textContent = opts.action.label;
    b.onclick = opts.action.run;
    t.appendChild(b);
  }
  l.appendChild(t);
  const timeout = opts.timeout ?? (opts.busy || opts.action ? 0 : 6000);
  if (timeout) toastTimer = setTimeout(() => t.remove(), timeout);
}

export function hideToast(): void {
  root?.querySelector(".toast")?.remove();
}

export function removeUi(): void {
  host?.remove();
  host = null;
  root = null;
}
