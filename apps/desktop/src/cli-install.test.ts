import { execFile } from "node:child_process";
import { mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminAppleScript, linkState, linkUserCli, onPath, posixLauncher, windowsLauncher, writeLauncher, type LauncherSpec } from "./cli-install";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "of-cli-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const spec = (over: Partial<LauncherSpec> = {}): LauncherSpec => ({
  exec: process.execPath,
  cliEntry: "/x/cli.mjs",
  appLaunch: ["/Applications/Open Fold.app/Contents/MacOS/OpenCrease"],
  editorDist: "/x/editor",
  guidesDir: "/x/guides",
  ...over,
});

describe("launcher", () => {
  it("quotes paths with spaces and quotes for sh", () => {
    const s = posixLauncher(spec({ cliEntry: "/it's here/cli.mjs" }));
    expect(s.startsWith("#!/bin/sh\n")).toBe(true);
    expect(s).toContain(`'/it'\\''s here/cli.mjs' "$@"`);
    expect(s).toContain(`OPENCREASE_DESKTOP_LAUNCH='["/Applications/Open Fold.app/Contents/MacOS/OpenCrease"]'`);
    expect(windowsLauncher(spec())).toContain('%*');
  });

  it.skipIf(process.platform === "win32")("runs the CLI with the given binary and environment", async () => {
    const cli = join(dir, "it's cli.mjs");
    await writeFile(cli, "console.log(JSON.stringify({ argv: process.argv.slice(2), launch: process.env.OPENCREASE_DESKTOP_LAUNCH, dist: process.env.OPENCREASE_EDITOR_DIST }));");
    const path = await writeLauncher(join(dir, "bin"), spec({ cliEntry: cli }));
    expect((await stat(path)).mode & 0o111).toBeTruthy();
    const { stdout } = await promisify(execFile)(path, ["mcp", "--port", "1 2"]);
    expect(JSON.parse(stdout)).toEqual({ argv: ["mcp", "--port", "1 2"], launch: JSON.stringify(spec().appLaunch), dist: "/x/editor" });
  });
});

describe("linking", () => {
  it.skipIf(process.platform === "win32")("links into a user folder and reports the state", async () => {
    const launcher = join(dir, "launcher");
    await writeFile(launcher, "#!/bin/sh\n");
    const link = join(dir, "home", ".local", "bin", "opencrease");
    expect(await linkState(link, launcher)).toBe("missing");
    await linkUserCli(launcher, link);
    expect(await readlink(link)).toBe(launcher);
    expect(await linkState(link, launcher)).toBe("ours");
    await linkUserCli(launcher, link); // idempotent
    expect(await linkState(link, launcher)).toBe("ours");
    await rm(link);
    await writeFile(link, "npm shim");
    expect(await linkState(link, launcher)).toBe("other");
    expect(await readFile(link, "utf8")).toBe("npm shim");
  });

  it("builds an escaped admin script", () => {
    expect(adminAppleScript("/Users/me/Library/Application Support/OpenCrease/bin/opencrease", "/usr/local/bin/opencrease")).toBe(
      `do shell script "/bin/mkdir -p '/usr/local/bin' && /bin/ln -sfn '/Users/me/Library/Application Support/OpenCrease/bin/opencrease' '/usr/local/bin/opencrease'" with administrator privileges`,
    );
    expect(adminAppleScript('/a"b', "/l")).toContain(`'/a\\"b'`);
  });

  it("checks PATH entries", () => {
    expect(onPath("/home/me/.local/bin", "/usr/bin:/home/me/.local/bin/", "linux")).toBe(true);
    expect(onPath("/home/me/.local/bin", "/usr/bin", "linux")).toBe(false);
  });
});
