// Synthetic clipboard fixture, encoded with Kiwi. It is not a captured Figma clipboard sample.
import { compileSchema, encodeBinarySchema, parseSchema } from "kiwi-schema";
import { deflateSync } from "fflate";

export const fixtureSchema = parseSchema(`
struct GUID { uint sessionID; uint localID; }
struct Vector { float x; float y; }
struct Matrix { float m00; float m01; float m02; float m10; float m11; float m12; }
struct ParentIndex { GUID guid; string position; }
struct Color { float r; float g; float b; float a; }
struct FontName { string family; string style; string postscript; }
enum NodeType { FRAME = 1; TEXT = 2; VECTOR = 3; RECTANGLE = 4; }
enum PaintType { SOLID = 0; IMAGE = 1; }
enum StackMode { NONE = 0; HORIZONTAL = 1; VERTICAL = 2; }
message Image { uint dataBlob = 1; }
message Paint { PaintType type = 1; Color color = 2; Image image = 3; }
message TextData { string characters = 1; }
message Path { uint commandsBlob = 1; }
message Blob { byte[] bytes = 1; }
message NodeChange { GUID guid = 1; ParentIndex parentIndex = 2; NodeType type = 3; string name = 4; Vector size = 5; Matrix transform = 6; float fontSize = 7; Paint[] fillPaints = 8; FontName fontName = 9; TextData textData = 10; Path[] fillGeometry = 11; StackMode stackMode = 12; float stackSpacing = 13; }
message Message { NodeChange[] nodeChanges = 1; Blob[] blobs = 2; }
`);

const id = (localID: number) => ({ sessionID: 1, localID });
const transform = (x = 0, y = 0) => ({ m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y });
const solid = { type: "SOLID", color: { r: 1, g: Math.fround(0.3), b: 0, a: 1 } };
export const fixtureMessage = {
  nodeChanges: [
    { guid: id(1), type: "FRAME", name: "Figma card", size: { x: 360, y: 180 }, transform: transform(), stackMode: "HORIZONTAL", stackSpacing: 16 },
    { guid: id(2), parentIndex: { guid: id(1), position: "a" }, type: "TEXT", name: "Heading", size: { x: 200, y: 48 }, transform: transform(20, 20), fontSize: 24, fontName: { family: "Arial", style: "Bold", postscript: "Arial-BoldMT" }, textData: { characters: "Hello from Figma" }, fillPaints: [solid] },
    { guid: id(3), parentIndex: { guid: id(1), position: "b" }, type: "VECTOR", name: "Triangle", size: { x: 30, y: 30 }, transform: transform(240, 20), fillGeometry: [{ commandsBlob: 0 }], fillPaints: [solid] },
    { guid: id(4), parentIndex: { guid: id(1), position: "c" }, type: "RECTANGLE", name: "Photo", size: { x: 20, y: 20 }, fillPaints: [{ type: "IMAGE", image: { dataBlob: 1 } }] },
  ],
  blobs: [
    { bytes: pathFixture() },
    { bytes: Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)) },
  ],
};

export function pathFixture(): Uint8Array {
  const bytes = new Uint8Array(28);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const [op, x, y] of [[1, 0, 0], [2, 30, 0], [2, 15, 30]]) {
    bytes[offset++] = op;
    view.setFloat32(offset, x, true); view.setFloat32(offset + 4, y, true); offset += 8;
  }
  bytes[offset] = 0;
  return bytes;
}

export function encodedFixture(zstd = false): string {
  const codec = compileSchema(fixtureSchema) as { encodeMessage(message: unknown): Uint8Array };
  const message = codec.encodeMessage(fixtureMessage);
  let encoded = deflateSync(message);
  if (zstd) {
    // Single-segment Zstandard frame with an uncompressed block.
    encoded = new Uint8Array(12 + message.length);
    encoded.set([0x28, 0xb5, 0x2f, 0xfd, 0xa0]);
    const view = new DataView(encoded.buffer);
    view.setUint32(5, message.length, true);
    const block = (message.length << 3) | 1;
    encoded.set([block & 255, (block >>> 8) & 255, (block >>> 16) & 255], 9);
    encoded.set(message, 12);
  }
  const chunks = [deflateSync(encodeBinarySchema(fixtureSchema)), encoded];
  const archive = new Uint8Array(12 + chunks.reduce((sum, b) => sum + 4 + b.length, 0));
  archive.set(new TextEncoder().encode("fig-kiwi"));
  const view = new DataView(archive.buffer);
  view.setUint32(8, 15, true);
  let offset = 12;
  for (const chunk of chunks) { view.setUint32(offset, chunk.length, true); archive.set(chunk, offset + 4); offset += 4 + chunk.length; }
  const data = btoa(String.fromCharCode(...archive));
  return `<span data-metadata="<!--(figmeta)${btoa('{"fileKey":"synthetic"}')}(/figmeta)-->"></span><span data-buffer="<!--(figma)${data}(/figma)-->"></span>`;
}
