import { describe, expect, it } from "vitest";
import { compileSchema, parseSchema } from "kiwi-schema";
import { DocStore, createDocument } from "@opencrease/model";
import { decodeFigmaHtml, decodeKiwi, isFigmaHtml } from "./figma-kiwi";
import { figmaMessageToTrees, importFigmaHtml, pathData } from "./figma";
import { encodedFixture, fixtureMessage, fixtureSchema, pathFixture } from "./figma.fixture";

describe("Figma clipboard Kiwi decoding (synthetic fixture)", () => {
  it.each([false, true])("decodes embedded schemas and %s Zstandard messages", (zstd) => {
    const html = encodedFixture(zstd);
    expect(isFigmaHtml(html)).toBe(true);
    const { message, meta } = decodeFigmaHtml(html);
    expect(meta.fileKey).toBe("synthetic");
    expect(message).toEqual(fixtureMessage);
  });

  it("matches the reference codec and safely handles schema field names", () => {
    const codec = compileSchema(fixtureSchema) as { encodeMessage(m: unknown): Uint8Array };
    expect(decodeKiwi(fixtureSchema, codec.encodeMessage(fixtureMessage))).toEqual(fixtureMessage);
    const schema = parseSchema("message Message { string value = 1; }")
    schema.definitions[0].fields[0].name = "constructor";
    const record = decodeKiwi(schema, new Uint8Array([1, 120, 0, 0]));
    expect(Object.getPrototypeOf(record)).toBe(null);
    expect(record.constructor).toBe("x");
  });

  it("rejects malformed archives, truncated messages and oversized arrays", () => {
    expect(() => decodeFigmaHtml("<!--(figma)YQ==(/figma)-->")).toThrow("Unsupported");
    expect(() => decodeFigmaHtml("<!--(figma)!!!!(/figma)-->")).toThrow();
    expect(() => decodeKiwi(fixtureSchema, new Uint8Array([255]))).toThrow();
    expect(() => decodeKiwi(parseSchema("message Message { uint[] values = 1; }"), new Uint8Array([1, 255, 255, 255, 127]))).toThrow("too many");
  });
});

describe("Figma node conversion", () => {
  it("imports frames, flex, text, path geometry and embedded image bytes into valid model trees", () => {
    const { trees, warnings } = importFigmaHtml(encodedFixture());
    expect(warnings).toEqual([]);
    expect(trees[0]).toMatchObject({ type: "Frame", name: "Figma card", styles: { display: "flex", flexDirection: "row", gap: 16 } });
    const children = trees[0].children!;
    expect(children[0]).toMatchObject({ type: "Text", text: "Hello from Figma", styles: { fontWeight: 700 } });
    expect(children[0].styles).not.toHaveProperty("left");
    expect(children[1]).toMatchObject({ type: "SVG", children: [{ tag: "path", attrs: { d: "M0 0 L30 0 L15 30 Z" } }] });
    expect(children[2]).toMatchObject({ type: "Image", src: expect.stringContaining("data:image/png;base64,") });
    const store = new DocStore(createDocument("Imported"));
    const root = Object.values(store.doc.pages)[0].rootId;
    store.transact("Paste", (tx) => tx.insertTrees(root, trees));
    expect(Object.keys(store.doc.nodes).length).toBe(6);
    store.undo();
    expect(store.doc.nodes[root].children).toEqual([]);
  });

  it("reports missing vector and image content and rejects hierarchy cycles", () => {
    const input = structuredClone(fixtureMessage);
    input.blobs = [];
    expect(figmaMessageToTrees(input).warnings).toHaveLength(2);
    const cycle = { nodeChanges: [{ guid: { sessionID: 1, localID: 1 }, parentIndex: { guid: { sessionID: 1, localID: 1 } }, type: "FRAME" }] };
    expect(() => figmaMessageToTrees(cycle)).toThrow("no root");
    expect(pathData(pathFixture())).toBe("M0 0 L30 0 L15 30 Z");
    expect(() => pathData(new Uint8Array([4, 1]))).toThrow();
  });
});
