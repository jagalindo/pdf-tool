/* eslint-disable no-restricted-globals */
import { PDFDocument } from "pdf-lib";
import { postError, postProgress, postResult, type WorkerRequest } from "./messages";

// Vite will rewrite this to a hashed asset that respects BASE_URL.
const resolveWasmUrl = (raw: string) => {
  const fileName = raw.split("/").pop() ?? "module.wasm";
  const envBase = (import.meta as any).env?.BASE_URL ?? "/";
  const candidates = [raw];
  if (raw.startsWith("/") && envBase !== "/" && !raw.startsWith(envBase)) {
    candidates.push(`${envBase.replace(/\/$/, "")}${raw}`);
  }
  if (typeof self !== "undefined" && self.location) {
    const locBase = self.location.pathname.replace(/\/[^/]*$/, "/");
    candidates.push(`${locBase.replace(/\/$/, "")}/assets/${fileName}`);
  }
  return candidates[0];
};

const rawMupdfWasmUrl = new URL("../../node_modules/mupdf/dist/mupdf-wasm.wasm", import.meta.url).href;
const rawQpdfWasmUrl = new URL("../../node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm", import.meta.url).href;
const mupdfWasmUrl = resolveWasmUrl(rawMupdfWasmUrl);
const qpdfWasmUrl = resolveWasmUrl(rawQpdfWasmUrl);

let qpdfReady: Promise<any> | null = null;
let qpdfRunId = 0;

async function getQpdf() {
  if (!qpdfReady) {
    qpdfReady = (async () => {
      const qpdfMod: any = await import("@neslinesli93/qpdf-wasm");
      const createQpdf = qpdfMod.default ?? qpdfMod;
      if (typeof createQpdf !== "function") throw new Error("qpdf-wasm module factory not found.");
      const qpdf = await createQpdf({
        locateFile: (path: string) => (path.endsWith(".wasm") ? qpdfWasmUrl : path),
        noInitialRun: true,
        preRun: [
          (mod: any) => {
            try {
              mod.FS.mkdir("/in");
              mod.FS.mkdir("/out");
            } catch {
              /* ignore if exists */
            }
          },
        ],
      });
      return qpdf;
    })();
  }
  return qpdfReady;
}

async function decryptPdf(bytes: ArrayBuffer, password?: string, label?: string): Promise<Uint8Array> {
  const qpdf = await getQpdf();
  const inName = `in_${++qpdfRunId}.pdf`;
  const outName = `out_${qpdfRunId}.pdf`;
  try {
    qpdf.FS.writeFile(`/in/${inName}`, new Uint8Array(bytes));
    const pwdArg = password ? `--password=${password}` : "--password=";
    const args = ["--decrypt", pwdArg, `/in/${inName}`, `/out/${outName}`];
    qpdf.callMain(args);
    const outBytes: Uint8Array | undefined = qpdf.FS.readFile(`/out/${outName}`);
    if (!outBytes) throw new Error("Decryption produced no output.");
    return outBytes;
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (/password/i.test(msg)) {
      throw new Error(`"${label ?? "PDF"}" is password-protected. Provide the correct password and try again.`);
    }
    throw new Error(`Failed to open ${label ?? "PDF"} (${msg})`);
  } finally {
    try {
      qpdf.FS.unlink(`/in/${inName}`);
      qpdf.FS.unlink(`/out/${outName}`);
    } catch {
      /* ignore cleanup errors */
    }
  }
}

/**
 * Engine worker: runs CPU-heavy tasks off the main thread.
 * - Merge/Split via pdf-lib (JS, reliable)
 * - Compress via qpdf-wasm (WASM) with reasonable defaults
 * - PDF->Images via MuPDF (WASM)
 *
 * Notes:
 * - This is 100% client-side: files never leave the browser.
 * - Some WASM engines are large; first run may take a few seconds to initialize.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function dosDateTime(d = new Date()) {
  const time =
    (d.getHours() << 11) |
    (d.getMinutes() << 5) |
    Math.floor(d.getSeconds() / 2);
  const date =
    ((d.getFullYear() - 1980) << 9) |
    ((d.getMonth() + 1) << 5) |
    d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

/**
 * Minimal ZIP (store) encoder.
 * Avoids external deps; enough for small batches of images.
 */
function buildZip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const { time, date } = dosDateTime();
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + nameBytes.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); // local header signature
    l.setUint16(4, 20, true); // version needed
    l.setUint16(6, 0, true); // flags
    l.setUint16(8, 0, true); // method: store
    l.setUint16(10, time, true);
    l.setUint16(12, date, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, entry.data.length, true);
    l.setUint32(22, entry.data.length, true);
    l.setUint16(26, nameBytes.length, true);
    l.setUint16(28, 0, true); // extra len
    local.set(nameBytes, 30);

    locals.push(local, entry.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); // central header signature
    c.setUint16(4, 20, true); // version made by
    c.setUint16(6, 20, true); // version needed
    c.setUint16(8, 0, true); // flags
    c.setUint16(10, 0, true); // method
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, entry.data.length, true);
    c.setUint32(24, entry.data.length, true);
    c.setUint16(28, nameBytes.length, true);
    c.setUint16(30, 0, true); // extra len
    c.setUint16(32, 0, true); // comment len
    c.setUint16(34, 0, true); // disk start
    c.setUint16(36, 0, true); // internal attrs
    c.setUint32(38, 0, true); // external attrs
    c.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    centrals.push(central);
    offset += local.length + entry.data.length;
  }

  const centralDir = concatBytes(centrals);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); // end of central dir signature
  e.setUint16(4, 0, true); // disk number
  e.setUint16(6, 0, true); // start disk
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, centralDir.length, true);
  e.setUint32(16, offset, true);
  e.setUint16(20, 0, true); // comment length

  return concatBytes([...locals, centralDir, end]);
}

function formatRangeLabel(nums: number[]) {
  const sorted = Array.from(new Set(nums)).sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `p${start}` : `p${start}-${prev}`);
    start = prev = n;
  }
  if (sorted.length) parts.push(start === prev ? `p${start}` : `p${start}-${prev}`);
  return parts.join("_");
}

async function merge(jobId: string, files: Array<{ name: string; bytes: ArrayBuffer; password?: string }>) {
  postProgress(jobId, 5, "Loading PDFs…");
  const out = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    postProgress(jobId, 10 + Math.floor((i / files.length) * 60), `Importing ${f.name}…`);
    const unlocked = await decryptPdf(f.bytes, f.password, f.name);
    const doc = await PDFDocument.load(unlocked, { ignoreEncryption: true });
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }

  postProgress(jobId, 80, "Saving…");
  const bytes = await out.save({ useObjectStreams: true });
  postProgress(jobId, 100, "Done");
  postResult(jobId, "merged.pdf", bytes.buffer, "application/pdf");
}

async function split(jobId: string, file: { name: string; bytes: ArrayBuffer; password?: string }, pages: number[], ranges: number[][], output: "single" | "zip") {
  postProgress(jobId, 5, "Loading PDF…");
  const unlocked = await decryptPdf(file.bytes, file.password, file.name);
  const src = await PDFDocument.load(unlocked, { ignoreEncryption: true });
  const pageCount = src.getPageCount();
  const normalize = (list: number[]) =>
    Array.from(new Set(list.map((p) => p - 1).filter((p) => p >= 0 && p < pageCount))).sort((a, b) => a - b);
  const indices = normalize(pages);

  if (indices.length === 0) throw new Error("No valid pages selected.");

  if (output === "zip") {
    const entries: Array<{ name: string; data: Uint8Array }> = [];
    const base = file.name.replace(/\.pdf$/i, "") || "document";
    const normalizedRanges = (ranges?.length ? ranges : [pages]).map(normalize).filter((r) => r.length);

    for (let i = 0; i < normalizedRanges.length; i++) {
      const range = normalizedRanges[i];
      const humanPages = range.map((p) => p + 1);
      postProgress(jobId, 10 + Math.floor((i / normalizedRanges.length) * 60), `Extrayendo páginas ${humanPages.join(",")}…`);
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, range);
      copied.forEach((p) => out.addPage(p));
      const bytes = await out.save({ useObjectStreams: true });
      const label = formatRangeLabel(humanPages) || `range${i + 1}`;
      entries.push({ name: `${base}_${label}.pdf`, data: bytes });
    }

    postProgress(jobId, 85, "Creando ZIP…");
    const zipBytes = buildZip(entries);
    postProgress(jobId, 100, "Done");
    postResult(jobId, `${base}_pages.zip`, zipBytes.buffer, "application/zip");
    return;
  }

  postProgress(jobId, 40, "Extracting pages…");
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));

  postProgress(jobId, 80, "Saving…");
  const bytes = await out.save({ useObjectStreams: true });
  postProgress(jobId, 100, "Done");
  postResult(jobId, "split_pages.pdf", bytes.buffer, "application/pdf");
}

/**
 * “Decent” compression approach (client-side):
 * - Use qpdf (WASM) to rewrite the file with object streams and stream compression.
 * - This often reduces size a bit, and improves structure; not as strong as Ghostscript.
 */
async function compress(jobId: string, file: { name: string; bytes: ArrayBuffer; password?: string }, level: "small"|"balanced"|"best") {
  postProgress(jobId, 5, "Initializing qpdf (WASM)…");

  const qpdf = await getQpdf();
  const unlocked = await decryptPdf(file.bytes, file.password, file.name);

  const inName = `in_${++qpdfRunId}.pdf`;
  const outName = `out_${qpdfRunId}.pdf`;

  // Map level to qpdf flags. These are conservative, broadly compatible.
  // - object streams + stream compression
  const argsBase = [
    "--object-streams=generate",
    "--stream-data=compress",
  ];

  // Some qpdf builds also support '--compression-level', but not all.
  const levelArgs =
    level === "small" ? ["--recompress-flate"] :
    level === "best" ? ["--recompress-flate"] :
    ["--recompress-flate"];

  const args = [...argsBase, ...levelArgs, `/in/${inName}`, `/out/${outName}`];

  postProgress(jobId, 30, "Rewriting PDF…");
  qpdf.FS.writeFile(`/in/${inName}`, new Uint8Array(unlocked));
  qpdf.callMain(args);

  let outBytes: Uint8Array | undefined;
  try {
    outBytes = qpdf.FS.readFile(`/out/${outName}`);
  } catch (err) {
    console.error("qpdf read error", err);
  }

  if (!outBytes) {
    throw new Error("qpdf-wasm returned no output (out.pdf missing).");
  }

  try {
    qpdf.FS.unlink(`/in/${inName}`);
    qpdf.FS.unlink(`/out/${outName}`);
  } catch {
    /* ignore cleanup errors */
  }

  postProgress(jobId, 100, "Done");
  postResult(jobId, `compressed_${file.name.replace(/\.pdf$/i, "")}.pdf`, outBytes.buffer, "application/pdf");
}

/**
 * PDF -> Images:
 * Uses official MuPDF.js (WASM).
 * Now outputs a ZIP with all pages as PNG/JPG.
 */
async function pdf2img(jobId: string, file: { name: string; bytes: ArrayBuffer; password?: string }, format: "png"|"jpg", dpi: number) {
  postProgress(jobId, 5, "Initializing MuPDF (WASM)…");
  // Ensure WASM is fetched from the correct URL (respects Vite base).
  (globalThis as any)["$libmupdf_wasm_Module"] = {
    locateFile: (path: string) => path.endsWith(".wasm") ? mupdfWasmUrl : path,
  };
  const mupdf: any = await import("mupdf"); // ESM-only per docs

  const unlocked = await decryptPdf(file.bytes, file.password, file.name);
  const doc = mupdf.Document.openDocument(unlocked, "pdf");
  const total = doc.countPages();
  if (!total) throw new Error("PDF has no pages.");

  const entries: Array<{ name: string; data: Uint8Array }> = [];
  const scale = dpi / 72;

  for (let i = 0; i < total; i++) {
    postProgress(jobId, 10 + Math.floor((i / total) * 70), `Rendering page ${i + 1}…`);
    const page = doc.loadPage(i);
    const pix = page.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, format === "png");
    const data: Uint8Array = format === "jpg" ? pix.asJPEG(85) : pix.asPNG();
    entries.push({ name: `page_${String(i + 1).padStart(3, "0")}.${format}`, data });

    pix.destroy?.();
    page.destroy?.();
  }

  postProgress(jobId, 85, "Packaging ZIP…");
  const zipBytes = buildZip(entries);
  const base = file.name.replace(/\.pdf$/i, "") || "document";
  const outName = `${base}_images_${format}.zip`;

  postProgress(jobId, 100, "Done");
  postResult(jobId, outName, zipBytes.buffer, "application/zip");
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === "merge") {
      await merge(msg.jobId, msg.files);
    } else if (msg.type === "split") {
      await split(msg.jobId, msg.file, msg.pages, msg.ranges, msg.output);
    } else if (msg.type === "compress") {
      await compress(msg.jobId, msg.file, msg.level);
    } else if (msg.type === "pdf2img") {
      await pdf2img(msg.jobId, msg.file, msg.format, msg.dpi);
    } else {
      throw new Error("Unknown worker request");
    }
  } catch (e: any) {
    postError((msg as any).jobId ?? "unknown", e?.message ?? String(e));
  }
};
