// Figma's clipboard archive carries its own Kiwi schema. Interpret it as data rather than compiling
// clipboard-provided names into JavaScript. Format references and dependency licences: docs/IMPORT.md.
import { ByteBuffer, decodeBinarySchema, type Field, type Schema } from "kiwi-schema";
import { inflateSync } from "fflate";
import { Decompress } from "fzstd";

export type KiwiRecord = Record<string, unknown>;
const MAX_BYTES = 64 * 1024 * 1024;

export function isFigmaHtml(html: string): boolean {
  return html.includes("<!--(figma)");
}

function base64(value: string): Uint8Array {
  if (value.length > MAX_BYTES) throw new Error("The Figma clipboard is too large.");
  return Uint8Array.from(atob(value.replace(/\s/g, "")), (c) => c.charCodeAt(0));
}

function section(html: string, name: string): string | undefined {
  return new RegExp(`<!--\\(${name}\\)([\\s\\S]*?)\\(/${name}\\)-->`).exec(html)?.[1];
}

/** Bounded, schema-driven Kiwi decoder. No eval, generated functions or prototype-bearing records. */
export function decodeKiwi(schema: Schema, bytes: Uint8Array): KiwiRecord {
  const bb = new ByteBuffer(bytes);
  const definitions = new Map(schema.definitions.map((d) => [d.name, d]));
  const fields = new Map(schema.definitions.map((d) => [d.name, new Map(d.fields.map((f) => [f.value, f]))]));
  let budget = 2_000_000;
  const value = (type: string | null, depth: number): unknown => {
    if (--budget < 0 || depth > 100) throw new Error("The Figma clipboard is too complex.");
    switch (type) {
      case "bool": return !!bb.readByte();
      case "byte": return bb.readByte();
      case "int": return bb.readVarInt();
      case "uint": return bb.readVarUint();
      case "int64": return bb.readVarInt64();
      case "uint64": return bb.readVarUint64();
      case "float": return bb.readVarFloat();
      case "string": return bb.readString();
    }
    const def = definitions.get(type ?? "");
    if (!def) throw new Error(`Unknown Kiwi type: ${type}`);
    if (def.kind === "ENUM") {
      const index = bb.readVarUint();
      return fields.get(def.name)?.get(index)?.name ?? index;
    }
    const out: KiwiRecord = Object.create(null);
    const read = (f: Field) => {
      let result: unknown;
      if (!f.isArray) result = value(f.type, depth + 1);
      else if (f.type === "byte") result = bb.readByteArray();
      else {
        const count = bb.readVarUint();
        if (count > budget) throw new Error("The Figma clipboard has too many values.");
        result = Array.from({ length: count }, () => value(f.type, depth + 1));
      }
      if (!f.isDeprecated) out[f.name] = result;
    };
    if (def.kind === "STRUCT") def.fields.forEach(read);
    else if (def.kind === "MESSAGE") {
      for (let key = bb.readVarUint(); key !== 0; key = bb.readVarUint()) {
        if (--budget < 0) throw new Error("The Figma clipboard has too many fields.");
        const field = fields.get(def.name)?.get(key);
        if (!field) throw new Error(`Unknown Kiwi field ${key} in ${def.name}`);
        read(field);
      }
    } else throw new Error("Invalid Kiwi definition.");
    return out;
  };
  return value("Message", 0) as KiwiRecord;
}

export function decodeFigmaHtml(html: string): { message: KiwiRecord; meta: KiwiRecord } {
  const encoded = section(html, "figma");
  if (!encoded) throw new Error("The Figma clipboard has no data buffer.");
  const data = base64(encoded);
  if (new TextDecoder().decode(data.subarray(0, 8)) !== "fig-kiwi") throw new Error("Unsupported Figma clipboard format.");
  if (data.length < 20) throw new Error("Truncated Figma clipboard.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 12; // eight-byte magic followed by the archive version
  const chunk = () => {
    if (offset + 4 > data.length) throw new Error("Truncated Figma archive.");
    const length = view.getUint32(offset, true);
    offset += 4;
    if (!length || offset + length > data.length) throw new Error("Invalid Figma archive chunk.");
    const bytes = data.subarray(offset, offset + length);
    offset += length;
    return bytes;
  };
  const unpack = (bytes: Uint8Array, max: number) => {
    const zstd = bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd;
    let result: Uint8Array;
    if (zstd) {
      const chunks: Uint8Array[] = [];
      let length = 0;
      new Decompress((chunk) => {
        length += chunk.length;
        if (length > max) throw new Error("The decompressed Figma clipboard is too large.");
        chunks.push(chunk.slice());
      }).push(bytes, true);
      result = new Uint8Array(length);
      let at = 0;
      for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
    } else result = inflateSync(bytes, { out: new Uint8Array(max + 1) });
    if (result.length > max) throw new Error("The decompressed Figma clipboard is too large.");
    return result;
  };
  const schema = decodeBinarySchema(unpack(chunk(), 4 * 1024 * 1024));
  const message = decodeKiwi(schema, unpack(chunk(), MAX_BYTES));
  const metadata = section(html, "figmeta");
  let meta: KiwiRecord = {};
  if (metadata) {
    try { meta = JSON.parse(new TextDecoder().decode(base64(metadata))) as KiwiRecord; }
    catch { /* Metadata is optional and does not affect node decoding. */ }
  }
  return { message, meta };
}
