// Snapshot popup: connection status, capture modes, destination and options.
import type { CaptureMode } from "../snapshot/types";
import { loadSettings, saveSettings, type ContentState, type Destination, type Settings, type StatusMessage, type ToBackground, type ToContent } from "../shared/messages";
import { fetchStatus, type ServerStatus } from "../shared/server";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const IDLE_HINT = "Pick a section, or capture the visible area or the whole page.";
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

let settings: Settings;
let server: ServerStatus | null = null;
let tabId: number | null = null;
let capturable = true;

function setHint(text: string, tone: "idle" | "done" | "error" = "idle"): void {
  $("hint").textContent = text;
  $("foot").dataset.tone = tone;
}

function renderConnection(state: "checking" | "open" | "offline"): void {
  const conn = $("conn");
  conn.dataset.state = state;
  $("conn-text").textContent =
    state === "checking" ? "Looking for OpenCrease" : state === "open" ? (server?.authRequired ? "Session token needed" : server?.editorConnected ? "OpenCrease is open" : "OpenCrease is running") : "OpenCrease is not running";
}

function option(value: string, label: string, disabled = false): HTMLOptionElement {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  o.disabled = disabled;
  return o;
}

function renderDestinations(): void {
  const select = $<HTMLSelectElement>("destination");
  select.textContent = "";
  const online = server !== null && !server.authRequired;
  if (online && server) {
    const active = server.openFiles.find((f) => f.id === server?.activeFileId);
    select.append(option("active", active ? `${active.name} (open in OpenCrease)` : "The file open in OpenCrease"));
    for (const f of server.openFiles) if (f.id !== server.activeFileId) select.append(option(`file:${f.id}`, f.name));
    select.append(option("new", "New file"));
  } else {
    select.append(option("active", "OpenCrease is not running", true));
  }
  select.append(option("clipboard", "Clipboard, paste into OpenCrease"));
  let value: Destination = settings.destination;
  if (!online && value !== "clipboard") value = "clipboard";
  if (value.startsWith("file:") && !server?.openFiles.some((f) => `file:${f.id}` === value)) value = "active";
  select.value = value;
  renderOptions(value);
}

function renderOptions(dest: Destination): void {
  const tokens = $<HTMLInputElement>("color-tokens");
  tokens.disabled = dest === "clipboard";
  $("tokens-row").title = tokens.disabled ? "Colour tokens are created when sending to OpenCrease, not when copying." : "";
}

function renderModes(picking: boolean): void {
  $("mode-element").dataset.active = String(picking);
  $("picking-meta").textContent = picking ? "Picking" : "";
  for (const id of ["mode-element", "mode-viewport", "mode-page"]) $(id).setAttribute("aria-disabled", String(!capturable));
  if (picking) setHint("Click the highlighted section to capture it as editable layers.");
}

async function capture(mode: CaptureMode): Promise<void> {
  if (tabId === null || !capturable) return;
  const dest = $<HTMLSelectElement>("destination").value as Destination;
  settings = await saveSettings({ destination: dest });
  if (mode === "element") renderModes(true);
  else setHint(mode === "page" ? "Capturing the full page" : "Capturing the visible area");
  const res = (await chrome.runtime.sendMessage({ type: "capture", mode, tabId } satisfies ToBackground)) as { ok: boolean; message?: string } | undefined;
  if (!res?.ok) {
    renderModes(false);
    setHint(res?.message ?? "This page cannot be captured.", "error");
    return;
  }
  // the popup closes as soon as the page is clicked; close it now so the page gets the hover events
  if (mode === "element") window.close();
}

async function refreshServer(): Promise<void> {
  server = await fetchStatus(settings.port, settings.token);
  renderConnection(server ? "open" : "offline");
  renderDestinations();
}

function setupPort(): void {
  const button = $<HTMLButtonElement>("port-button");
  const input = $<HTMLInputElement>("port-input");
  $("port-value").textContent = String(settings.port);
  button.onclick = () => {
    button.hidden = true;
    input.hidden = false;
    input.value = String(settings.port);
    input.focus();
    input.select();
  };
  const commit = async () => {
    const port = Math.round(Number(input.value));
    input.hidden = true;
    button.hidden = false;
    if (!Number.isFinite(port) || port < 1 || port > 65535 || port === settings.port) return;
    settings = await saveSettings({ port });
    $("port-value").textContent = String(port);
    renderConnection("checking");
    await refreshServer();
  };
  input.onblur = () => void commit();
  input.onkeydown = (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      input.value = String(settings.port);
      input.blur();
    }
  };
}

async function init(): Promise<void> {
  settings = await loadSettings();
  const tokenInput = $<HTMLInputElement>("session-token");
  tokenInput.value = settings.token ?? "";
  tokenInput.onchange = () => void saveSettings({ token: tokenInput.value.trim() }).then(async (next) => { settings = next; await refreshServer(); });
  $("page-shortcut").textContent = isMac ? "⌘↵" : "Ctrl ↵";
  $<HTMLInputElement>("keep-fonts").checked = settings.keepFonts;
  $<HTMLInputElement>("color-tokens").checked = settings.colorTokens;
  $<HTMLInputElement>("keep-fonts").onchange = (e) => void saveSettings({ keepFonts: (e.target as HTMLInputElement).checked }).then((s) => (settings = s));
  $<HTMLInputElement>("color-tokens").onchange = (e) => void saveSettings({ colorTokens: (e.target as HTMLInputElement).checked }).then((s) => (settings = s));
  $<HTMLSelectElement>("destination").onchange = (e) => {
    const dest = (e.target as HTMLSelectElement).value as Destination;
    renderOptions(dest);
    void saveSettings({ destination: dest }).then((s) => (settings = s));
  };
  $("mode-element").onclick = () => void capture("element");
  $("mode-viewport").onclick = () => void capture("viewport");
  $("mode-page").onclick = () => void capture("page");
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void capture("page");
    }
  });
  setupPort();
  renderConnection("checking");
  renderDestinations();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  capturable = !!tab?.url && /^(https?|file):/.test(tab.url);
  renderModes(false);
  if (!capturable) setHint("Browser pages and the extension store cannot be captured. Open a website first.", "error");
  else if (tabId !== null) {
    try {
      const state = (await chrome.tabs.sendMessage(tabId, { type: "state" } satisfies ToContent)) as ContentState | undefined;
      if (state?.picking) renderModes(true);
      else if (state?.busy) setHint("Capturing the page");
    } catch {
      // content script not injected yet: idle
    }
  }
  await refreshServer();
}

chrome.runtime.onMessage.addListener((raw: unknown) => {
  const msg = raw as StatusMessage;
  if (msg?.type !== "status") return;
  renderModes(msg.phase === "picking");
  setHint(msg.text || IDLE_HINT, msg.phase === "error" ? "error" : msg.phase === "done" ? "done" : "idle");
});

void init();
