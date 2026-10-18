// DOM-free tool environment for model-level protocol and round-trip tests.
import { type DocStore, type Tx } from "@opencrease/model";
import type { ToolEnv } from "../env";

export function testEnv(store: DocStore): ToolEnv {
  return {
    fileId: store.doc.id, get doc() { return store.doc; }, client: { name: "conformance" },
    activePageId: Object.keys(store.doc.pages)[0]!, selection: [], editorUrl: (p) => `http://127.0.0.1${p}`,
    transact: <T>(fn: (tx: Tx) => T) => store.transact("Tool", fn, { origin: "agent" }),
    touch: () => {}, measure: () => null, computedStyle: () => null, settle: async () => {}, showPage: async () => {},
    screenshot: async () => { throw new Error("Use the browser suite for screenshots"); },
    exportNodes: async () => { throw new Error("Use the browser suite for exports"); },
    exportCombinedPdf: async () => { throw new Error("Use the browser suite for PDFs"); },
    fontFamilies: async () => ({ fontsPerFamily: {}, errors: [] }), fillImage: async () => { throw new Error("No DOM"); },
    assetMeta: async () => null, agentWork: () => ({}), releaseWork: () => {}, reviewed: () => {},
  };
}
