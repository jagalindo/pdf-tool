/* eslint-disable no-restricted-globals */
import { PDFDocument } from "pdf-lib";
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

async function merge(jobId: string, files: Array<{ name: string; bytes: ArrayBuffer; password?: string }>) {
  postProgress(jobId, 5, "Cargando PDFs\u2026");
  const out = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    postProgress(jobId, 10 + Math.floor((i / files.length) * 60), `Importando ${f.name}\u2026`);
    const doc = await loadPdf(f.bytes, f.password, f.name);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }

  postProgress(jobId, 80, "Guardando\u2026");
  const bytes = await out.save({ useObjectStreams: true });
  postProgress(jobId, 100, "Listo");
  postResult(jobId, "combinado.pdf", bytes.buffer as ArrayBuffer, "application/pdf");
}

async function split(jobId: string, file: { name: string; bytes: ArrayBuffer; password?: string }, pages: number[], ranges: number[][], output: "single" | "zip") {
  postProgress(jobId, 5, "Cargando PDF\u2026");
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
      postProgress(jobId, 10 + Math.floor((i / normalizedRanges.length) * 60), `Extrayendo páginas ${humanPages.join(",")}\u2026`);
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, range);
      copied.forEach((p) => out.addPage(p));
      const bytes = await out.save({ useObjectStreams: true });
      const label = formatRangeLabel(humanPages) || `rango${i + 1}`;
      entries.push({ name: `${base}_${label}.pdf`, data: bytes });
    }

    postProgress(jobId, 85, "Creando ZIP\u2026");
    const zipBytes = buildZip(entries);
    postProgress(jobId, 100, "Listo");
    postResult(jobId, `${base}_paginas.zip`, zipBytes.buffer as ArrayBuffer, "application/zip");
    return;
  }

  postProgress(jobId, 40, "Extrayendo páginas\u2026");
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));

  postProgress(jobId, 80, "Guardando\u2026");
  const bytes = await out.save({ useObjectStreams: true });
  postProgress(jobId, 100, "Listo");
  postResult(jobId, "paginas_extraidas.pdf", bytes.buffer as ArrayBuffer, "application/pdf");
}

async function compress(jobId: string, file: { name: string; bytes: ArrayBuffer; password?: string }, level: "small" | "balanced" | "best" | "aggressive") {
  postProgress(jobId, 5, "Inicializando qpdf (WASM)\u2026");
  const qpdf = await getQpdf();

  // --- Aggressive mode: rasterize pages via MuPDF before structural compression ---
  let inputBytes: Uint8Array;
  if (level === "aggressive") {
    postProgress(jobId, 10, "Inicializando MuPDF (WASM)\u2026");
    (globalThis as any)["$libmupdf_wasm_Module"] = {
      locateFile: (path: string) => path.endsWith(".wasm") ? mupdfWasmUrl : path,
    };
    const mupdf: any = await import("mupdf");

    const needsDecrypt = !!file.password?.trim();
    postProgress(jobId, 15, needsDecrypt ? "Desencriptando PDF\u2026" : "Cargando PDF\u2026");
    const docBytes = needsDecrypt
      ? await decryptPdf(file.bytes, file.password, file.name)
      : new Uint8Array(file.bytes);

    const src = mupdf.Document.openDocument(docBytes, "pdf");
    const total = src.countPages();
    if (!total) throw new Error("El PDF no tiene páginas.");

    const rasterDoc = await PDFDocument.create();
    const scale = 150 / 72;

    for (let i = 0; i < total; i++) {
      postProgress(jobId, 20 + Math.floor((i / total) * 50), `Rasterizando página ${i + 1} de ${total}\u2026`);
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

    postProgress(jobId, 72, "Guardando PDF rasterizado\u2026");
    const rasterBytes = await rasterDoc.save({ useObjectStreams: true });
    inputBytes = rasterBytes;
  } else {
    inputBytes = file.password?.trim()
      ? await decryptPdf(file.bytes, file.password, file.name)
      : new Uint8Array(file.bytes);
  }

  // --- Structural compression via qpdf ---
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

  postProgress(jobId, level === "aggressive" ? 78 : 20, `Comprimiendo PDF (${levelLabel})\u2026`);
  qpdf.FS.writeFile(`/in/${inName}`, inputBytes);
  qpdf.callMain(args);

  let outBytes: Uint8Array | undefined;
  try {
    outBytes = qpdf.FS.readFile(`/out/${outName}`);
  } catch (err) {
    console.error("Error de lectura qpdf", err);
  }

  if (!outBytes) {
    throw new Error("qpdf-wasm no produjo salida.");
  }

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
  postProgress(jobId, 5, "Inicializando MuPDF (WASM)\u2026");
  (globalThis as any)["$libmupdf_wasm_Module"] = {
    locateFile: (path: string) => path.endsWith(".wasm") ? mupdfWasmUrl : path,
  };
  const mupdf: any = await import("mupdf");

  const needsDecrypt = !!file.password?.trim();
  postProgress(jobId, 10, needsDecrypt ? "Desencriptando PDF\u2026" : "Cargando PDF\u2026");
  const docBytes = needsDecrypt
    ? await decryptPdf(file.bytes, file.password, file.name)
    : new Uint8Array(file.bytes);
  const doc = mupdf.Document.openDocument(docBytes, "pdf");
  const total = doc.countPages();
  if (!total) throw new Error("El PDF no tiene páginas.");

  const entries: Array<{ name: string; data: Uint8Array }> = [];
  const scale = dpi / 72;

  for (let i = 0; i < total; i++) {
    postProgress(jobId, 15 + Math.floor((i / total) * 65), `Renderizando página ${i + 1} de ${total}\u2026`);
    const page = doc.loadPage(i);
    const pix = page.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, format === "png");
    const data: Uint8Array = format === "jpg" ? pix.asJPEG(85) : pix.asPNG();
    entries.push({ name: `pagina_${String(i + 1).padStart(3, "0")}.${format}`, data });

    pix.destroy?.();
    page.destroy?.();
  }

  postProgress(jobId, 85, "Empaquetando ZIP\u2026");
  const zipBytes = buildZip(entries);
  const base = file.name.replace(/\.pdf$/i, "") || "documento";
  const outName = `${base}_imagenes_${format}.zip`;

  postProgress(jobId, 100, "Listo");
  postResult(jobId, outName, zipBytes.buffer as ArrayBuffer, "application/zip");
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
      throw new Error("Solicitud de worker desconocida");
    }
  } catch (e: any) {
    postError((msg as any).jobId ?? "unknown", e?.message ?? String(e));
  }
};
