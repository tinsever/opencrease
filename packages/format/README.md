# @opencrease/format

MIT-licensed, editor-independent types, deterministic JSON serialisation and normalization for OpenCrease's unpacked `.fold` directory format. No runtime dependencies. The pure entry point works in browsers and Node.

```ts
import { createDocument, parseFold, serializeFold } from "@opencrease/format";
const doc = createDocument("Field notes");
const { manifest, documentJson } = serializeFold(doc);
const restored = parseFold(documentJson);
```

Node directory I/O is a separate entry point:

```ts
import { readFoldDirectory, writeFoldDirectory } from "@opencrease/format/node";
await writeFoldDirectory("./Field notes.fold", doc);
const loaded = await readFoldDirectory("./Field notes.fold");
```

Writes update `manifest.json`, `document.json` and `tokens.css`, preserving adjacent assets, guides and history. Callers copy asset bytes separately. `document.json` is authoritative in format v1; there is no CRDT binary or ZIP implementation yet.

The published package subpath `@opencrease/format/document.schema.json` contains the Draft-07 JSON Schema. Validate serialized documents with a standard JSON Schema validator. Parsing additionally repairs missing legacy defaults, dangling references and structurally invalid trees. Schema validation and normalization serve different purposes; normalization is not an untrusted-HTML sanitizer.

`@opencrease/model` re-exports these contracts for source compatibility and retains transactions, undo and live queries. New format-only consumers should depend on this package directly.
