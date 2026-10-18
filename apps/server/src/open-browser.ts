import { spawn } from "node:child_process";

/** Open a URL in the default browser using the platform command. Never throws. */
export function openBrowser(url: string): void {
  if (process.env.OPENCREASE_NO_BROWSER === "1") return;
  let cmd: string;
  let args: string[];
  if (process.platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (process.platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url.replace(/&/g, "^&")];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // no browser available; the URL is printed by the CLI anyway
  }
}
