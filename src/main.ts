import "./styles.css";
import type { Job, ToolDef, ToolId } from "./types";
import type { WorkerEvent, WorkerRequest } from "./worker/messages";

type SelectedFile = { file: File; key: string; password: string };

const TOOLS: ToolDef[] = [
  { id: "merge",       title: "Combinar PDFs",       subtitle: "Une varios PDFs en uno solo",                           tags: ["PDF", "Offline", "Rápido"],    accepts: "pdf",   output: "pdf" },
  { id: "split",       title: "Dividir PDF",          subtitle: "Extrae páginas seleccionadas (ej: 1,3,5-7; 10-12)",    tags: ["Páginas", "Offline", "ZIP"],   accepts: "pdf",   output: "pdf" },
  { id: "compress",    title: "Comprimir PDF",         subtitle: "Compresión decente vía qpdf-wasm",                    tags: ["WASM", "Offline"],             accepts: "pdf",   output: "pdf" },
  { id: "pdf2img",     title: "PDF a Imagen",          subtitle: "Renderiza páginas a PNG/JPG en ZIP (MuPDF WASM)",     tags: ["WASM", "Offline", "ZIP"],      accepts: "pdf",   output: "zip" },
  { id: "rotate",      title: "Rotar páginas",         subtitle: "Rota todas las páginas o un rango (90/180/270°)",     tags: ["Páginas", "Offline"],          accepts: "pdf",   output: "pdf" },
  { id: "img2pdf",     title: "Imagen a PDF",          subtitle: "Convierte JPG/PNG a un PDF de una o varias páginas",  tags: ["Imágenes", "Offline"],         accepts: "image", output: "pdf" },
  { id: "protect",     title: "Contraseña PDF",        subtitle: "Añade o quita contraseña de un PDF (AES-256)",        tags: ["Seguridad", "WASM", "Offline"],accepts: "pdf",   output: "pdf" },
  { id: "deletepages", title: "Eliminar páginas",      subtitle: "Borra páginas específicas de un PDF",                 tags: ["Páginas", "Offline"],          accepts: "pdf",   output: "pdf" },
  { id: "watermark",   title: "Marca de agua",         subtitle: "Añade texto semitransparente en diagonal",            tags: ["Offline"],                     accepts: "pdf",   output: "pdf" },
  { id: "pagenumbers", title: "Numerar páginas",        subtitle: "Inserta numeración en el pie de cada página",         tags: ["Offline"],                     accepts: "pdf",   output: "pdf" },
  { id: "metadata",    title: "Editar metadatos",       subtitle: "Cambia título, autor, tema y palabras clave",         tags: ["Offline"],                     accepts: "pdf",   output: "pdf" },
  { id: "extracttext", title: "Extraer texto",          subtitle: "Exporta el texto del PDF como archivo .txt",          tags: ["WASM", "Offline"],             accepts: "pdf",   output: "txt" },
  { id: "crop",        title: "Recortar márgenes",      subtitle: "Reduce el área visible de cada página (CropBox)",    tags: ["Páginas", "Offline"],          accepts: "pdf",   output: "pdf" },
  { id: "reorder",     title: "Reordenar páginas",      subtitle: "Cambia el orden de las páginas con una lista",        tags: ["Páginas", "Offline"],          accepts: "pdf",   output: "pdf" },
];

const TOOL_ICONS: Record<string, string> = {
  merge:       "🔗",
  split:       "✂️",
  compress:    "🗜️",
  pdf2img:     "🖼️",
  rotate:      "🔄",
  img2pdf:     "📸",
  protect:     "🔒",
  deletepages: "🗑️",
  watermark:   "💧",
  pagenumbers: "🔢",
  metadata:    "🏷️",
  extracttext: "📝",
  crop:        "✂",
  reorder:     "↕️",
};

const app = document.querySelector<HTMLDivElement>("#app")!;

// --- Theme ---
function getPreferredTheme(): "light" | "dark" {
  const stored = localStorage.getItem("pdf-toolkit-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let currentTheme = getPreferredTheme();
function applyTheme() {
  document.documentElement.setAttribute("data-theme", currentTheme);
}
function toggleTheme() {
  currentTheme = currentTheme === "light" ? "dark" : "light";
  localStorage.setItem("pdf-toolkit-theme", currentTheme);
  applyTheme();
  render();
}
applyTheme();

// --- Utilities ---
function uid() {
  return `job_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function prettyBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "–";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clampDpi(value: number): number {
  if (!Number.isFinite(value) || value < 36) return 36;
  if (value > 600) return 600;
  return Math.round(value);
}

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const WARN_FILE_SIZE = 100 * 1024 * 1024;
const MAX_MERGE_FILES = 50;

// --- Worker ---
const worker = new Worker(new URL("./worker/engine.worker.ts", import.meta.url), { type: "module" });

// --- State ---
let activeTool: ToolId = "merge";
let files: SelectedFile[] = [];
let jobs: Job[] = [];
let draggingIdx: number | null = null;
let searchQuery = "";
let isJobRunning = false;

// compress
let compressLevel: "small" | "balanced" | "best" | "aggressive" = "balanced";
// split
let splitPages = "1";
let splitOutput: "single" | "zip" = "single";
// pdf2img
let imgFormat: "png" | "jpg" = "png";
let imgDpi = 150;
// rotate
let rotateAngle: 90 | 180 | 270 = 90;
let rotateTarget: "all" | "range" = "all";
let rotatePages = "1";
// img2pdf
let img2pdfLayout: "auto" | "a4" | "letter" = "auto";
// protect
let protectMode: "add" | "remove" = "add";
let protectNewPassword = "";
let protectConfirmPassword = "";
// deletepages
let deletePagesInput = "1";
// watermark
let watermarkText = "CONFIDENCIAL";
let watermarkOpacity = 30;
let watermarkAngle = 45;
let watermarkSize = 60;
let watermarkColor = "#808080";
// pagenumbers
let pageNumPosition: "bottom-center" | "bottom-right" | "bottom-left" = "bottom-center";
let pageNumStart = 1;
let pageNumPrefix = "";
let pageNumFontSize = 11;
// metadata
let metaTitle = "";
let metaAuthor = "";
let metaSubject = "";
let metaKeywords = "";
let metaCreator = "";
// crop
let cropTop = 0;
let cropRight = 0;
let cropBottom = 0;
let cropLeft = 0;
let cropUnit: "mm" | "pt" = "mm";
// reorder
let reorderInput = "";

worker.onmessage = (ev: MessageEvent<WorkerEvent>) => {
  const msg = ev.data;
  if (msg.type === "progress") {
    jobs = jobs.map(j => j.id === msg.jobId ? { ...j, status: "running", progress: msg.progress, progressNote: msg.note } : j);
    render();
  } else if (msg.type === "result") {
    const blob = new Blob([msg.outputBytes], { type: msg.mime });
    jobs = jobs.map(j => j.id === msg.jobId ? { ...j, status: "done", progress: 100, progressNote: undefined, outputName: msg.outputName, outputBlob: blob } : j);
    isJobRunning = false;
    render();
  } else if (msg.type === "error") {
    jobs = jobs.map(j => j.id === msg.jobId ? { ...j, status: "error", progressNote: undefined, error: msg.message } : j);
    isJobRunning = false;
    render();
  }
};

// --- Page parsing ---
function parsePageList(input: string): number[] {
  const out: number[] = [];
  for (const part of input.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^([0-9]+)\s*-\s*([0-9]+)$/);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      const lo = Math.min(a, b), hi = Math.max(a, b);
      for (let x = lo; x <= hi; x++) out.push(x);
    } else {
      const n = Number(p);
      if (Number.isFinite(n) && n > 0) out.push(n);
    }
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

function parsePageGroups(input: string): { flat: number[]; groups: number[][] } {
  const groups: number[][] = [];
  for (const chunk of input.split(/;|\n/)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const list = parsePageList(trimmed);
    if (list.length) groups.push(list);
  }
  const flat = Array.from(new Set(groups.flat())).sort((a, b) => a - b);
  return { flat, groups };
}

type ValidationResult = { type: "error"; msg: string } | { type: "warn"; msg: string } | { type: "ok"; msg: string } | null;

function validatePageInput(input: string): ValidationResult {
  const trimmed = input.trim();
  if (!trimmed) return { type: "error", msg: "Ingresa al menos una página." };
  if (/[^0-9,;\s\n\-]/.test(trimmed)) {
    const invalid = trimmed.match(/[^0-9,;\s\n\-]/g)!;
    return { type: "error", msg: `Caracteres no válidos: "${invalid.join("")}". Usa solo números, comas, guiones y punto y coma.` };
  }
  const { flat, groups } = parsePageGroups(trimmed);
  if (flat.length === 0) return { type: "error", msg: "No se encontraron páginas válidas. Usa formato: 1,3,5-7" };
  if (flat.length > 500) return { type: "warn", msg: `Se seleccionaron ${flat.length} páginas. El proceso puede tardar.` };
  const maxPage = Math.max(...flat);
  if (maxPage > 10000) return { type: "warn", msg: `Página máxima: ${maxPage}. Asegúrate de que el PDF tenga tantas páginas.` };
  const groupCount = groups.length;
  return { type: "ok", msg: `${flat.length} página(s) seleccionada(s)${groupCount > 1 ? ` en ${groupCount} grupo(s)` : ""}.` };
}

function validateDpiInput(value: number): ValidationResult {
  if (!Number.isFinite(value) || value <= 0) return { type: "error", msg: "Ingresa un número válido entre 36 y 600." };
  if (value < 36) return { type: "error", msg: `DPI mínimo: 36. Valor actual: ${value}.` };
  if (value > 600) return { type: "error", msg: `DPI máximo: 600. Valor actual: ${value}.` };
  if (value > 300) return { type: "warn", msg: `DPI alto (${value}). Las imágenes serán grandes y el proceso más lento.` };
  return { type: "ok", msg: `${value} DPI.` };
}

function validateProtectPassword(pwd: string, confirm: string): ValidationResult {
  if (!pwd) return { type: "error", msg: "Ingresa una contraseña nueva." };
  if (pwd !== confirm) return { type: "error", msg: "Las contraseñas no coinciden." };
  if (pwd.length < 4) return { type: "warn", msg: "Contraseña corta. Se recomiendan al menos 8 caracteres." };
  return { type: "ok", msg: "Contraseña válida." };
}

function validateReorderInput(input: string): ValidationResult {
  const trimmed = input.trim();
  if (!trimmed) return { type: "error", msg: "Ingresa el nuevo orden de páginas (ej: 3,1,2)." };
  if (/[^0-9,\s]/.test(trimmed)) return { type: "error", msg: "Solo se permiten números separados por comas." };
  const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 1)) return { type: "error", msg: "Todos los valores deben ser enteros mayores a 0." };
  if (new Set(nums).size !== nums.length) return { type: "error", msg: "Hay páginas duplicadas en el orden." };
  return { type: "ok", msg: `${nums.length} página(s) en el nuevo orden.` };
}

function validateFiles(): ValidationResult {
  const isImgTool = activeTool === "img2pdf";
  const isMultiTool = activeTool === "merge" || activeTool === "img2pdf";

  if (files.length === 0) return { type: "error", msg: isImgTool ? "Agrega al menos una imagen." : "Agrega al menos un archivo PDF." };
  if (activeTool === "merge" && files.length < 2) return { type: "error", msg: "Combinar necesita al menos 2 PDFs." };
  if (activeTool === "merge" && files.length > MAX_MERGE_FILES) return { type: "error", msg: `Máximo ${MAX_MERGE_FILES} archivos para combinar.` };
  if (!isMultiTool && files.length > 1) return { type: "warn", msg: "Solo se procesará el primer archivo." };

  const emptyFiles = files.filter(f => f.file.size === 0);
  if (emptyFiles.length > 0) return { type: "error", msg: `Archivo vacío: "${emptyFiles[0].file.name}" (0 bytes).` };

  const tooLarge = files.filter(f => f.file.size > MAX_FILE_SIZE);
  if (tooLarge.length > 0) return { type: "error", msg: `"${tooLarge[0].file.name}" excede el límite de ${prettyBytes(MAX_FILE_SIZE)}.` };

  const largeFiles = files.filter(f => f.file.size > WARN_FILE_SIZE && f.file.size <= MAX_FILE_SIZE);
  if (largeFiles.length > 0) return { type: "warn", msg: `"${largeFiles[0].file.name}" es grande (${prettyBytes(largeFiles[0].file.size)}). El proceso puede tardar.` };

  const total = totalInputSize();
  if (total > WARN_FILE_SIZE && !largeFiles.length) return { type: "warn", msg: `Tamaño total: ${prettyBytes(total)}. El proceso puede tardar.` };

  return null;
}

function canRun(): boolean {
  if (isJobRunning) return false;
  if (files.length === 0) return false;
  if (files.some(f => f.file.size === 0 || f.file.size > MAX_FILE_SIZE)) return false;

  if (activeTool === "merge") {
    if (files.length < 2 || files.length > MAX_MERGE_FILES) return false;
  }

  if (activeTool === "split") {
    const v = validatePageInput(splitPages);
    if (v?.type === "error") return false;
  }
  if (activeTool === "pdf2img") {
    if (!Number.isFinite(imgDpi) || imgDpi < 36 || imgDpi > 600) return false;
  }
  if (activeTool === "rotate" && rotateTarget === "range") {
    const v = validatePageInput(rotatePages);
    if (v?.type === "error") return false;
  }
  if (activeTool === "protect" && protectMode === "add") {
    const v = validateProtectPassword(protectNewPassword, protectConfirmPassword);
    if (v?.type === "error") return false;
  }
  if (activeTool === "deletepages") {
    const v = validatePageInput(deletePagesInput);
    if (v?.type === "error") return false;
  }
  if (activeTool === "watermark") {
    if (!watermarkText.trim()) return false;
  }
  if (activeTool === "reorder") {
    const v = validateReorderInput(reorderInput);
    if (v?.type === "error") return false;
  }
  return true;
}

function renderValidationHint(v: ValidationResult): string {
  if (!v) return "";
  const cls = v.type === "error" ? "validationHint" : v.type === "warn" ? "validationHint warn" : "validationHint ok";
  const icon = v.type === "error" ? "✘" : v.type === "warn" ? "⚠" : "✔";
  return `<div class="${cls}">${icon} ${escapeAttr(v.msg)}</div>`;
}

// --- File handling ---
async function readFileBytes(f: File): Promise<ArrayBuffer> {
  return await f.arrayBuffer();
}

function makeKey(f: File) {
  return `${f.name}:${f.size}:${f.lastModified}`;
}

function totalInputSize(): number {
  return files.reduce((sum, f) => sum + f.file.size, 0);
}

function onFilesChosen(list: FileList | null) {
  if (!list) return;
  const all = Array.from(list);

  let accepted: File[];
  if (activeTool === "img2pdf") {
    const images = all.filter(f =>
      f.type.startsWith("image/") || /\.(jpe?g|png)$/i.test(f.name)
    );
    const rejected = all.length - images.length;
    if (rejected > 0) alert(`${rejected} archivo(s) ignorado(s): solo se aceptan JPG y PNG.`);
    const empty = images.filter(f => f.size === 0);
    if (empty.length > 0) alert(`"${empty[0].name}" está vacío y fue ignorado.`);
    const big = images.filter(f => f.size > MAX_FILE_SIZE);
    if (big.length > 0) alert(`"${big[0].name}" excede ${prettyBytes(MAX_FILE_SIZE)} y fue ignorado.`);
    accepted = images.filter(f => f.size > 0 && f.size <= MAX_FILE_SIZE);
  } else {
    const pdfs = all.filter(f => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    const rejected = all.length - pdfs.length;
    if (rejected > 0) alert(`${rejected} archivo(s) ignorado(s): solo se aceptan PDFs.`);
    const empty = pdfs.filter(f => f.size === 0);
    if (empty.length > 0) alert(`"${empty[0].name}" está vacío y fue ignorado.`);
    const big = pdfs.filter(f => f.size > MAX_FILE_SIZE);
    if (big.length > 0) alert(`"${big[0].name}" excede ${prettyBytes(MAX_FILE_SIZE)} y fue ignorado.`);
    accepted = pdfs.filter(f => f.size > 0 && f.size <= MAX_FILE_SIZE);
  }

  if (accepted.length === 0) return;

  const map = new Map(files.map(f => [f.key, f]));
  for (const f of accepted) {
    const key = makeKey(f);
    const prev = map.get(key);
    map.set(key, prev ? { ...prev, file: f } : { file: f, key, password: "" });
  }

  if (activeTool === "merge" && map.size > MAX_MERGE_FILES) {
    alert(`Máximo ${MAX_MERGE_FILES} archivos para combinar. Se aceptaron los primeros ${MAX_MERGE_FILES}.`);
    files = Array.from(map.values()).slice(0, MAX_MERGE_FILES);
  } else {
    files = Array.from(map.values());
  }
  render();
}

function removeFile(idx: number) {
  files = files.filter((_, i) => i !== idx);
  render();
}

function moveFile(from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= files.length || to >= files.length) return;
  const next = [...files];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  files = next;
}

function clearFiles() {
  files = [];
  render();
}

function setActiveTool(next: ToolId) {
  activeTool = next;
  files = [];
  render();
}

function getFilteredTools(): ToolDef[] {
  if (!searchQuery.trim()) return TOOLS;
  const q = searchQuery.toLowerCase();
  return TOOLS.filter(t =>
    t.title.toLowerCase().includes(q) ||
    t.subtitle.toLowerCase().includes(q) ||
    t.tags.some(tag => tag.toLowerCase().includes(q))
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "queued": return "En cola";
    case "running": return "Procesando";
    case "done": return "Completado";
    case "error": return "Error";
    default: return status;
  }
}

function compressionLabel(level: string): string {
  switch (level) {
    case "small": return "Ligera";
    case "balanced": return "Equilibrada";
    case "best": return "Máxima";
    case "aggressive": return "Agresiva";
    default: return level;
  }
}

function jobStatusBadge(status: string): string {
  if (status === "running") return `<span class="spinner"></span>`;
  const cls = status === "done" ? "primary" : status === "error" ? "error" : "";
  return `<span class="badge ${cls}">${statusLabel(status)}</span>`;
}

function compressionDescription(level: string): string {
  switch (level) {
    case "small": return "Reescritura rápida sin recompresión.";
    case "balanced": return "Recompresión estándar con flate.";
    case "best": return "Recompresión agresiva + linearización.";
    case "aggressive": return "Rasteriza páginas a 150 DPI JPEG. Mayor reducción posible — el texto no será seleccionable.";
    default: return "";
  }
}

// --- Job execution ---
async function runJob() {
  if (isJobRunning) return;

  const fileVal = validateFiles();
  if (fileVal?.type === "error") return alert(fileVal.msg);

  if (activeTool === "split") {
    const v = validatePageInput(splitPages);
    if (v?.type === "error") return alert(v.msg);
  }
  if (activeTool === "pdf2img") {
    const v = validateDpiInput(imgDpi);
    if (v?.type === "error") { imgDpi = clampDpi(imgDpi); render(); return alert(v.msg); }
    imgDpi = clampDpi(imgDpi);
  }
  if (activeTool === "protect" && protectMode === "add") {
    const v = validateProtectPassword(protectNewPassword, protectConfirmPassword);
    if (v?.type === "error") return alert(v.msg);
  }
  if (activeTool === "deletepages") {
    const v = validatePageInput(deletePagesInput);
    if (v?.type === "error") return alert(v.msg);
  }
  if (activeTool === "watermark" && !watermarkText.trim()) return alert("Ingresa el texto de la marca de agua.");
  if (activeTool === "reorder") {
    const v = validateReorderInput(reorderInput);
    if (v?.type === "error") return alert(v.msg);
  }

  isJobRunning = true;
  const jobId = uid();
  const tool = TOOLS.find(t => t.id === activeTool)!;
  const job: Job = {
    id: jobId, toolId: activeTool, toolTitle: tool.title,
    createdAt: Date.now(), status: "queued", progress: 0,
    inputCount: files.length, inputSize: totalInputSize(),
  };
  jobs = [job, ...jobs];
  render();

  try {
    if (activeTool === "merge") {
      const payload = await Promise.all(
        files.map(async (f) => ({ name: f.file.name, bytes: await readFileBytes(f.file), password: f.password?.trim() || undefined }))
      );
      const req: WorkerRequest = { type: "merge", jobId, files: payload };
      worker.postMessage(req, payload.map(p => p.bytes));
      return;
    }
    if (activeTool === "split") {
      const { flat, groups } = parsePageGroups(splitPages);
      const f = files[0];
      const bytes = await readFileBytes(f.file);
      const req: WorkerRequest = { type: "split", jobId, file: { name: f.file.name, bytes, password: f.password?.trim() || undefined }, pages: flat, ranges: groups.length ? groups : [flat], output: splitOutput };
      worker.postMessage(req, [bytes]);
      return;
    }
    if (activeTool === "compress") {
      const f = files[0];
      const bytes = await readFileBytes(f.file);
      worker.postMessage({ type: "compress", jobId, file: { name: f.file.name, bytes, password: f.password?.trim() || undefined }, level: compressLevel } as WorkerRequest, [bytes]);
      return;
    }
    if (activeTool === "pdf2img") {
      const f = files[0];
      const bytes = await readFileBytes(f.file);
      worker.postMessage({ type: "pdf2img", jobId, file: { name: f.file.name, bytes, password: f.password?.trim() || undefined }, format: imgFormat, dpi: imgDpi } as WorkerRequest, [bytes]);
      return;
    }
    if (activeTool === "rotate") {
      const f = files[0];
      const bytes = await readFileBytes(f.file);
      const pages = rotateTarget === "range" ? parsePageGroups(rotatePages).flat : [];
      worker.postMessage({ type: "rotate", jobId, file: { name: f.file.name, bytes, password: f.password?.trim() || undefined }, angle: rotateAngle, target: rotateTarget, pages } as WorkerRequest, [bytes]);
      return;
    }
    if (activeTool === "img2pdf") {
      const payload = await Promise.all(files.map(async (f) => ({ name: f.file.name, bytes: await readFileBytes(f.file) })));
      worker.postMessage({ type: "img2pdf", jobId, files: payload, layout: img2pdfLayout } as WorkerRequest, payload.map(p => p.bytes));
      return;
    }
    if (activeTool === "protect") {
      const f = files[0];
      const bytes = await readFileBytes(f.file);
      worker.postMessage({ type: "protect", jobId, file: { name: f.file.name, bytes, password: f.password?.trim() || undefined }, mode: protectMode, newPassword: protectMode === "add" ? protectNewPassword : undefined } as WorkerRequest, [bytes]);
      return;
    }
    if (activeTool === "deletepages") {
      const { flat } = parsePageGroups(deletePagesInput);
      const f = files[0];
      const bytes = await readFileBytes(f.file);
      worker.postMessage({ type: "deletepages", jobId, file: { name: f.file.name, bytes, password: f.password?.trim() || undefined }, pages: flat } as WorkerRequest, [bytes]);
      return;
    }
    if (activeTool === "watermark") {
      const f = files[0];
      const bytes = await readFileBytes(f.file);
      worker.postMessage({ type: "watermark", jobId, file: { name: f.file.name, bytes, password: f.password?.trim() || undefined }, text: watermarkText, opacity: watermarkOpacity, angle: watermarkAngle, size: watermarkSize, color: watermarkColor } as WorkerRequest, [bytes]);
      return;
    }
    if (activeTool === "pagenumbers") {
      const f = files[0];
      const bytes = await readFileBytes(f.file);
      worker.postMessage({ type: "pagenumbers", jobId, file: { name: f.file.name, bytes, password: f.password?.trim() || undefined }, position: pageNumPosition, start: pageNumStart, prefix: pageNumPrefix, fontSize: pageNumFontSize } as WorkerRequest, [bytes]);
      return;
    }
    if (activeTool === "metadata") {
      const f = files[0];
      const bytes = await readFileBytes(f.file);
      worker.postMessage({ type: "metadata", jobId, file: { name: f.file.name, bytes, password: f.password?.trim() || undefined }, title: metaTitle, author: metaAuthor, subject: metaSubject, keywords: metaKeywords, creator: metaCreator } as WorkerRequest, [bytes]);
      return;
    }
    if (activeTool === "extracttext") {
      const f = files[0];
      const bytes = await readFileBytes(f.file);
      worker.postMessage({ type: "extracttext", jobId, file: { name: f.file.name, bytes, password: f.password?.trim() || undefined } } as WorkerRequest, [bytes]);
      return;
    }
    if (activeTool === "crop") {
      const f = files[0];
      const bytes = await readFileBytes(f.file);
      worker.postMessage({ type: "crop", jobId, file: { name: f.file.name, bytes, password: f.password?.trim() || undefined }, top: cropTop, right: cropRight, bottom: cropBottom, left: cropLeft, unit: cropUnit } as WorkerRequest, [bytes]);
      return;
    }
    if (activeTool === "reorder") {
      const order = reorderInput.trim().split(",").map((s) => Number(s.trim()));
      const f = files[0];
      const bytes = await readFileBytes(f.file);
      worker.postMessage({ type: "reorder", jobId, file: { name: f.file.name, bytes, password: f.password?.trim() || undefined }, order } as WorkerRequest, [bytes]);
      return;
    }
  } catch (e: any) {
    isJobRunning = false;
    jobs = jobs.map(j => j.id === jobId ? { ...j, status: "error", error: e?.message ?? String(e) } : j);
    render();
  }
}

// --- Tool list ---
function renderToolsList(filtered: ToolDef[]): string {
  if (filtered.length === 0) return `<div class="small" style="padding:10px;">No se encontraron herramientas.</div>`;
  return filtered.map(t => `
    <button class="toolBtn${t.id === activeTool ? " active" : ""}" data-tool="${t.id}">
      <div class="toolBtnHeader">
        <span class="toolBtnIcon">${TOOL_ICONS[t.id] ?? "📄"}</span>
        <span class="toolBtnName">${t.title}</span>
      </div>
      <div class="p" style="padding-left:36px;">${t.subtitle}</div>
      <div class="badges" style="padding-left:36px;">${t.tags.map(x => `<span class="badge">${x}</span>`).join("")}</div>
    </button>
  `).join("");
}

function bindToolButtons(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(btn => {
    btn.onclick = () => setActiveTool(btn.dataset.tool as ToolId);
  });
}

// --- Options panel per tool ---
function renderOptions(): string {
  const rotatePagesValidation = activeTool === "rotate" && rotateTarget === "range" ? validatePageInput(rotatePages) : null;
  const pageValidation = activeTool === "split" ? validatePageInput(splitPages) : null;
  const dpiValidation = activeTool === "pdf2img" ? validateDpiInput(imgDpi) : null;
  const deletePagesValidation = activeTool === "deletepages" ? validatePageInput(deletePagesInput) : null;
  const pwdValidation = activeTool === "protect" && protectMode === "add" ? validateProtectPassword(protectNewPassword, protectConfirmPassword) : null;
  const reorderValidation = activeTool === "reorder" ? validateReorderInput(reorderInput) : null;

  if (activeTool === "compress") return `
    <div>
      <div class="kv">Nivel de compresión</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
        ${(["small", "balanced", "best", "aggressive"] as const).map(l =>
          `<button class="btn ${compressLevel === l ? "primary" : ""}" data-cmpr="${l}">${compressionLabel(l)}</button>`
        ).join("")}
      </div>
      <div class="small" style="margin-top:6px;">${compressionDescription(compressLevel)}</div>
    </div>`;

  if (activeTool === "split") return `
    <div>
      <div class="kv">Páginas</div>
      <input id="pages" class="input ${pageValidation?.type === "error" ? "invalid" : pageValidation?.type === "ok" ? "valid" : ""}" value="${escapeAttr(splitPages)}" placeholder="ej: 1,2,5-7; 10-12" style="margin-top:6px;" />
      <div id="pageHint">${renderValidationHint(pageValidation)}</div>
      <div class="small" style="margin-top:4px;">Formato: 1,3,5-7 (1-based). Separa rangos con ; para múltiples PDFs en ZIP.</div>
      <div class="kv" style="margin-top:12px;">Salida</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
        ${(["single", "zip"] as const).map(mode =>
          `<button class="btn ${splitOutput === mode ? "primary" : ""}" data-splitout="${mode}">${mode === "single" ? "PDF único" : "ZIP (un PDF por rango)"}</button>`
        ).join("")}
      </div>
    </div>`;

  if (activeTool === "pdf2img") return `
    <div>
      <div class="kv">Formato</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
        ${(["png", "jpg"] as const).map(f =>
          `<button class="btn ${imgFormat === f ? "primary" : ""}" data-imgfmt="${f}">${f.toUpperCase()}</button>`
        ).join("")}
      </div>
      <div class="kv" style="margin-top:10px;">DPI (36–600)</div>
      <input id="dpi" type="number" min="36" max="600" class="input ${dpiValidation?.type === "error" ? "invalid" : dpiValidation?.type === "ok" ? "valid" : ""}" value="${imgDpi}" style="margin-top:6px;" />
      <div id="dpiHint">${renderValidationHint(dpiValidation)}</div>
      <div class="small" style="margin-top:4px;">Genera un ZIP con todas las páginas. Mayor DPI = mayor calidad y tamaño.</div>
    </div>`;

  if (activeTool === "rotate") return `
    <div>
      <div class="kv">Ángulo</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
        ${([90, 180, 270] as const).map(a =>
          `<button class="btn ${rotateAngle === a ? "primary" : ""}" data-rotangle="${a}">${a === 90 ? "90° →" : a === 180 ? "180°" : "270° ←"}</button>`
        ).join("")}
      </div>
      <div class="kv" style="margin-top:12px;">Aplicar a</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
        <button class="btn ${rotateTarget === "all" ? "primary" : ""}" data-rottgt="all">Todas las páginas</button>
        <button class="btn ${rotateTarget === "range" ? "primary" : ""}" data-rottgt="range">Páginas específicas</button>
      </div>
      ${rotateTarget === "range" ? `
        <input id="rotatePages" class="input ${rotatePagesValidation?.type === "error" ? "invalid" : rotatePagesValidation?.type === "ok" ? "valid" : ""}" value="${escapeAttr(rotatePages)}" placeholder="ej: 1,3,5-7" style="margin-top:8px;" />
        <div id="rotatePagesHint">${renderValidationHint(rotatePagesValidation)}</div>
      ` : ""}
    </div>`;

  if (activeTool === "img2pdf") return `
    <div>
      <div class="kv">Tamaño de página</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
        <button class="btn ${img2pdfLayout === "auto" ? "primary" : ""}" data-img2pdflayout="auto">Auto (tamaño de imagen)</button>
        <button class="btn ${img2pdfLayout === "a4" ? "primary" : ""}" data-img2pdflayout="a4">A4</button>
        <button class="btn ${img2pdfLayout === "letter" ? "primary" : ""}" data-img2pdflayout="letter">Letter</button>
      </div>
      <div class="small" style="margin-top:6px;">Cada imagen se convierte en una página. Con A4/Letter la imagen se escala para ajustarse.</div>
    </div>`;

  if (activeTool === "protect") return `
    <div>
      <div class="kv">Modo</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
        <button class="btn ${protectMode === "add" ? "primary" : ""}" data-protmode="add">Añadir contraseña</button>
        <button class="btn ${protectMode === "remove" ? "primary" : ""}" data-protmode="remove">Quitar contraseña</button>
      </div>
      ${protectMode === "add" ? `
        <div style="margin-top:12px;">
          <div class="kv">Nueva contraseña</div>
          <input id="newPwd" class="input" type="password" value="${escapeAttr(protectNewPassword)}" placeholder="Contraseña nueva" style="margin-top:6px;" autocomplete="new-password" />
          <div class="kv" style="margin-top:8px;">Confirmar contraseña</div>
          <input id="confirmPwd" class="input" type="password" value="${escapeAttr(protectConfirmPassword)}" placeholder="Repetir contraseña" style="margin-top:6px;" autocomplete="new-password" />
          <div id="pwdHint">${renderValidationHint(pwdValidation)}</div>
        </div>
      ` : `
        <div class="small" style="margin-top:8px;">Usa el campo de contraseña en el archivo para desencriptar. El PDF resultante no tendrá contraseña.</div>
      `}
    </div>`;

  if (activeTool === "deletepages") return `
    <div>
      <div class="kv">Páginas a eliminar</div>
      <input id="deletePages" class="input ${deletePagesValidation?.type === "error" ? "invalid" : deletePagesValidation?.type === "ok" ? "valid" : ""}" value="${escapeAttr(deletePagesInput)}" placeholder="ej: 1,3,5-7" style="margin-top:6px;" />
      <div id="deletePagesHint">${renderValidationHint(deletePagesValidation)}</div>
      <div class="small" style="margin-top:4px;">Las páginas indicadas serán eliminadas del PDF resultante. Las demás se conservan.</div>
    </div>`;

  if (activeTool === "watermark") return `
    <div>
      <div class="kv">Texto</div>
      <input id="wmText" class="input" value="${escapeAttr(watermarkText)}" placeholder="ej: CONFIDENCIAL" style="margin-top:6px;" />
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px;">
        <div>
          <div class="kv">Opacidad (%)</div>
          <input id="wmOpacity" type="number" min="1" max="100" class="input" value="${watermarkOpacity}" style="margin-top:4px;" />
        </div>
        <div>
          <div class="kv">Ángulo (°)</div>
          <input id="wmAngle" type="number" min="-180" max="180" class="input" value="${watermarkAngle}" style="margin-top:4px;" />
        </div>
        <div>
          <div class="kv">Tamaño (pt)</div>
          <input id="wmSize" type="number" min="8" max="300" class="input" value="${watermarkSize}" style="margin-top:4px;" />
        </div>
        <div>
          <div class="kv">Color</div>
          <input id="wmColor" type="color" class="input" value="${watermarkColor}" style="margin-top:4px; height:36px; padding:2px;" />
        </div>
      </div>
    </div>`;

  if (activeTool === "pagenumbers") return `
    <div>
      <div class="kv">Posición</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
        <button class="btn ${pageNumPosition === "bottom-left" ? "primary" : ""}" data-pgpos="bottom-left">Inf. izquierda</button>
        <button class="btn ${pageNumPosition === "bottom-center" ? "primary" : ""}" data-pgpos="bottom-center">Inf. centro</button>
        <button class="btn ${pageNumPosition === "bottom-right" ? "primary" : ""}" data-pgpos="bottom-right">Inf. derecha</button>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px;">
        <div>
          <div class="kv">Número inicial</div>
          <input id="pgStart" type="number" min="0" class="input" value="${pageNumStart}" style="margin-top:4px;" />
        </div>
        <div>
          <div class="kv">Prefijo</div>
          <input id="pgPrefix" class="input" value="${escapeAttr(pageNumPrefix)}" placeholder="ej: Pág. " style="margin-top:4px;" />
        </div>
        <div>
          <div class="kv">Tamaño fuente (pt)</div>
          <input id="pgSize" type="number" min="6" max="72" class="input" value="${pageNumFontSize}" style="margin-top:4px;" />
        </div>
      </div>
    </div>`;

  if (activeTool === "metadata") return `
    <div>
      <div class="small" style="margin-bottom:8px;">Los campos vacíos conservan los metadatos actuales del PDF.</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <div>
          <div class="kv">Título</div>
          <input id="metaTitle" class="input" value="${escapeAttr(metaTitle)}" placeholder="Título del documento" style="margin-top:4px;" />
        </div>
        <div>
          <div class="kv">Autor</div>
          <input id="metaAuthor" class="input" value="${escapeAttr(metaAuthor)}" placeholder="Nombre del autor" style="margin-top:4px;" />
        </div>
        <div>
          <div class="kv">Tema</div>
          <input id="metaSubject" class="input" value="${escapeAttr(metaSubject)}" placeholder="Tema del documento" style="margin-top:4px;" />
        </div>
        <div>
          <div class="kv">Palabras clave</div>
          <input id="metaKeywords" class="input" value="${escapeAttr(metaKeywords)}" placeholder="palabra1, palabra2" style="margin-top:4px;" />
        </div>
        <div>
          <div class="kv">Creador</div>
          <input id="metaCreator" class="input" value="${escapeAttr(metaCreator)}" placeholder="Aplicación creadora" style="margin-top:4px;" />
        </div>
      </div>
    </div>`;

  if (activeTool === "extracttext") return `
    <div>
      <div class="small">Extrae el texto de todas las páginas y genera un archivo <strong>.txt</strong>. Requiere que el PDF tenga texto seleccionable (no funciona con PDFs escaneados sin OCR).</div>
    </div>`;

  if (activeTool === "crop") return `
    <div>
      <div class="kv">Unidad</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
        <button class="btn ${cropUnit === "mm" ? "primary" : ""}" data-cropunit="mm">Milímetros (mm)</button>
        <button class="btn ${cropUnit === "pt" ? "primary" : ""}" data-cropunit="pt">Puntos (pt)</button>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px;">
        <div>
          <div class="kv">Superior</div>
          <input id="cropTop" type="number" min="0" class="input" value="${cropTop}" style="margin-top:4px;" />
        </div>
        <div>
          <div class="kv">Inferior</div>
          <input id="cropBottom" type="number" min="0" class="input" value="${cropBottom}" style="margin-top:4px;" />
        </div>
        <div>
          <div class="kv">Izquierdo</div>
          <input id="cropLeft" type="number" min="0" class="input" value="${cropLeft}" style="margin-top:4px;" />
        </div>
        <div>
          <div class="kv">Derecho</div>
          <input id="cropRight" type="number" min="0" class="input" value="${cropRight}" style="margin-top:4px;" />
        </div>
      </div>
      <div class="small" style="margin-top:6px;">Reduce el área visible de todas las páginas. El contenido fuera del recorte quedará oculto pero no se elimina definitivamente.</div>
    </div>`;

  if (activeTool === "reorder") return `
    <div>
      <div class="kv">Nuevo orden de páginas</div>
      <input id="reorderInput" class="input ${reorderValidation?.type === "error" ? "invalid" : reorderValidation?.type === "ok" ? "valid" : ""}" value="${escapeAttr(reorderInput)}" placeholder="ej: 3,1,2,4,5 — todas las páginas en el nuevo orden" style="margin-top:6px;" />
      <div id="reorderHint">${renderValidationHint(reorderValidation)}</div>
      <div class="small" style="margin-top:4px;">Lista completa de páginas (1-based) en el nuevo orden, separadas por comas. Cada página original debe aparecer exactamente una vez.</div>
    </div>`;

  return `<div class="small">Sin opciones adicionales para esta herramienta.</div>`;
}

// --- Render ---
function render() {
  const tool = TOOLS.find(t => t.id === activeTool)!;
  const filteredTools = getFilteredTools();
  const themeIcon = currentTheme === "light" ? "\u{1F319}" : "\u{2600}\u{FE0F}";
  const isImgTool = activeTool === "img2pdf";
  const isMultiTool = activeTool === "merge" || activeTool === "img2pdf";
  const runEnabled = canRun();
  const fileValidation = files.length > 0 ? validateFiles() : null;
  const showPasswordField = !isImgTool;

  const dropLabel = isImgTool ? "Arrastra imágenes aquí" : "Arrastra PDFs aquí";
  const dropSub = isImgTool ? "JPG y PNG admitidos" : "o haz clic en <strong>Subir</strong>";

  app.innerHTML = `
    <div class="topbar">
      <div class="container row">
        <div class="brand">
          <div class="logo">\u{1F4C4}</div>
          <div>
            <div class="h1">PDF Toolkit</div>
            <div class="p">100% local • Sin subida de archivos</div>
          </div>
        </div>
        <div style="display:flex; gap:10px; align-items:center; width:420px; max-width:50vw;">
          <input id="search" class="input" placeholder="Buscar herramientas…" value="${escapeAttr(searchQuery)}" />
          <button class="themeBtn" id="themeToggle" title="Cambiar tema">${themeIcon}</button>
        </div>
      </div>
    </div>

    <div class="container grid">
      <div class="card">
        <div class="cardHeader"><div class="h1">Herramientas</div></div>
        <div class="tools" id="tools"></div>
      </div>

      <div style="display:flex; flex-direction:column; gap: 16px;">
        <div class="card">
          <div class="cardBody">
            <div class="row">
              <div>
                <div class="h2">${tool.title}</div>
                <div class="p">${tool.subtitle}</div>
                <div class="badges">
                  ${tool.tags.map(t => `<span class="badge">${t}</span>`).join("")}
                  <span class="badge primary">Modo privado</span>
                </div>
              </div>
              <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                <button class="btn" id="pick">Subir</button>
                <button class="btn" id="clear" ${files.length ? "" : "disabled"}>Limpiar</button>
                <button class="btn primary" id="run" ${runEnabled ? "" : "disabled"}>${isJobRunning ? "Procesando…" : "Ejecutar"}</button>
              </div>
            </div>

            <div class="split"></div>

            <div class="drop" id="drop">
              <div class="dropIcon">⬆</div>
              <div class="dropTitle">${dropLabel}</div>
              <div class="small">${dropSub}</div>
            </div>

            <div class="files" id="files">
              ${isMultiTool && files.length > 1 ? `<div class="small" style="margin-bottom:2px;">Arrastra los nombres para reordenar.</div>` : ""}
              ${files.length === 0 ? `<div class="small">Sin archivos seleccionados.</div>` : files.map((f, idx) => `
                <div class="fileRow" data-idx="${idx}">
                  ${isMultiTool && files.length > 1 ? `<div class="dragHandle" title="Arrastra para reordenar" aria-hidden="true">↕</div>` : ""}
                  <div class="icon">${isImgTool ? "🖼️" : "\u{1F4C4}"}</div>
                  <div class="fileInfo">
                    <div class="fileName">${escapeAttr(f.file.name)}</div>
                    <div class="fileMeta">${prettyBytes(f.file.size)}</div>
                  </div>
                  ${showPasswordField ? `
                    <div class="filePassword">
                      <input class="input" data-pass="${idx}" value="${escapeAttr(f.password ?? "")}" placeholder="Contraseña (si protegido)" autocomplete="off" />
                      <div class="small">Solo en tu navegador.</div>
                    </div>
                  ` : ""}
                  <button class="btn" data-rm="${idx}">Quitar</button>
                </div>
              `).join("")}
              ${renderValidationHint(fileValidation)}
            </div>

            <div class="split"></div>

            <div class="card" style="box-shadow:none;">
              <div class="cardBody" style="padding:0;">
                <div class="h1">Opciones</div>
                <div class="p">Todo se procesa en un Web Worker (sin subida a servidores).</div>
                <div style="margin-top: 12px;">${renderOptions()}</div>
              </div>
            </div>

          </div>
        </div>

        <div class="card">
          <div class="cardHeader">
            <div class="row">
              <div class="h1">Historial</div>
              <button class="btn" id="clearJobs" ${jobs.length ? "" : "disabled"}>Limpiar</button>
            </div>
          </div>
          <div class="cardBody">
            <div class="jobs" id="jobs">
              ${jobs.length === 0 ? `<div class="small">Sin trabajos aún.</div>` : jobs.map(j => {
                const outputSize = j.outputBlob?.size;
                const sizeInfo = j.inputSize ? `Entrada: ${prettyBytes(j.inputSize)}` : "";
                const outputInfo = outputSize ? ` → Salida: ${prettyBytes(outputSize)}` : "";
                const reduction = (j.inputSize && outputSize && j.toolId === "compress" && outputSize < j.inputSize)
                  ? ` (↓${Math.round((1 - outputSize / j.inputSize) * 100)}%)`
                  : "";
                return `
                <div class="jobRow ${j.status}">
                  <div class="row">
                    <div style="min-width:0">
                      <div style="font-weight:700; font-size: 13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${j.toolTitle}</div>
                      <div class="kv">${new Date(j.createdAt).toLocaleString()} • ${j.inputCount} archivo(s)</div>
                      ${sizeInfo ? `<div class="jobSize">${sizeInfo}${outputInfo}${reduction ? `<span class="reduction">${reduction}</span>` : ""}</div>` : ""}
                    </div>
                    <div>${jobStatusBadge(j.status)}</div>
                  </div>
                  <div style="margin-top:10px;">
                    <div class="progressBar"><div class="progressFill ${j.status === 'running' ? 'running' : ''}" style="width:${j.progress}%"></div></div>
                    <div class="kv" style="margin-top:6px;">${j.progress}%${j.progressNote ? ` – ${escapeAttr(j.progressNote)}` : ""}</div>
                  </div>
                  ${j.error ? `<div class="err">${escapeAttr(j.error)}</div>` : ""}
                  ${j.status === "done" && j.outputBlob && j.outputName ? `
                    <div class="successMsg">Proceso completado exitosamente.</div>
                    <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
                      <button class="btn primary" data-dl="${j.id}">Descargar ${escapeAttr(j.outputName)}</button>
                    </div>
                  ` : ""}
                </div>`;
              }).join("")}
            </div>
          </div>
        </div>

        <div class="small" style="text-align:center;">
          Todos los archivos se procesan localmente en tu navegador. Nada se sube a ningún servidor.
        </div>
      </div>
    </div>
  `;

  // tools list
  const toolsEl = document.getElementById("tools")!;
  toolsEl.innerHTML = renderToolsList(filteredTools);
  bindToolButtons(toolsEl);

  // file input
  const input = document.createElement("input");
  input.type = "file";
  input.accept = isImgTool ? "image/jpeg,image/png,.jpg,.jpeg,.png" : "application/pdf,.pdf";
  input.multiple = isMultiTool;
  input.onchange = () => onFilesChosen(input.files);

  document.getElementById("pick")!.onclick = () => input.click();
  document.getElementById("clear")!.onclick = clearFiles;
  document.getElementById("run")!.onclick = runJob;
  document.getElementById("clearJobs")!.onclick = () => { jobs = []; render(); };
  document.getElementById("themeToggle")!.onclick = toggleTheme;

  // search
  const searchEl = document.getElementById("search") as HTMLInputElement;
  searchEl.oninput = () => {
    searchQuery = searchEl.value;
    const toolsContainer = document.getElementById("tools")!;
    toolsContainer.innerHTML = renderToolsList(getFilteredTools());
    bindToolButtons(toolsContainer);
  };

  // file remove
  document.querySelectorAll<HTMLButtonElement>("[data-rm]").forEach(b => {
    b.onclick = () => removeFile(Number(b.dataset.rm));
  });

  // passwords
  document.querySelectorAll<HTMLInputElement>("[data-pass]").forEach(inp => {
    inp.oninput = () => {
      const idx = Number(inp.dataset.pass);
      if (Number.isFinite(idx) && files[idx]) files[idx] = { ...files[idx], password: inp.value };
    };
  });

  // compress options
  document.querySelectorAll<HTMLButtonElement>("[data-cmpr]").forEach(b => {
    b.onclick = () => { compressLevel = b.dataset.cmpr as any; render(); };
  });

  // split options
  document.querySelectorAll<HTMLButtonElement>("[data-splitout]").forEach(b => {
    b.onclick = () => { splitOutput = b.dataset.splitout as any; render(); };
  });
  const pagesEl = document.getElementById("pages") as HTMLInputElement | null;
  if (pagesEl) pagesEl.oninput = () => {
    splitPages = pagesEl.value;
    const v = validatePageInput(splitPages);
    const hint = document.getElementById("pageHint");
    if (hint) hint.innerHTML = renderValidationHint(v);
    pagesEl.className = `input ${v?.type === "error" ? "invalid" : v?.type === "ok" ? "valid" : ""}`;
    const runBtn = document.getElementById("run") as HTMLButtonElement | null;
    if (runBtn) runBtn.disabled = !canRun();
  };

  // pdf2img options
  document.querySelectorAll<HTMLButtonElement>("[data-imgfmt]").forEach(b => {
    b.onclick = () => { imgFormat = b.dataset.imgfmt as any; render(); };
  });
  const dpiEl = document.getElementById("dpi") as HTMLInputElement | null;
  if (dpiEl) dpiEl.oninput = () => {
    const raw = Number(dpiEl.value);
    imgDpi = Number.isFinite(raw) ? raw : 150;
    const v = validateDpiInput(imgDpi);
    const hint = document.getElementById("dpiHint");
    if (hint) hint.innerHTML = renderValidationHint(v);
    dpiEl.className = `input ${v?.type === "error" ? "invalid" : v?.type === "ok" ? "valid" : ""}`;
    const runBtn = document.getElementById("run") as HTMLButtonElement | null;
    if (runBtn) runBtn.disabled = !canRun();
  };

  // rotate options
  document.querySelectorAll<HTMLButtonElement>("[data-rotangle]").forEach(b => {
    b.onclick = () => { rotateAngle = Number(b.dataset.rotangle) as any; render(); };
  });
  document.querySelectorAll<HTMLButtonElement>("[data-rottgt]").forEach(b => {
    b.onclick = () => { rotateTarget = b.dataset.rottgt as any; render(); };
  });
  const rotatePagesEl = document.getElementById("rotatePages") as HTMLInputElement | null;
  if (rotatePagesEl) rotatePagesEl.oninput = () => {
    rotatePages = rotatePagesEl.value;
    const v = validatePageInput(rotatePages);
    const hint = document.getElementById("rotatePagesHint");
    if (hint) hint.innerHTML = renderValidationHint(v);
    rotatePagesEl.className = `input ${v?.type === "error" ? "invalid" : v?.type === "ok" ? "valid" : ""}`;
    const runBtn = document.getElementById("run") as HTMLButtonElement | null;
    if (runBtn) runBtn.disabled = !canRun();
  };

  // img2pdf options
  document.querySelectorAll<HTMLButtonElement>("[data-img2pdflayout]").forEach(b => {
    b.onclick = () => { img2pdfLayout = b.dataset.img2pdflayout as any; render(); };
  });

  // protect options
  document.querySelectorAll<HTMLButtonElement>("[data-protmode]").forEach(b => {
    b.onclick = () => { protectMode = b.dataset.protmode as any; render(); };
  });
  const newPwdEl = document.getElementById("newPwd") as HTMLInputElement | null;
  if (newPwdEl) newPwdEl.oninput = () => {
    protectNewPassword = newPwdEl.value;
    const hint = document.getElementById("pwdHint");
    if (hint) hint.innerHTML = renderValidationHint(validateProtectPassword(protectNewPassword, protectConfirmPassword));
    const runBtn = document.getElementById("run") as HTMLButtonElement | null;
    if (runBtn) runBtn.disabled = !canRun();
  };
  const confirmPwdEl = document.getElementById("confirmPwd") as HTMLInputElement | null;
  if (confirmPwdEl) confirmPwdEl.oninput = () => {
    protectConfirmPassword = confirmPwdEl.value;
    const hint = document.getElementById("pwdHint");
    if (hint) hint.innerHTML = renderValidationHint(validateProtectPassword(protectNewPassword, protectConfirmPassword));
    const runBtn = document.getElementById("run") as HTMLButtonElement | null;
    if (runBtn) runBtn.disabled = !canRun();
  };

  // deletepages options
  const deletePagesEl = document.getElementById("deletePages") as HTMLInputElement | null;
  if (deletePagesEl) deletePagesEl.oninput = () => {
    deletePagesInput = deletePagesEl.value;
    const v = validatePageInput(deletePagesInput);
    const hint = document.getElementById("deletePagesHint");
    if (hint) hint.innerHTML = renderValidationHint(v);
    deletePagesEl.className = `input ${v?.type === "error" ? "invalid" : v?.type === "ok" ? "valid" : ""}`;
    const runBtn = document.getElementById("run") as HTMLButtonElement | null;
    if (runBtn) runBtn.disabled = !canRun();
  };

  // watermark options
  const wmTextEl = document.getElementById("wmText") as HTMLInputElement | null;
  if (wmTextEl) wmTextEl.oninput = () => { watermarkText = wmTextEl.value; const runBtn = document.getElementById("run") as HTMLButtonElement | null; if (runBtn) runBtn.disabled = !canRun(); };
  const wmOpacityEl = document.getElementById("wmOpacity") as HTMLInputElement | null;
  if (wmOpacityEl) wmOpacityEl.oninput = () => { watermarkOpacity = Number(wmOpacityEl.value) || 30; };
  const wmAngleEl = document.getElementById("wmAngle") as HTMLInputElement | null;
  if (wmAngleEl) wmAngleEl.oninput = () => { watermarkAngle = Number(wmAngleEl.value) || 0; };
  const wmSizeEl = document.getElementById("wmSize") as HTMLInputElement | null;
  if (wmSizeEl) wmSizeEl.oninput = () => { watermarkSize = Math.max(8, Number(wmSizeEl.value) || 60); };
  const wmColorEl = document.getElementById("wmColor") as HTMLInputElement | null;
  if (wmColorEl) wmColorEl.oninput = () => { watermarkColor = wmColorEl.value; };

  // pagenumbers options
  document.querySelectorAll<HTMLButtonElement>("[data-pgpos]").forEach(b => {
    b.onclick = () => { pageNumPosition = b.dataset.pgpos as any; render(); };
  });
  const pgStartEl = document.getElementById("pgStart") as HTMLInputElement | null;
  if (pgStartEl) pgStartEl.oninput = () => { pageNumStart = Number(pgStartEl.value) || 1; };
  const pgPrefixEl = document.getElementById("pgPrefix") as HTMLInputElement | null;
  if (pgPrefixEl) pgPrefixEl.oninput = () => { pageNumPrefix = pgPrefixEl.value; };
  const pgSizeEl = document.getElementById("pgSize") as HTMLInputElement | null;
  if (pgSizeEl) pgSizeEl.oninput = () => { pageNumFontSize = Math.max(6, Number(pgSizeEl.value) || 11); };

  // metadata options
  const metaTitleEl = document.getElementById("metaTitle") as HTMLInputElement | null;
  if (metaTitleEl) metaTitleEl.oninput = () => { metaTitle = metaTitleEl.value; };
  const metaAuthorEl = document.getElementById("metaAuthor") as HTMLInputElement | null;
  if (metaAuthorEl) metaAuthorEl.oninput = () => { metaAuthor = metaAuthorEl.value; };
  const metaSubjectEl = document.getElementById("metaSubject") as HTMLInputElement | null;
  if (metaSubjectEl) metaSubjectEl.oninput = () => { metaSubject = metaSubjectEl.value; };
  const metaKeywordsEl = document.getElementById("metaKeywords") as HTMLInputElement | null;
  if (metaKeywordsEl) metaKeywordsEl.oninput = () => { metaKeywords = metaKeywordsEl.value; };
  const metaCreatorEl = document.getElementById("metaCreator") as HTMLInputElement | null;
  if (metaCreatorEl) metaCreatorEl.oninput = () => { metaCreator = metaCreatorEl.value; };

  // crop options
  document.querySelectorAll<HTMLButtonElement>("[data-cropunit]").forEach(b => {
    b.onclick = () => { cropUnit = b.dataset.cropunit as any; render(); };
  });
  const cropTopEl = document.getElementById("cropTop") as HTMLInputElement | null;
  if (cropTopEl) cropTopEl.oninput = () => { cropTop = Math.max(0, Number(cropTopEl.value) || 0); };
  const cropBottomEl = document.getElementById("cropBottom") as HTMLInputElement | null;
  if (cropBottomEl) cropBottomEl.oninput = () => { cropBottom = Math.max(0, Number(cropBottomEl.value) || 0); };
  const cropLeftEl = document.getElementById("cropLeft") as HTMLInputElement | null;
  if (cropLeftEl) cropLeftEl.oninput = () => { cropLeft = Math.max(0, Number(cropLeftEl.value) || 0); };
  const cropRightEl = document.getElementById("cropRight") as HTMLInputElement | null;
  if (cropRightEl) cropRightEl.oninput = () => { cropRight = Math.max(0, Number(cropRightEl.value) || 0); };

  // reorder options
  const reorderEl = document.getElementById("reorderInput") as HTMLInputElement | null;
  if (reorderEl) reorderEl.oninput = () => {
    reorderInput = reorderEl.value;
    const v = validateReorderInput(reorderInput);
    const hint = document.getElementById("reorderHint");
    if (hint) hint.innerHTML = renderValidationHint(v);
    reorderEl.className = `input ${v?.type === "error" ? "invalid" : v?.type === "ok" ? "valid" : ""}`;
    const runBtn = document.getElementById("run") as HTMLButtonElement | null;
    if (runBtn) runBtn.disabled = !canRun();
  };

  // drop zone
  const drop = document.getElementById("drop")!;
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("dragover"); });
  drop.addEventListener("dragleave", () => { drop.classList.remove("dragover"); });
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("dragover");
    if (e.dataTransfer?.files) onFilesChosen(e.dataTransfer.files);
  });

  // downloads
  document.querySelectorAll<HTMLButtonElement>("[data-dl]").forEach(b => {
    b.onclick = () => {
      const job = jobs.find(j => j.id === b.dataset.dl);
      if (job?.outputBlob && job.outputName) downloadBlob(job.outputBlob, job.outputName);
    };
  });

  // file reordering (merge + img2pdf)
  const rows = document.querySelectorAll<HTMLDivElement>(".fileRow[data-idx]");
  rows.forEach(row => {
    const idx = Number(row.dataset.idx);
    const canReorder = isMultiTool && files.length > 1;
    row.draggable = canReorder;
    if (!canReorder) return;

    row.ondragstart = (e) => {
      draggingIdx = idx;
      row.classList.add("dragging");
      e.dataTransfer?.setData("text/plain", String(idx));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    };
    row.ondragend = () => {
      draggingIdx = null;
      row.classList.remove("dragging");
      rows.forEach(r => r.classList.remove("dropTarget"));
    };
    row.ondragover = (e) => {
      if (draggingIdx === null || draggingIdx === idx) return;
      e.preventDefault();
      row.classList.add("dropTarget");
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    };
    row.ondragleave = () => row.classList.remove("dropTarget");
    row.ondrop = (e) => {
      e.preventDefault();
      row.classList.remove("dropTarget");
      const from = draggingIdx ?? Number(e.dataTransfer?.getData("text/plain"));
      draggingIdx = null;
      if (Number.isFinite(from)) moveFile(Number(from), idx);
      render();
    };
  });
}

render();
