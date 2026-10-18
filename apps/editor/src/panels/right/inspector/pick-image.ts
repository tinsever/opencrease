// Opens a file picker, uploads the image into the file's assets and reports where it lives.
import { api } from "../../../state/api";
import { getOpenFile } from "../../../state/workspace";
export { assetHashOf } from "./asset-ref";

export interface PickedImage {
  /** URL usable in CSS url() and <img> */
  url: string;
  /** `asset://<hash>` reference (resolved at render) */
  ref: string;
  name: string;
}

export function pickImage(fileId: string, done: (img: PickedImage) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const meta = await api.uploadAsset(fileId, f, f.name);
      getOpenFile(fileId)?.store.transact("Add asset", (tx) => tx.addAsset(meta));
      done({ url: api.assetUrl(fileId, meta.hash), ref: `asset://${meta.hash}`, name: meta.name ?? f.name });
    } catch (e) {
      alert(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  input.click();
}
