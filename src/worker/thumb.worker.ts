/* eslint-disable no-restricted-globals */
const mupdfWasmUrl = new URL("../../node_modules/mupdf/dist/mupdf-wasm.wasm", import.meta.url).href;

let mupdfInst: any = null;

async function getMupdf() {
  if (!mupdfInst) {
    (globalThis as any)["$libmupdf_wasm_Module"] = {
      locateFile: (p: string) => p.endsWith(".wasm") ? mupdfWasmUrl : p,
    };
    mupdfInst = await import("mupdf");
  }
  return mupdfInst;
}

export type ThumbRequest = { fileKey: string; bytes: ArrayBuffer };
export type ThumbEvent =
  | { type: "thumb"; fileKey: string; index: number; jpeg: ArrayBuffer; total: number }
  | { type: "thumbDone"; fileKey: string; total: number }
  | { type: "thumbError"; fileKey: string; message: string };

self.onmessage = async (ev: MessageEvent<ThumbRequest>) => {
  const { fileKey, bytes } = ev.data;
  try {
    const mupdf = await getMupdf();
    const doc = mupdf.Document.openDocument(new Uint8Array(bytes), "pdf");
    const total: number = doc.countPages();
    if (!total) { doc.destroy?.(); (self as any).postMessage({ type: "thumbDone", fileKey, total: 0 }); return; }

    for (let i = 0; i < total; i++) {
      const page = doc.loadPage(i);
      const bounds = page.getBounds();
      const pw = Math.abs(bounds[2] - bounds[0]);
      const ph = Math.abs(bounds[3] - bounds[1]);
      // Scale so the longer dimension is ≤ 160px
      const scale = 160 / Math.max(pw, ph, 1);
      const pix = page.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, false);
      const jpeg: Uint8Array = pix.asJPEG(72);
      pix.destroy?.();
      page.destroy?.();
      (self as any).postMessage(
        { type: "thumb", fileKey, index: i, jpeg: jpeg.buffer, total } as ThumbEvent,
        [jpeg.buffer],
      );
    }
    doc.destroy?.();
    (self as any).postMessage({ type: "thumbDone", fileKey, total } as ThumbEvent);
  } catch (e: any) {
    (self as any).postMessage({ type: "thumbError", fileKey, message: e?.message ?? String(e) } as ThumbEvent);
  }
};
