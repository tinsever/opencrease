// An isolated server and hidden editor, using the same bridge and tool executor as the desktop UI.
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright";
import { parseFold, type FoldDocument } from "@opencrease/model";
import { cookieName } from "./auth";
import { EDITOR_DIST_DIR } from "./config";
import { startServer, type RunningServer } from "./http";
import { launchChromium, shareBrowser } from "./render";
import type { CallTool } from "./tools";

const EDITOR_ROOT = fileURLToPath(new URL("../../editor", import.meta.url));

export async function readFold(path: string): Promise<FoldDocument> {
  return parseFold(await readFile(join(resolve(path), "document.json"), "utf8"));
}

export interface HeadlessSession {
  server: RunningServer;
  browser: Browser;
  page: Page;
  fileId?: string;
  callTool: CallTool;
  close(): Promise<void>;
}

/** Prefer the distributable editor; source checkouts can use Vite without spawning another process. */
export async function startHeadless(opts: { file?: string; workspaceDir?: string; exportDir?: string; port?: number; vitePort?: number; source?: boolean } = {}): Promise<HeadlessSession> {
  const file = opts.file ? resolve(opts.file) : undefined;
  const doc = file ? await readFold(file) : undefined;
  const root = opts.workspaceDir ?? (file ? dirname(file) : process.cwd());
  let vite: { close(): Promise<void> } | undefined;
  let server: RunningServer | undefined;
  let browser: Browser | undefined;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await browser?.close().catch(() => {});
    await server?.close();
    await vite?.close();
  };
  try {
    server = await startServer({ workspaceDir: root, port: opts.port ?? 0, approveAgents: false, workspaceOptions: { files: file ? [file] : undefined, exportDir: opts.exportDir }, openBrowser: () => {} });
    let editorUrl = server.url;
    const built = !opts.source && await access(join(EDITOR_DIST_DIR, "index.html")).then(() => true, () => false);
    if (!built) {
      const require = createRequire(join(EDITOR_ROOT, "package.json"));
      const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
      const target = server.url;
      // Override the dev config token hook: it targets the regular GUI port, while this
      // isolated session authenticates with its own cookie and may run alongside the GUI.
      const dev = await createServer({
        root: EDITOR_ROOT, configFile: join(EDITOR_ROOT, "vite.config.ts"), logLevel: "error",
        server: { host: "127.0.0.1", port: opts.vitePort ?? 0, strictPort: !!opts.vitePort, open: false, proxy: { "/api": { target, changeOrigin: false, configure: () => {} }, "/mcp": { target, changeOrigin: false, configure: () => {} }, "/auth": { target, changeOrigin: false, configure: () => {} }, "/bridge": { target: target.replace("http", "ws"), changeOrigin: false, ws: true, configure: () => {} } } },
      });
      vite = dev;
      await dev.listen();
      editorUrl = dev.resolvedUrls.local[0].replace(/\/$/, "");
    }
    browser = await launchChromium();
    shareBrowser(browser);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    // A CLI invocation explicitly authorises this isolated session. Cookies work for both
    // the built editor and Vite without forwarding credentials to external image hosts.
    await page.context().addCookies([{ name: cookieName(server.port), value: server.token, url: editorUrl, httpOnly: true, sameSite: "Strict" }]);
    const diagnostics: string[] = [];
    page.on("pageerror", (err) => diagnostics.push(err.message));
    page.on("console", (msg) => { if (msg.type() === "error") diagnostics.push(msg.text()); });
    await page.goto(`${editorUrl}${doc ? `/file/${doc.id}?headless=1` : "/?headless=1"}`, { waitUntil: "networkidle", timeout: 60_000 });
    const deadline = Date.now() + 15_000;
    while (!server.bridge.connected || (doc && !server.bridge.openFiles().some((f) => f.id === doc.id))) {
      if (Date.now() > deadline) throw new Error(`The headless editor did not connect to the tool bridge at ${editorUrl}: ${diagnostics.slice(-5).join("; ")}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    // Persist each completed write before returning it to the caller, including stdio clients that
    // disconnect immediately after a mutation. Autosave's debounce remains unchanged in the GUI.
    const running = server;
    let pending = Promise.resolve();
    const callTool: CallTool = (name, args, client) => {
      const run = pending.then(async () => {
        const result = await running.callTool(name, args, client ?? { name: "opencrease-cli" });
        return result;
      });
      pending = run.then(() => undefined, () => undefined);
      return run;
    };
    return { server, browser, page, fileId: doc?.id, callTool, close: async () => { await pending; await close(); } };
  } catch (err) {
    await close();
    throw err;
  }
}
