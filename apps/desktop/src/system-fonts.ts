// Installed font families, listed with the platform's own font APIs (no permission prompt).
//   macOS    NSFontManager through JavaScript for Automation (osascript)
//   Windows  System.Drawing.Text.InstalledFontCollection through PowerShell
//   Linux    fontconfig (fc-list)
import { execFile } from "node:child_process";

const MAC_SCRIPT = `ObjC.import("AppKit"); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies))`;
const WIN_SCRIPT =
  "Add-Type -AssemblyName System.Drawing; [Console]::OutputEncoding = [Text.Encoding]::UTF8; " +
  "(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }";

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout: 15_000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** Clean, de-duplicate and sort family names. Hidden system families (".SF NS") are dropped. */
export function normalizeFamilies(names: Iterable<string>): string[] {
  const seen = new Map<string, string>();
  for (const raw of names) {
    const name = raw.replace(/\\([-,\\])/g, "$1").trim();
    if (!name || name.startsWith(".") || name.length > 200) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

/** Parse `fc-list : family` output; each line can hold several comma-separated localized names. */
export function parseFcList(out: string): string[] {
  return out
    .split(/\r?\n/)
    .map((line) => line.split(/(?<!\\),/)[0] ?? "")
    .filter(Boolean);
}

async function listRaw(platform: NodeJS.Platform): Promise<string[]> {
  if (platform === "darwin") {
    const out = await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", MAC_SCRIPT]);
    const list: unknown = JSON.parse(out);
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  }
  if (platform === "win32") {
    const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WIN_SCRIPT]);
    return out.split(/\r?\n/);
  }
  return parseFcList(await run("fc-list", [":", "family"]));
}

let cache: Promise<string[]> | null = null;

/** Families on this computer. Cached for the session; an empty list when the platform tool fails. */
export function listSystemFonts(platform: NodeJS.Platform = process.platform): Promise<string[]> {
  cache ??= listRaw(platform)
    .then(normalizeFamilies)
    .catch((err: unknown) => {
      console.warn("[opencrease] could not list system fonts:", err instanceof Error ? err.message : err);
      cache = null;
      return [];
    });
  return cache;
}
