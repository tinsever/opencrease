import { describe, expect, it, vi } from "vitest";
import { createDocument } from "@opencrease/model";
vi.hoisted(() => { vi.stubGlobal("window", { addEventListener() {} }); });
vi.mock("./api", () => ({ api: { getFile: vi.fn(), saveFile: vi.fn() } }));
import { api } from "./api";
import { getOpenFile, openFile, reloadFile, setSelection } from "./workspace";

describe("disk reload during a paste", () => {
  it("keeps edits, selection and undo history made during the disk read", async () => {
    const doc = createDocument("Paste race", { id: "paste-race" });
    vi.mocked(api.getFile).mockResolvedValueOnce(doc);
    const file = await openFile(doc.id, undefined, { focus: false });
    let finish!: (doc: typeof file.store.doc) => void;
    vi.mocked(api.getFile).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = reloadFile(doc.id);
    const root = Object.values(doc.pages)[0].rootId;
    const [id] = file.store.transact("Paste", (tx) => tx.insertTrees(root, [{ type: "Rectangle", styles: { width: 40, height: 40 } }]));
    setSelection(doc.id, [id]);
    finish(doc);
    await pending;
    expect(getOpenFile(doc.id)?.selection).toEqual([id]);
    expect(file.store.doc.nodes[id]).toBeDefined();
    expect(file.store.canUndo).toBe(true);
  });
});
