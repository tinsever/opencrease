import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import schema from "../document.schema.json";
import { createDocument, normalizeDocument, serializeFold } from "./index";
import { readFoldDirectory, writeFoldDirectory } from "./fs";

const validate = new Ajv({ strict: false }).compile(schema);
describe("portable format", () => {
  it("validates the factory, legacy normalization and every committed fixture", async () => {
    const doc = createDocument("Portable");
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(normalizeDocument({ formatVersion: 1 }))).toBe(true);
    const fixtures = new URL("../../../tests/fixtures/", import.meta.url);
    for (const dir of await readdir(fixtures)) if (dir.endsWith(".fold")) {
      const fixture = JSON.parse(await readFile(new URL(`${dir}/document.json`, fixtures), "utf8"));
      expect(validate(fixture), `${dir}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
    expect(validate({ ...doc, formatVersion: 2 })).toBe(false);
    expect(validate({ ...doc, tokens: [{ id: "t", name: "bad", type: "colour", value: true }] })).toBe(false);
    expect(validate({ ...doc, nodes: { x: { type: "Script" } } })).toBe(false);
  });
  it("reads and writes deterministic .fold directories without an editor, preserving adjacent files", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "opencrease-format-"));
    try {
      const path = join(tmp, "Test.fold");
      const doc = createDocument("Portable");
      await writeFoldDirectory(path, doc);
      await writeFile(join(path, "guide.md"), "Keep me");
      await writeFoldDirectory(path, doc);
      expect(await readFoldDirectory(path)).toEqual(doc);
      expect(await readFile(join(path, "document.json"), "utf8")).toBe(serializeFold(doc).documentJson);
      expect(await readFile(join(path, "guide.md"), "utf8")).toBe("Keep me");
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });
});
