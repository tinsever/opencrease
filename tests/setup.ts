// Never let tests read or write the user's real OpenCrease configuration.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
const home = mkdtempSync(join(tmpdir(), "opencrease-unit-home-"));
process.env.OPENCREASE_HOME = home;
delete process.env.OPENCREASE_TOKEN;
afterAll(() => rmSync(home, { recursive: true, force: true }));
