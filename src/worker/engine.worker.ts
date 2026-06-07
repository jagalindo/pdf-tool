/* eslint-disable no-restricted-globals */
import { PDFDocument, degrees, rgb, StandardFonts } from "pdf-lib";
import { postError, postProgress, postResult, type WorkerRequest } from "./messages";

// Vite rewrites new URL(..., import.meta.url) to a hashed, BASE_URL-aware asset path at build time.
const mupdfWasmUrl = new URL("../../node_modules/mupdf/dist/mupdf-wasm.wasm", import.meta.url).href;
const qpdfWasmUrl = new URL("../../node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm", import.meta.url).href;

let qpdfReady: Promise<any> | null = null;
let qpdfRunId = 0;

function describeError(err: any) {
  if (!err) return "error desconocido";
  if (typeof err === "string") return err;
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "object") {
    const parts: string[] = [];
    if (typeof (err as any).message === "string" && (err as any).message) parts.push((err as any).message);
    if ((err as any).status !== undefined) parts.push(`status ${String((err as any).status)}`);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(err);
    } catch {
      /* ignore */
    }
  }
  try {
    return String(err);
  } catch {
    return "error desconocido";
  }
}

async function getQpdf() {
  if (!qpdfReady) {
    qpdfReady = (async () => {
      const qpdfMod: any = await import("@neslinesli93/qpdf-wasm");
      const createQpdf = qpdfMod.default ?? qpdfMod;
      if (typeof createQpdf !== "function") throw new Error("No se encontró el módulo qpdf-wasm.");
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
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origPrint = (qpdf as any).print;
  const origPrintErr = (qpdf as any).printErr;
  (qpdf as any).print = (line: any) => {
    if (line !== undefined && line !== null) stdout.push(String(line));
    if (typeof origPrint === "function") origPrint(line);
  };
  (qpdf as any).printErr = (line: any) => {
    if (line !== undefined && line !== null) stderr.push(String(line));
    if (typeof origPrintErr === "function") origPrintErr(line);
  };

  const inName = `in_${++qpdfRunId}.pdf`;
  const outName = `out_${qpdfRunId}.pdf`;
  try {
    qpdf.FS.writeFile(`/in/${inName}`, new Uint8Array(bytes));
    const pwdArg = password ? `--password=${password}` : "--password=";
    const args = ["--decrypt", pwdArg, `/in/${inName}`, `/out/${outName}`];
    qpdf.callMain(args);
    const outBytes: Uint8Array | undefined = qpdf.FS.readFile(`/out/${outName}`);
    if (!outBytes) throw new Error("La desencriptación no produjo salida.");
    return outBytes;
  } catch (err: any) {
    const log = (stderr.join("\n").trim() || stdout.join("\n").trim());
    const msg = [describeError(err), log].filter(Boolean).join(": ");
    if (/password|encrypted|encryption/i.test(msg)) {
      throw new Error(`"${label ?? "PDF"}" está protegido con contraseña. Proporciona la contraseña correcta e intenta de nuevo.`);
    }
    throw new Error(`No se pudo abrir ${label ?? "PDF"} (${msg || "error desconocido"})`);
  } finally {
    (qpdf as any).print = origPrint;
    (qpdf as any).printErr = origPrintErr;
    try {
      qpdf.FS.unlink(`/in/${inName}`);
      qpdf.FS.unlink(`/out/${outName}`);
    } catch {
      /* ignore cleanup errors */
    }
  }
}

async function loadPdf(bytes: ArrayBuffer, password: string | undefined, label: string): Promise<PDFDocument> {
  if (password?.trim()) {
    const unlocked = await decryptPdf(bytes, password, label);
    return PDFDocument.load(unlocked, { ignoreEncryption: true });
  }
  try {
    return await PDFDocument.load(new Uint8Array(bytes));
  } catch (err: any) {
    if (/encrypt/i.test(String(err?.message ?? err))) {
      throw new Error(`"${label}" está protegido con contraseña. Proporciona la contraseña e intenta de nuevo.`);
    }
    throw err;
  }
}

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
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0, true);
    l.setUint16(8, 0, true);
    l.setUint16(10, time, true);
    l.setUint16(12, date, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, entry.data.length, true);
    l.setUint32(22, entry.data.length, true);
    l.setUint16(26, nameBytes.length, true);
    l.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    locals.push(local, entry.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, entry.data.length, true);
    c.setUint32(24, entry.data.length, true);
    c.setUint16(28, nameBytes.length, true);
    c.setUint16(30, 0, true);
    c.setUint16(32, 0, true);
    c.setUint16(34, 0, true);
    c.setUint16(36, 0, true);
    c.setUint32(38, 0, true);
    c.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    centrals.push(central);
    offset += local.length + entry.data.length;
  }

  const centralDir = concatBytes(centrals);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(4, 0, true);
  e.setUint16(6, 0, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, centralDir.length, true);
  e.setUint32(16, offset, true);
  e.setUint16(20, 0, true);

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

// ─── Existing tools ────────────────────────────────────────────────────────────

async function merge(jobId: string, files: Array<{ name: string; bytes: ArrayBuffer; password?: string }>) {
  postProgress(jobId, 5, "Cargando PDFs…");
  const out = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    postProgress(jobId, 10 + Math.floor((i / files.length) * 60), `Importando ${f.name}…`);
    const doc = await loadPdf(f.bytes, f.password, f.name);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }

  postProgress(jobId, 80, "Guardando…");
  const bytes = await out.save({ useObjectStreams: true });
  postProgress(jobId, 100, "Listo");
  postResult(jobId, "combinado.pdf", bytes.buffer as ArrayBuffer, "application/pdf");
}

async function split(jobId: string, file: { name: string; bytes: ArrayBuffer; password?: string }, pages: number[], ranges: number[][], output: "single" | "zip") {
  postProgress(jobId, 5, "Cargando PDF…");
  const src = await loadPdf(file.bytes, file.password, file.name);
  const pageCount = src.getPageCount();
  const normalize = (list: number[]) =>
    Array.from(new Set(list.map((p) => p - 1).filter((p) => p >= 0 && p < pageCount))).sort((a, b) => a - b);
  const indices = normalize(pages);

  if (indices.length === 0) throw new Error(`No hay páginas válidas. El PDF tiene ${pageCount} página(s).`);

  if (output === "zip") {
    const entries: Array<{ name: string; data: Uint8Array }> = [];
    const base = file.name.replace(/\.pdf$/i, "") || "documento";
    const normalizedRanges = (ranges?.length ? ranges : [pages]).map(normalize).filter((r) => r.length);

    for (let i = 0; i < normalizedRanges.length; i++) {
      const range = normalizedRanges[i];
      const humanPages = range.map((p) => p + 1);
      postProgress(jobId, 10 + Math.floor((i / normalizedRanges.length) * 60), `Extrayendo páginas ${humanPages.join(",")}…`);
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, range);
      copied.forEach((p) => out.addPage(p));
      const bytes = await out.save({ useObjectStreams: true });
      const label = formatRangeLabel(humanPages) || `rango${i + 1}`;
      entries.push({ name: `${base}_${label}.pdf`, data: bytes });
    }

    postProgress(jobId, 85, "Creando ZIP…");
    const zipBytes = buildZip(entries);
    postProgress(jobId, 100, "Listo");
    postResult(jobId, `${base}_paginas.zip`, zipBytes.buffer as ArrayBuffer, "application/zip");
    return;
  }

  postProgress(jobId, 40, "Extrayendo páginas…");
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));

  postProgress(jobId, 80, "Guardando…");
  const bytes = await out.save({ useObjectStreams: true });
  postProgress(jobId, 100, "Listo");
  postResult(jobId, "paginas_extraidas.pdf", bytes.buffer as ArrayBuffer, "application/pdf");
}

async function compress(jobId: string, file: { name: string; bytes: ArrayBuffer; password?: string }, level: "small" | "balanced" | "best" | "aggressive") {
  postProgress(jobId, 5, "Inicializando qpdf (WASM)…");
  const qpdf = await getQpdf();

  let inputBytes: Uint8Array;
  if (level === "aggressive") {
    postProgress(jobId, 10, "Inicializando MuPDF (WASM)…");
    (globalThis as any)["$libmupdf_wasm_Module"] = {
      locateFile: (path: string) => path.endsWith(".wasm") ? mupdfWasmUrl : path,
    };
    const mupdf: any = await import("mupdf");

    const needsDecrypt = !!file.password?.trim();
    postProgress(jobId, 15, needsDecrypt ? "Desencriptando PDF…" : "Cargando PDF…");
    const docBytes = needsDecrypt
      ? await decryptPdf(file.bytes, file.password, file.name)
      : new Uint8Array(file.bytes);

    const src = mupdf.Document.openDocument(docBytes, "pdf");
    const total = src.countPages();
    if (!total) throw new Error("El PDF no tiene páginas.");

    const rasterDoc = await PDFDocument.create();
    const scale = 150 / 72;

    for (let i = 0; i < total; i++) {
      postProgress(jobId, 20 + Math.floor((i / total) * 50), `Rasterizando página ${i + 1} de ${total}…`);
      const page = src.loadPage(i);
      const bounds = page.getBounds();
      const pageW = Math.abs(bounds[2] - bounds[0]);
      const pageH = Math.abs(bounds[3] - bounds[1]);

      const pix = page.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, false);
      const jpegData = pix.asJPEG(75);
      pix.destroy?.();
      page.destroy?.();

      const img = await rasterDoc.embedJpg(jpegData);
      const newPage = rasterDoc.addPage([pageW, pageH]);
      newPage.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
    }
    src.destroy?.();

    postProgress(jobId, 72, "Guardando PDF rasterizado…");
    const rasterBytes = await rasterDoc.save({ useObjectStreams: true });
    inputBytes = rasterBytes;
  } else {
    inputBytes = file.password?.trim()
      ? await decryptPdf(file.bytes, file.password, file.name)
      : new Uint8Array(file.bytes);
  }

  const inName = `in_${++qpdfRunId}.pdf`;
  const outName = `out_${qpdfRunId}.pdf`;

  const pwdArgs = (level !== "aggressive" && file.password?.trim()) ? [`--password=${file.password.trim()}`] : [];
  const argsBase = ["--object-streams=generate", "--stream-data=compress", "--remove-unreferenced-resources=yes"];
  const levelArgs =
    level === "small" ? [] :
    level === "balanced" ? ["--recompress-flate"] :
    ["--recompress-flate", "--linearize"];

  const levelLabel =
    level === "small" ? "ligera" :
    level === "balanced" ? "equilibrada" :
    level === "best" ? "máxima" : "agresiva";

  const args = [...pwdArgs, ...argsBase, ...levelArgs, `/in/${inName}`, `/out/${outName}`];

  postProgress(jobId, level === "aggressive" ? 78 : 20, `Comprimiendo PDF (${levelLabel})…`);
  qpdf.FS.writeFile(`/in/${inName}`, inputBytes);
  qpdf.callMain(args);

  let outBytes: Uint8Array | undefined;
  try {
    outBytes = qpdf.FS.readFile(`/out/${outName}`);
  } catch (err) {
    console.error("Error de lectura qpdf", err);
  }

  if (!outBytes) throw new Error("qpdf-wasm no produjo salida.");

  try {
    qpdf.FS.unlink(`/in/${inName}`);
    qpdf.FS.unlink(`/out/${outName}`);
  } catch {
    /* ignore cleanup errors */
  }

  postProgress(jobId, 100, "Listo");
  postResult(jobId, `comprimido_${file.name.replace(/\.pdf$/i, "")}.pdf`, outBytes.buffer as ArrayBuffer, "application/pdf");
}

async function pdf2img(jobId: string, file: { name: string; bytes: ArrayBuffer; password?: string }, format: "png" | "jpg", dpi: number) {
  postProgress(jobId, 5, "Inicializando MuPDF (WASM)…");
  (globalThis as any)["$libmupdf_wasm_Module"] = {
    locateFile: (path: string) => path.endsWith(".wasm") ? mupdfWasmUrl : path,
  };
  const mupdf: any = await import("mupdf");

  const needsDecrypt = !!file.password?.trim();
  postProgress(jobId, 10, needsDecrypt ? "Desencriptando PDF…" : "Cargando PDF…");
  const docBytes = needsDecrypt
    ? await decryptPdf(file.bytes, file.password, file.name)
    : new Uint8Array(file.bytes);
  const doc = mupdf.Document.openDocument(docBytes, "pdf");
  const total = doc.countPages();
  if (!total) throw new Error("El PDF no tiene páginas.");

  const entries: Array<{ name: string; data: Uint8Array }> = [];
  const scale = dpi / 72;

  for (let i = 0; i < total; i++) {
    postProgress(jobId, 15 + Math.floor((i / total) * 65), `Renderizando página ${i + 1} de ${total}…`);
    const page = doc.loadPage(i);
    const pix = page.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, format === "png");
    const data: Uint8Array = format === "jpg" ? pix.asJPEG(85) : pix.asPNG();
    entries.push({ name: `pagina_${String(i + 1).padStart(3, "0")}.${format}`, data });
    pix.destroy?.();
    page.destroy?.();
  }

  postProgress(jobId, 85, "Empaquetando ZIP…");
  const zipBytes = buildZip(entries);
  const base = file.name.replace(/\.pdf$/i, "") || "documento";
  postProgress(jobId, 100, "Listo");
  postResult(jobId, `${base}_imagenes_${format}.zip`, zipBytes.buffer as ArrayBuffer, "application/zip");
}

// ─── New tools ─────────────────────────────────────────────────────────────────

async function rotate(
  jobId: string,
  file: { name: string; bytes: ArrayBuffer; password?: string },
  angle: 90 | 180 | 270,
  target: "all" | "range",
  pageList: number[],
) {
  postProgress(jobId, 10, "Cargando PDF…");
  const doc = await loadPdf(file.bytes, file.password, file.name);
  const pageCount = doc.getPageCount();

  let indices: number[];
  if (target === "all") {
    indices = Array.from({ length: pageCount }, (_, i) => i);
  } else {
    indices = Array.from(new Set(pageList.map((p) => p - 1).filter((p) => p >= 0 && p < pageCount)));
  }
  if (indices.length === 0) throw new Error("No hay páginas válidas para rotar.");

  const pages = doc.getPages();
  for (let i = 0; i < indices.length; i++) {
    postProgress(jobId, 20 + Math.floor((i / indices.length) * 60), `Rotando página ${indices[i] + 1}…`);
    const page = pages[indices[i]];
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + angle) % 360));
  }

  postProgress(jobId, 85, "Guardando…");
  const bytes = await doc.save({ useObjectStreams: true });
  const base = file.name.replace(/\.pdf$/i, "");
  postProgress(jobId, 100, "Listo");
  postResult(jobId, `${base}_rotado.pdf`, bytes.buffer as ArrayBuffer, "application/pdf");
}

async function img2pdf(
  jobId: string,
  files: Array<{ name: string; bytes: ArrayBuffer }>,
  layout: "auto" | "a4" | "letter",
) {
  postProgress(jobId, 5, "Creando PDF…");
  const doc = await PDFDocument.create();
  const A4: [number, number] = [595.28, 841.89];
  const LETTER: [number, number] = [612, 792];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    postProgress(jobId, 10 + Math.floor((i / files.length) * 80), `Procesando ${f.name}…`);
    const lower = f.name.toLowerCase();
    let image: any;
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
      image = await doc.embedJpg(f.bytes);
    } else if (lower.endsWith(".png")) {
      image = await doc.embedPng(f.bytes);
    } else {
      throw new Error(`Formato no soportado: "${f.name}". Solo se admiten JPG y PNG.`);
    }

    const imgDims = image.scale(1);
    let pageW: number, pageH: number;
    if (layout === "a4") [pageW, pageH] = A4;
    else if (layout === "letter") [pageW, pageH] = LETTER;
    else { pageW = imgDims.width; pageH = imgDims.height; }

    const page = doc.addPage([pageW, pageH]);
    if (layout === "auto") {
      page.drawImage(image, { x: 0, y: 0, width: pageW, height: pageH });
    } else {
      const scale = Math.min(pageW / imgDims.width, pageH / imgDims.height);
      const scaledW = imgDims.width * scale;
      const scaledH = imgDims.height * scale;
      page.drawImage(image, {
        x: (pageW - scaledW) / 2,
        y: (pageH - scaledH) / 2,
        width: scaledW,
        height: scaledH,
      });
    }
  }

  postProgress(jobId, 92, "Guardando…");
  const bytes = await doc.save({ useObjectStreams: true });
  postProgress(jobId, 100, "Listo");
  postResult(jobId, "imagenes.pdf", bytes.buffer as ArrayBuffer, "application/pdf");
}

async function protect(
  jobId: string,
  file: { name: string; bytes: ArrayBuffer; password?: string },
  mode: "add" | "remove",
  newPassword?: string,
) {
  const base = file.name.replace(/\.pdf$/i, "");

  if (mode === "remove") {
    postProgress(jobId, 10, "Desencriptando PDF…");
    const decrypted = await decryptPdf(file.bytes, file.password, file.name);
    postProgress(jobId, 100, "Listo");
    postResult(jobId, `${base}_sin_contraseña.pdf`, decrypted.buffer as ArrayBuffer, "application/pdf");
    return;
  }

  postProgress(jobId, 10, "Inicializando qpdf…");
  const qpdf = await getQpdf();
  postProgress(jobId, 20, "Cargando PDF…");
  const inputBytes = file.password?.trim()
    ? await decryptPdf(file.bytes, file.password, file.name)
    : new Uint8Array(file.bytes);

  const inName = `in_${++qpdfRunId}.pdf`;
  const outName = `out_${qpdfRunId}.pdf`;
  try {
    qpdf.FS.writeFile(`/in/${inName}`, inputBytes);
    const pwd = newPassword ?? "";
    const args = ["--encrypt", pwd, pwd, "256", "--", `/in/${inName}`, `/out/${outName}`];
    postProgress(jobId, 60, "Aplicando contraseña…");
    qpdf.callMain(args);
    const outBytes: Uint8Array | undefined = qpdf.FS.readFile(`/out/${outName}`);
    if (!outBytes) throw new Error("qpdf no produjo salida.");
    postProgress(jobId, 100, "Listo");
    postResult(jobId, `${base}_protegido.pdf`, outBytes.buffer as ArrayBuffer, "application/pdf");
  } finally {
    try {
      qpdf.FS.unlink(`/in/${inName}`);
      qpdf.FS.unlink(`/out/${outName}`);
    } catch { /* ignore */ }
  }
}

async function deletepages(
  jobId: string,
  file: { name: string; bytes: ArrayBuffer; password?: string },
  pages: number[],
) {
  postProgress(jobId, 10, "Cargando PDF…");
  const src = await loadPdf(file.bytes, file.password, file.name);
  const pageCount = src.getPageCount();

  const toDelete = new Set(pages.map((p) => p - 1).filter((p) => p >= 0 && p < pageCount));
  const keepIndices = Array.from({ length: pageCount }, (_, i) => i).filter((i) => !toDelete.has(i));

  if (keepIndices.length === 0) throw new Error("No se pueden eliminar todas las páginas — el PDF quedaría vacío.");

  postProgress(jobId, 40, `Eliminando ${toDelete.size} página(s)…`);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, keepIndices);
  copied.forEach((p) => out.addPage(p));

  postProgress(jobId, 80, "Guardando…");
  const bytes = await out.save({ useObjectStreams: true });
  const base = file.name.replace(/\.pdf$/i, "");
  postProgress(jobId, 100, "Listo");
  postResult(jobId, `${base}_sin_paginas.pdf`, bytes.buffer as ArrayBuffer, "application/pdf");
}

async function watermark(
  jobId: string,
  file: { name: string; bytes: ArrayBuffer; password?: string },
  text: string,
  opacity: number,
  angle: number,
  size: number,
  color: string,
) {
  postProgress(jobId, 10, "Cargando PDF…");
  const doc = await loadPdf(file.bytes, file.password, file.name);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const r = parseInt(color.slice(1, 3), 16) / 255;
  const g = parseInt(color.slice(3, 5), 16) / 255;
  const b = parseInt(color.slice(5, 7), 16) / 255;

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    postProgress(jobId, 15 + Math.floor((i / pages.length) * 70), `Marcando página ${i + 1} de ${pages.length}…`);
    const page = pages[i];
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: (width - textWidth) / 2,
      y: height / 2,
      size,
      font,
      color: rgb(r, g, b),
      opacity: opacity / 100,
      rotate: degrees(angle),
    });
  }

  postProgress(jobId, 90, "Guardando…");
  const bytes = await doc.save({ useObjectStreams: true });
  const base = file.name.replace(/\.pdf$/i, "");
  postProgress(jobId, 100, "Listo");
  postResult(jobId, `${base}_marca_agua.pdf`, bytes.buffer as ArrayBuffer, "application/pdf");
}

async function pagenumbers(
  jobId: string,
  file: { name: string; bytes: ArrayBuffer; password?: string },
  position: "bottom-center" | "bottom-right" | "bottom-left",
  start: number,
  prefix: string,
  fontSize: number,
) {
  postProgress(jobId, 10, "Cargando PDF…");
  const doc = await loadPdf(file.bytes, file.password, file.name);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const margin = 20;

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    postProgress(jobId, 15 + Math.floor((i / pages.length) * 70), `Numerando página ${i + 1} de ${pages.length}…`);
    const page = pages[i];
    const { width } = page.getSize();
    const text = `${prefix}${i + start}`;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    let x: number;
    if (position === "bottom-center") x = (width - textWidth) / 2;
    else if (position === "bottom-right") x = width - textWidth - margin;
    else x = margin;
    page.drawText(text, { x, y: margin, size: fontSize, font, color: rgb(0, 0, 0) });
  }

  postProgress(jobId, 90, "Guardando…");
  const bytes = await doc.save({ useObjectStreams: true });
  const base = file.name.replace(/\.pdf$/i, "");
  postProgress(jobId, 100, "Listo");
  postResult(jobId, `${base}_numerado.pdf`, bytes.buffer as ArrayBuffer, "application/pdf");
}

async function metadata(
  jobId: string,
  file: { name: string; bytes: ArrayBuffer; password?: string },
  title: string,
  author: string,
  subject: string,
  keywords: string,
  creator: string,
) {
  postProgress(jobId, 10, "Cargando PDF…");
  const doc = await loadPdf(file.bytes, file.password, file.name);
  postProgress(jobId, 50, "Actualizando metadatos…");
  if (title) doc.setTitle(title);
  if (author) doc.setAuthor(author);
  if (subject) doc.setSubject(subject);
  if (keywords) doc.setKeywords(keywords.split(",").map((k) => k.trim()).filter(Boolean));
  if (creator) doc.setCreator(creator);
  doc.setModificationDate(new Date());
  postProgress(jobId, 85, "Guardando…");
  const bytes = await doc.save({ useObjectStreams: true });
  const base = file.name.replace(/\.pdf$/i, "");
  postProgress(jobId, 100, "Listo");
  postResult(jobId, `${base}_meta.pdf`, bytes.buffer as ArrayBuffer, "application/pdf");
}

async function extracttext(jobId: string, file: { name: string; bytes: ArrayBuffer; password?: string }) {
  postProgress(jobId, 5, "Inicializando MuPDF (WASM)…");
  (globalThis as any)["$libmupdf_wasm_Module"] = {
    locateFile: (path: string) => path.endsWith(".wasm") ? mupdfWasmUrl : path,
  };
  const mupdf: any = await import("mupdf");

  const needsDecrypt = !!file.password?.trim();
  postProgress(jobId, 10, needsDecrypt ? "Desencriptando PDF…" : "Cargando PDF…");
  const docBytes = needsDecrypt
    ? await decryptPdf(file.bytes, file.password, file.name)
    : new Uint8Array(file.bytes);

  const doc = mupdf.Document.openDocument(docBytes, "pdf");
  const total = doc.countPages();
  if (!total) throw new Error("El PDF no tiene páginas.");

  let text = "";
  for (let i = 0; i < total; i++) {
    postProgress(jobId, 15 + Math.floor((i / total) * 70), `Extrayendo texto de página ${i + 1} de ${total}…`);
    const page = doc.loadPage(i);
    try {
      const st = page.toStructuredText("preserve-whitespace");
      text += st.asText() + "\n\n---\n\n";
      st.destroy?.();
    } catch {
      text += `[Página ${i + 1}: sin texto extraíble]\n\n---\n\n`;
    }
    page.destroy?.();
  }
  doc.destroy?.();

  postProgress(jobId, 92, "Generando archivo…");
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text.trimEnd());
  const base = file.name.replace(/\.pdf$/i, "");
  postProgress(jobId, 100, "Listo");
  postResult(jobId, `${base}.txt`, bytes.buffer as ArrayBuffer, "text/plain;charset=utf-8");
}

async function crop(
  jobId: string,
  file: { name: string; bytes: ArrayBuffer; password?: string },
  top: number,
  right: number,
  bottom: number,
  left: number,
  unit: "mm" | "pt",
) {
  postProgress(jobId, 10, "Cargando PDF…");
  const doc = await loadPdf(file.bytes, file.password, file.name);
  const toPt = unit === "mm" ? (v: number) => v * 72 / 25.4 : (v: number) => v;
  const topPt = toPt(top);
  const rightPt = toPt(right);
  const bottomPt = toPt(bottom);
  const leftPt = toPt(left);

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    postProgress(jobId, 20 + Math.floor((i / pages.length) * 60), `Recortando página ${i + 1}…`);
    const page = pages[i];
    const mb = page.getMediaBox();
    const newW = mb.width - leftPt - rightPt;
    const newH = mb.height - topPt - bottomPt;
    if (newW > 0 && newH > 0) {
      page.setMediaBox(mb.x + leftPt, mb.y + bottomPt, newW, newH);
    }
  }

  postProgress(jobId, 85, "Guardando…");
  const bytes = await doc.save({ useObjectStreams: true });
  const base = file.name.replace(/\.pdf$/i, "");
  postProgress(jobId, 100, "Listo");
  postResult(jobId, `${base}_recortado.pdf`, bytes.buffer as ArrayBuffer, "application/pdf");
}

async function reorder(
  jobId: string,
  file: { name: string; bytes: ArrayBuffer; password?: string },
  order: number[],
) {
  postProgress(jobId, 10, "Cargando PDF…");
  const src = await loadPdf(file.bytes, file.password, file.name);
  const pageCount = src.getPageCount();

  const invalid = order.filter((n) => n < 1 || n > pageCount);
  if (invalid.length) throw new Error(`Página(s) fuera de rango: ${invalid.join(", ")}. El PDF tiene ${pageCount} páginas.`);
  if (new Set(order).size !== order.length) throw new Error("El orden contiene páginas duplicadas.");

  postProgress(jobId, 40, "Reordenando páginas…");
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, order.map((n) => n - 1));
  copied.forEach((p) => out.addPage(p));

  postProgress(jobId, 80, "Guardando…");
  const bytes = await out.save({ useObjectStreams: true });
  const base = file.name.replace(/\.pdf$/i, "");
  postProgress(jobId, 100, "Listo");
  postResult(jobId, `${base}_reordenado.pdf`, bytes.buffer as ArrayBuffer, "application/pdf");
}

// ─── Message router ─────────────────────────────────────────────────────────────

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
    } else if (msg.type === "rotate") {
      await rotate(msg.jobId, msg.file, msg.angle, msg.target, msg.pages);
    } else if (msg.type === "img2pdf") {
      await img2pdf(msg.jobId, msg.files, msg.layout);
    } else if (msg.type === "protect") {
      await protect(msg.jobId, msg.file, msg.mode, msg.newPassword);
    } else if (msg.type === "deletepages") {
      await deletepages(msg.jobId, msg.file, msg.pages);
    } else if (msg.type === "watermark") {
      await watermark(msg.jobId, msg.file, msg.text, msg.opacity, msg.angle, msg.size, msg.color);
    } else if (msg.type === "pagenumbers") {
      await pagenumbers(msg.jobId, msg.file, msg.position, msg.start, msg.prefix, msg.fontSize);
    } else if (msg.type === "metadata") {
      await metadata(msg.jobId, msg.file, msg.title, msg.author, msg.subject, msg.keywords, msg.creator);
    } else if (msg.type === "extracttext") {
      await extracttext(msg.jobId, msg.file);
    } else if (msg.type === "crop") {
      await crop(msg.jobId, msg.file, msg.top, msg.right, msg.bottom, msg.left, msg.unit);
    } else if (msg.type === "reorder") {
      await reorder(msg.jobId, msg.file, msg.order);
    } else {
      throw new Error("Solicitud de worker desconocida");
    }
  } catch (e: any) {
    postError((msg as any).jobId ?? "unknown", e?.message ?? String(e));
  }
};
