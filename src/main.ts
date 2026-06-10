import "./styles.css";
import type { Job, ToolDef, ToolId } from "./types";
import type { WorkerEvent, WorkerRequest } from "./worker/messages";
import type { ThumbEvent } from "./worker/thumb.worker";
import { buildZip } from "./utils/zip";

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
  { id: "reorder",     title: "Reordenar páginas",      subtitle: "Cambia el orden de las páginas con vista visual",     tags: ["Páginas", "Offline"],          accepts: "pdf",   output: "pdf" },
];

const TOOL_ICONS: Record<string, string> = {
  merge:"🔗", split:"✂️", compress:"🗜️", pdf2img:"🖼️",
  rotate:"🔄", img2pdf:"📸", protect:"🔒", deletepages:"🗑️",
  watermark:"💧", pagenumbers:"🔢", metadata:"🏷️",
  extracttext:"📝", crop:"✂", reorder:"↕️",
};

const TOOL_GROUPS: { name: string; tools: ToolId[] }[] = [
  { name: "Organizar", tools: ["merge", "split", "reorder", "deletepages", "rotate"] },
  { name: "Convertir", tools: ["pdf2img", "img2pdf", "extracttext"] },
  { name: "Mejorar",   tools: ["watermark", "pagenumbers", "metadata", "crop"] },
  { name: "Seguridad", tools: ["protect", "compress"] },
];

const app = document.querySelector<HTMLDivElement>("#app")!;

// ─── Theme ────────────────────────────────────────────────
function getPreferredTheme(): "light" | "dark" {
  const s = localStorage.getItem("pdf-toolkit-theme");
  if (s === "light" || s === "dark") return s;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
let currentTheme = getPreferredTheme();
function applyTheme() { document.documentElement.setAttribute("data-theme", currentTheme); }
function toggleTheme() {
  currentTheme = currentTheme === "light" ? "dark" : "light";
  localStorage.setItem("pdf-toolkit-theme", currentTheme);
  applyTheme(); render();
}
applyTheme();

// ─── Utilities ────────────────────────────────────────────
function uid() { return `job_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`; }

function prettyBytes(b: number) {
  if (!Number.isFinite(b) || b <= 0) return "–";
  const u = ["B","KB","MB","GB"]; let v = b, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function escapeAttr(v: string) {
  return v.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function clampDpi(v: number) { return Math.max(36, Math.min(600, Math.round(Number.isFinite(v) ? v : 150))); }

function jpegBufToDataUrl(buf: ArrayBuffer): string {
  const arr = new Uint8Array(buf);
  let s = ""; for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return `data:image/jpeg;base64,${btoa(s)}`;
}

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const WARN_FILE_SIZE = 100 * 1024 * 1024;
const MAX_MERGE_FILES = 50;
const JOBS_STORAGE_KEY = "pdf-toolkit-jobs-v3";

// ─── PWA install prompt ───────────────────────────────────
let deferredInstallPrompt: any = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  render();
});
window.addEventListener("appinstalled", () => { deferredInstallPrompt = null; render(); });

// Register service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => { /* ignore */ });
}

// ─── Workers ──────────────────────────────────────────────
function createEngineWorker(): Worker {
  const w = new Worker(new URL("./worker/engine.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = handleEngineMessage;
  return w;
}
let engineWorker = createEngineWorker();

const thumbWorker = new Worker(new URL("./worker/thumb.worker.ts", import.meta.url), { type: "module" });
thumbWorker.onmessage = handleThumbMessage;

// ─── Thumbnail state ──────────────────────────────────────
const thumbPages: Record<string, string[]> = {};
const thumbTotal: Record<string, number> = {};
const thumbLoading = new Set<string>();
const thumbFailed = new Set<string>();

function requestThumbnails(sf: SelectedFile) {
  const key = sf.key;
  if (thumbLoading.has(key) || thumbTotal[key] !== undefined) return;
  thumbLoading.add(key);
  thumbPages[key] = [];
  sf.file.arrayBuffer().then((bytes) => {
    thumbWorker.postMessage({ fileKey: key, bytes }, [bytes]);
  });
}

function clearThumbs(key: string) {
  delete thumbPages[key];
  delete thumbTotal[key];
  thumbLoading.delete(key);
  thumbFailed.delete(key);
}

function handleThumbMessage(ev: MessageEvent<ThumbEvent>) {
  const msg = ev.data;
  if (msg.type === "thumb") {
    if (!thumbPages[msg.fileKey]) thumbPages[msg.fileKey] = [];
    thumbPages[msg.fileKey][msg.index] = jpegBufToDataUrl(msg.jpeg);
    thumbTotal[msg.fileKey] = msg.total;
    if (activeTool === "reorder" && files.length === 1 && files[0].key === msg.fileKey && reorderVisualOrder.length === 0) {
      reorderVisualOrder = Array.from({ length: msg.total }, (_, i) => i + 1);
      reorderInput = reorderVisualOrder.join(",");
    }
    render();
  } else if (msg.type === "thumbDone") {
    thumbLoading.delete(msg.fileKey);
    thumbTotal[msg.fileKey] = msg.total;
    if (activeTool === "reorder" && files.length === 1 && files[0].key === msg.fileKey && reorderVisualOrder.length === 0) {
      reorderVisualOrder = Array.from({ length: msg.total }, (_, i) => i + 1);
      reorderInput = reorderVisualOrder.join(",");
    }
    render();
  } else if (msg.type === "thumbError") {
    thumbLoading.delete(msg.fileKey);
    thumbFailed.add(msg.fileKey);
    render();
  }
}

// ─── Job queue ────────────────────────────────────────────
interface PendingJob { jobId: string; req: WorkerRequest; xfers: ArrayBuffer[]; }
const pendingJobs: PendingJob[] = [];

function processNextPendingJob() {
  if (isJobRunning || pendingJobs.length === 0) return;
  const next = pendingJobs.shift()!;
  jobs = jobs.map(j => j.id === next.jobId ? { ...j, status: "running" } : j);
  isJobRunning = true;
  engineWorker.postMessage(next.req, next.xfers);
  render();
}

// ─── Persistent history ───────────────────────────────────
function saveJobsToStorage() {
  try {
    const toSave = jobs.slice(0, 50).map(({ outputBlob: _ob, ...j }) => ({
      ...j,
      status: (j.status === "running" || j.status === "queued") ? "error" as const : j.status,
      error: (j.status === "running" || j.status === "queued") ? "Interrumpido" : j.error,
    }));
    localStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(toSave));
  } catch { /* quota */ }
}

function loadJobsFromStorage() {
  try {
    const raw = localStorage.getItem(JOBS_STORAGE_KEY);
    if (!raw) return;
    const parsed: Omit<Job, "outputBlob">[] = JSON.parse(raw);
    jobs = parsed.map(j => ({ ...j, outputBlob: undefined }));
  } catch { /* invalid */ }
}

// ─── URL hash state ───────────────────────────────────────
function updateURLHash() {
  const p: Record<string, string> = { t: activeTool };
  if (activeTool === "compress") p.cl = compressLevel;
  if (activeTool === "split") { p.sp = splitPages; p.so = splitOutput; }
  if (activeTool === "pdf2img") { p.fmt = imgFormat; p.dpi = String(imgDpi); }
  if (activeTool === "rotate") { p.ra = String(rotateAngle); p.rt = rotateTarget; if (rotateTarget === "range") p.rp = rotatePages; }
  if (activeTool === "img2pdf") p.lay = img2pdfLayout;
  if (activeTool === "protect") p.pm = protectMode;
  if (activeTool === "pagenumbers") { p.pp = pageNumPosition; p.ps = String(pageNumStart); }
  if (activeTool === "crop") p.cu = cropUnit;
  history.replaceState(null, "", "#" + new URLSearchParams(p));
}

function restoreFromURLHash() {
  if (!location.hash) return;
  try {
    const h = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
    if (!h.t) return;
    const id = h.t as ToolId;
    if (!TOOLS.find(t => t.id === id)) return;
    activeTool = id;
    if (h.cl) compressLevel = h.cl as any;
    if (h.sp) splitPages = h.sp;
    if (h.so) splitOutput = h.so as any;
    if (h.fmt) imgFormat = h.fmt as any;
    if (h.dpi) imgDpi = Number(h.dpi) || 150;
    if (h.ra) rotateAngle = Number(h.ra) as any;
    if (h.rt) rotateTarget = h.rt as any;
    if (h.rp) rotatePages = h.rp;
    if (h.lay) img2pdfLayout = h.lay as any;
    if (h.pm) protectMode = h.pm as any;
    if (h.pp) pageNumPosition = h.pp as any;
    if (h.ps) pageNumStart = Number(h.ps) || 1;
    if (h.cu) cropUnit = h.cu as any;
  } catch { /* bad hash */ }
}

// ─── Engine worker message handler ────────────────────────
function handleEngineMessage(ev: MessageEvent<WorkerEvent>) {
  const msg = ev.data;
  if (msg.type === "progress") {
    jobs = jobs.map(j => j.id === msg.jobId ? { ...j, status: "running", progress: msg.progress, progressNote: msg.note } : j);
    render();
  } else if (msg.type === "result") {
    const blob = new Blob([msg.outputBytes], { type: msg.mime });
    jobs = jobs.map(j => j.id === msg.jobId ? { ...j, status: "done", progress: 100, progressNote: undefined, outputName: msg.outputName, outputBlob: blob } : j);
    isJobRunning = false;
    saveJobsToStorage();
    processNextPendingJob();
    render();
  } else if (msg.type === "error") {
    jobs = jobs.map(j => j.id === msg.jobId ? { ...j, status: "error", progressNote: undefined, error: msg.message } : j);
    isJobRunning = false;
    saveJobsToStorage();
    processNextPendingJob();
    render();
  }
}

// ─── State ────────────────────────────────────────────────
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
let splitVisualMode = false;
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
let deleteVisualMode = false;
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
let cropTop = 0; let cropRight = 0; let cropBottom = 0; let cropLeft = 0;
let cropUnit: "mm" | "pt" = "mm";
// reorder
let reorderInput = "";
let reorderVisualOrder: number[] = [];
let thumbDragIdx: number | null = null;
// shared visual selection (split + delete)
let visualSelectedPages: number[] = [];

// IDE panel state
let bottomPanelCollapsed = false;
let sidebarCollapsed = false;
const collapsedGroups = new Set<string>();

// ─── Page parsing ─────────────────────────────────────────
function parsePageList(input: string): number[] {
  const out: number[] = [];
  for (const part of input.split(",")) {
    const p = part.trim(); if (!p) continue;
    const m = p.match(/^([0-9]+)\s*-\s*([0-9]+)$/);
    if (m) {
      const lo = Math.min(Number(m[1]), Number(m[2])), hi = Math.max(Number(m[1]), Number(m[2]));
      for (let x = lo; x <= hi; x++) out.push(x);
    } else { const n = Number(p); if (Number.isFinite(n) && n > 0) out.push(n); }
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

function parsePageGroups(input: string): { flat: number[]; groups: number[][] } {
  const groups: number[][] = [];
  for (const chunk of input.split(/;|\n/)) {
    const t = chunk.trim(); if (!t) continue;
    const list = parsePageList(t); if (list.length) groups.push(list);
  }
  return { flat: Array.from(new Set(groups.flat())).sort((a, b) => a - b), groups };
}

// ─── Validation ───────────────────────────────────────────
type VR = { type: "error" | "warn" | "ok"; msg: string } | null;

function validatePageInput(input: string): VR {
  const t = input.trim();
  if (!t) return { type: "error", msg: "Ingresa al menos una página." };
  if (/[^0-9,;\s\n\-]/.test(t)) return { type: "error", msg: `Caracteres no válidos. Usa solo números, comas, guiones y punto y coma.` };
  const { flat, groups } = parsePageGroups(t);
  if (!flat.length) return { type: "error", msg: "No se encontraron páginas válidas. Usa formato: 1,3,5-7" };
  if (flat.length > 500) return { type: "warn", msg: `${flat.length} páginas seleccionadas. El proceso puede tardar.` };
  if (Math.max(...flat) > 10000) return { type: "warn", msg: `Página máxima muy alta. Verifica el PDF.` };
  return { type: "ok", msg: `${flat.length} página(s)${groups.length > 1 ? ` en ${groups.length} grupos` : ""}.` };
}

function validateDpiInput(v: number): VR {
  if (!Number.isFinite(v) || v <= 0) return { type: "error", msg: "Ingresa un número válido entre 36 y 600." };
  if (v < 36) return { type: "error", msg: `DPI mínimo: 36.` };
  if (v > 600) return { type: "error", msg: `DPI máximo: 600.` };
  if (v > 300) return { type: "warn", msg: `DPI alto (${v}). Las imágenes serán grandes.` };
  return { type: "ok", msg: `${v} DPI.` };
}

function validateProtectPassword(pwd: string, confirm: string): VR {
  if (!pwd) return { type: "error", msg: "Ingresa una contraseña nueva." };
  if (pwd !== confirm) return { type: "error", msg: "Las contraseñas no coinciden." };
  if (pwd.length < 4) return { type: "warn", msg: "Contraseña corta. Se recomiendan al menos 8 caracteres." };
  return { type: "ok", msg: "Contraseña válida." };
}

function validateReorderInput(input: string): VR {
  const t = input.trim();
  if (!t) return { type: "error", msg: "Ingresa el nuevo orden de páginas (ej: 3,1,2)." };
  if (/[^0-9,\s]/.test(t)) return { type: "error", msg: "Solo se permiten números separados por comas." };
  const nums = t.split(",").map(s => Number(s.trim())).filter(n => s => s);
  if (nums.some(n => !Number.isInteger(n) || n < 1)) return { type: "error", msg: "Todos los valores deben ser enteros mayores a 0." };
  if (new Set(nums).size !== nums.length) return { type: "error", msg: "Hay páginas duplicadas en el orden." };
  return { type: "ok", msg: `${nums.length} página(s) en el nuevo orden.` };
}

function validateFiles(): VR {
  const isImg = activeTool === "img2pdf";
  const isMulti = activeTool === "merge" || activeTool === "img2pdf";
  if (files.length === 0) return { type: "error", msg: isImg ? "Agrega al menos una imagen." : "Agrega al menos un archivo PDF." };
  if (activeTool === "merge" && files.length < 2) return { type: "error", msg: "Combinar necesita al menos 2 PDFs." };
  if (activeTool === "merge" && files.length > MAX_MERGE_FILES) return { type: "error", msg: `Máximo ${MAX_MERGE_FILES} archivos.` };
  if (!isMulti && files.length > 1) return { type: "warn", msg: "Solo se procesará el primer archivo." };
  if (files.some(f => f.file.size === 0)) return { type: "error", msg: "Hay un archivo vacío." };
  if (files.some(f => f.file.size > MAX_FILE_SIZE)) return { type: "error", msg: `Un archivo excede ${prettyBytes(MAX_FILE_SIZE)}.` };
  const big = files.find(f => f.file.size > WARN_FILE_SIZE);
  if (big) return { type: "warn", msg: `"${big.file.name}" es grande (${prettyBytes(big.file.size)}).` };
  return null;
}

function canRun(): boolean {
  if (isJobRunning && pendingJobs.length >= 5) return false;
  if (files.length === 0) return false;
  if (files.some(f => f.file.size === 0 || f.file.size > MAX_FILE_SIZE)) return false;
  if (activeTool === "merge" && (files.length < 2 || files.length > MAX_MERGE_FILES)) return false;
  if (activeTool === "split" && validatePageInput(splitPages)?.type === "error") return false;
  if (activeTool === "pdf2img" && (!Number.isFinite(imgDpi) || imgDpi < 36 || imgDpi > 600)) return false;
  if (activeTool === "rotate" && rotateTarget === "range" && validatePageInput(rotatePages)?.type === "error") return false;
  if (activeTool === "protect" && protectMode === "add" && validateProtectPassword(protectNewPassword, protectConfirmPassword)?.type === "error") return false;
  if (activeTool === "deletepages" && validatePageInput(deletePagesInput)?.type === "error") return false;
  if (activeTool === "watermark" && !watermarkText.trim()) return false;
  if (activeTool === "reorder" && validateReorderInput(reorderInput)?.type === "error") return false;
  return true;
}

function renderVH(v: VR): string {
  if (!v) return "";
  const cls = v.type === "error" ? "validationHint" : v.type === "warn" ? "validationHint warn" : "validationHint ok";
  const icon = v.type === "error" ? "✘" : v.type === "warn" ? "⚠" : "✔";
  return `<div class="${cls}">${icon} ${escapeAttr(v.msg)}</div>`;
}

// ─── File handling ────────────────────────────────────────
async function readFileBytes(f: File): Promise<ArrayBuffer> { return f.arrayBuffer(); }
function makeKey(f: File) { return `${f.name}:${f.size}:${f.lastModified}`; }
function totalInputSize() { return files.reduce((s, f) => s + f.file.size, 0); }

function onFilesChosen(list: FileList | null) {
  if (!list) return;
  const all = Array.from(list);
  let accepted: File[];
  if (activeTool === "img2pdf") {
    const imgs = all.filter(f => f.type.startsWith("image/") || /\.(jpe?g|png)$/i.test(f.name));
    if (imgs.length < all.length) alert(`${all.length - imgs.length} archivo(s) ignorado(s): solo se aceptan JPG y PNG.`);
    accepted = imgs.filter(f => f.size > 0 && f.size <= MAX_FILE_SIZE);
  } else {
    const pdfs = all.filter(f => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length < all.length) alert(`${all.length - pdfs.length} archivo(s) ignorado(s): solo se aceptan PDFs.`);
    const big = pdfs.find(f => f.size > MAX_FILE_SIZE);
    if (big) alert(`"${big.name}" excede ${prettyBytes(MAX_FILE_SIZE)} y fue ignorado.`);
    accepted = pdfs.filter(f => f.size > 0 && f.size <= MAX_FILE_SIZE);
  }
  if (!accepted.length) return;
  const map = new Map(files.map(f => [f.key, f]));
  for (const f of accepted) {
    const key = makeKey(f);
    map.set(key, map.get(key) ?? { file: f, key, password: "" });
  }
  if (activeTool === "merge" && map.size > MAX_MERGE_FILES) {
    alert(`Máximo ${MAX_MERGE_FILES} archivos. Se aceptaron los primeros ${MAX_MERGE_FILES}.`);
    files = Array.from(map.values()).slice(0, MAX_MERGE_FILES);
  } else {
    files = Array.from(map.values());
  }
  visualSelectedPages = [];
  if (activeTool === "reorder" && files.length === 1) { reorderVisualOrder = []; reorderInput = ""; }
  if (activeTool !== "img2pdf") {
    for (const sf of files) requestThumbnails(sf);
  }
  render();
}

function removeFile(idx: number) {
  const key = files[idx]?.key;
  if (key) clearThumbs(key);
  files = files.filter((_, i) => i !== idx);
  if (activeTool === "reorder") { reorderVisualOrder = []; reorderInput = ""; }
  visualSelectedPages = [];
  render();
}

function moveFile(from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= files.length || to >= files.length) return;
  const next = [...files]; const [item] = next.splice(from, 1); next.splice(to, 0, item); files = next;
}

function clearFiles() {
  for (const sf of files) clearThumbs(sf.key);
  files = [];
  reorderVisualOrder = []; reorderInput = "";
  visualSelectedPages = [];
  render();
}

function setActiveTool(next: ToolId) {
  activeTool = next; files = [];
  reorderVisualOrder = []; reorderInput = "";
  visualSelectedPages = []; splitVisualMode = false; deleteVisualMode = false;
  updateURLHash(); render();
}

// ─── Job execution ────────────────────────────────────────
async function buildRequest(jobId: string): Promise<{ req: WorkerRequest; xfers: ArrayBuffer[] } | null> {
  try {
    if (activeTool === "merge") {
      const payload = await Promise.all(files.map(async f => ({ name: f.file.name, bytes: await readFileBytes(f.file), password: f.password?.trim() || undefined })));
      return { req: { type: "merge", jobId, files: payload }, xfers: payload.map(p => p.bytes) };
    }
    const f0 = files[0]; const bytes = await readFileBytes(f0.file);
    const fileObj = { name: f0.file.name, bytes, password: f0.password?.trim() || undefined };
    if (activeTool === "split") {
      const { flat, groups } = parsePageGroups(splitPages);
      return { req: { type: "split", jobId, file: fileObj, pages: flat, ranges: groups.length ? groups : [flat], output: splitOutput }, xfers: [bytes] };
    }
    if (activeTool === "compress") return { req: { type: "compress", jobId, file: fileObj, level: compressLevel }, xfers: [bytes] };
    if (activeTool === "pdf2img") return { req: { type: "pdf2img", jobId, file: fileObj, format: imgFormat, dpi: imgDpi }, xfers: [bytes] };
    if (activeTool === "rotate") {
      const pages = rotateTarget === "range" ? parsePageGroups(rotatePages).flat : [];
      return { req: { type: "rotate", jobId, file: fileObj, angle: rotateAngle, target: rotateTarget, pages }, xfers: [bytes] };
    }
    if (activeTool === "img2pdf") {
      const payload = await Promise.all(files.map(async f => ({ name: f.file.name, bytes: await readFileBytes(f.file) })));
      return { req: { type: "img2pdf", jobId, files: payload, layout: img2pdfLayout }, xfers: payload.map(p => p.bytes) };
    }
    if (activeTool === "protect") return { req: { type: "protect", jobId, file: fileObj, mode: protectMode, newPassword: protectMode === "add" ? protectNewPassword : undefined }, xfers: [bytes] };
    if (activeTool === "deletepages") {
      const { flat } = parsePageGroups(deletePagesInput);
      return { req: { type: "deletepages", jobId, file: fileObj, pages: flat }, xfers: [bytes] };
    }
    if (activeTool === "watermark") return { req: { type: "watermark", jobId, file: fileObj, text: watermarkText, opacity: watermarkOpacity, angle: watermarkAngle, size: watermarkSize, color: watermarkColor }, xfers: [bytes] };
    if (activeTool === "pagenumbers") return { req: { type: "pagenumbers", jobId, file: fileObj, position: pageNumPosition, start: pageNumStart, prefix: pageNumPrefix, fontSize: pageNumFontSize }, xfers: [bytes] };
    if (activeTool === "metadata") return { req: { type: "metadata", jobId, file: fileObj, title: metaTitle, author: metaAuthor, subject: metaSubject, keywords: metaKeywords, creator: metaCreator }, xfers: [bytes] };
    if (activeTool === "extracttext") return { req: { type: "extracttext", jobId, file: fileObj }, xfers: [bytes] };
    if (activeTool === "crop") return { req: { type: "crop", jobId, file: fileObj, top: cropTop, right: cropRight, bottom: cropBottom, left: cropLeft, unit: cropUnit }, xfers: [bytes] };
    if (activeTool === "reorder") {
      const order = reorderInput.trim().split(",").map(s => Number(s.trim())).filter(Boolean);
      return { req: { type: "reorder", jobId, file: fileObj, order }, xfers: [bytes] };
    }
    return null;
  } catch (e: any) {
    alert(`Error leyendo archivo: ${e?.message ?? e}`);
    return null;
  }
}

async function runJob() {
  const fileVal = validateFiles();
  if (fileVal?.type === "error") return alert(fileVal.msg);
  if (activeTool === "split" && validatePageInput(splitPages)?.type === "error") return alert(validatePageInput(splitPages)!.msg);
  if (activeTool === "pdf2img") { const v = validateDpiInput(imgDpi); if (v?.type === "error") { imgDpi = clampDpi(imgDpi); render(); return alert(v.msg); } imgDpi = clampDpi(imgDpi); }
  if (activeTool === "protect" && protectMode === "add") { const v = validateProtectPassword(protectNewPassword, protectConfirmPassword); if (v?.type === "error") return alert(v.msg); }
  if (activeTool === "deletepages" && validatePageInput(deletePagesInput)?.type === "error") return alert(validatePageInput(deletePagesInput)!.msg);
  if (activeTool === "watermark" && !watermarkText.trim()) return alert("Ingresa el texto de la marca de agua.");
  if (activeTool === "reorder" && validateReorderInput(reorderInput)?.type === "error") return alert(validateReorderInput(reorderInput)!.msg);

  const jobId = uid();
  const tool = TOOLS.find(t => t.id === activeTool)!;
  const job: Job = { id: jobId, toolId: activeTool, toolTitle: tool.title, createdAt: Date.now(), status: "queued", progress: 0, inputCount: files.length, inputSize: totalInputSize() };
  jobs = [job, ...jobs];
  // Auto-expand bottom panel when a job starts
  bottomPanelCollapsed = false;
  render();

  const built = await buildRequest(jobId);
  if (!built) { jobs = jobs.filter(j => j.id !== jobId); render(); return; }

  if (!isJobRunning) {
    isJobRunning = true;
    jobs = jobs.map(j => j.id === jobId ? { ...j, status: "running" } : j);
    engineWorker.postMessage(built.req, built.xfers);
  } else {
    pendingJobs.push({ jobId, req: built.req, xfers: built.xfers });
  }
  render();
}

function cancelAllJobs() {
  engineWorker.terminate();
  engineWorker = createEngineWorker();
  pendingJobs.length = 0;
  jobs = jobs.map(j => (j.status === "running" || j.status === "queued") ? { ...j, status: "error", progress: 0, progressNote: undefined, error: "Cancelado por el usuario." } : j);
  isJobRunning = false;
  saveJobsToStorage();
  render();
}

async function downloadAllCompleted() {
  const done = jobs.filter(j => j.status === "done" && j.outputBlob && j.outputName);
  if (!done.length) return;
  if (done.length === 1) { downloadBlob(done[0].outputBlob!, done[0].outputName!); return; }
  const nameSeen = new Map<string, number>();
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  for (const j of done) {
    const base = j.outputName!;
    const n = nameSeen.get(base) ?? 0; nameSeen.set(base, n + 1);
    const name = n === 0 ? base : base.replace(/(\.[^.]+)$/, `_${n}$1`);
    entries.push({ name, data: new Uint8Array(await j.outputBlob!.arrayBuffer()) });
  }
  const zip = buildZip(entries);
  downloadBlob(new Blob([zip], { type: "application/zip" }), `resultados_${new Date().toISOString().slice(0, 10)}.zip`);
}

function useJobAsInput(jobId: string) {
  const job = jobs.find(j => j.id === jobId);
  if (!job?.outputBlob || !job.outputName) return;
  const file = new File([job.outputBlob], job.outputName, { type: "application/pdf" });
  const key = makeKey(file);
  for (const sf of files) clearThumbs(sf.key);
  files = [{ file, key, password: "" }];
  reorderVisualOrder = []; reorderInput = "";
  visualSelectedPages = []; splitVisualMode = false; deleteVisualMode = false;
  requestThumbnails(files[0]);
  render();
  document.getElementById("toolWorkspace")?.scrollTo({ top: 0, behavior: "smooth" });
}

// ─── Tool list ────────────────────────────────────────────
function getFilteredTools() {
  if (!searchQuery.trim()) return TOOLS;
  const q = searchQuery.toLowerCase();
  return TOOLS.filter(t => t.title.toLowerCase().includes(q) || t.subtitle.toLowerCase().includes(q) || t.tags.some(x => x.toLowerCase().includes(q)));
}

function renderToolBtn(t: ToolDef): string {
  return `<button class="toolBtn${t.id === activeTool ? " active" : ""}" data-tool="${t.id}">
    <div class="toolBtnHeader">
      <span class="toolBtnIcon">${TOOL_ICONS[t.id] ?? "📄"}</span>
      <span class="toolBtnName">${t.title}</span>
    </div>
    <div class="p" style="padding-left:34px;">${t.subtitle}</div>
    <div class="badges" style="padding-left:34px;">${t.tags.map(x => `<span class="badge">${x}</span>`).join("")}</div>
  </button>`;
}

function renderToolsList(filtered: ToolDef[]): string {
  if (!filtered.length) return `<div class="small" style="padding:10px;">No se encontraron herramientas.</div>`;
  if (searchQuery.trim()) return filtered.map(renderToolBtn).join("");
  return TOOL_GROUPS.map(g => {
    const gTools = g.tools.map(id => TOOLS.find(t => t.id === id)!).filter(Boolean);
    const collapsed = collapsedGroups.has(g.name);
    return `<div class="tool-group">
      <button class="tool-group-header" data-group="${escapeAttr(g.name)}">
        <span class="tool-group-arrow${collapsed ? " collapsed" : ""}">▾</span>
        <span class="tool-group-name">${g.name.toUpperCase()}</span>
        <span class="tool-group-count">${gTools.length}</span>
      </button>
      ${collapsed ? "" : `<div class="tool-group-items">${gTools.map(renderToolBtn).join("")}</div>`}
    </div>`;
  }).join("");
}

function bindToolButtons(c: HTMLElement) {
  c.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(b => {
    b.onclick = () => setActiveTool(b.dataset.tool as ToolId);
  });
  c.querySelectorAll<HTMLButtonElement>("[data-group]").forEach(b => {
    b.onclick = () => {
      const name = b.dataset.group!;
      if (collapsedGroups.has(name)) collapsedGroups.delete(name);
      else collapsedGroups.add(name);
      const c2 = document.getElementById("tools")!;
      c2.innerHTML = renderToolsList(getFilteredTools());
      bindToolButtons(c2);
    };
  });
}

// ─── Thumbnail grid rendering ─────────────────────────────
function renderThumbGridReorder(fileKey: string): string {
  const pages = thumbPages[fileKey] ?? [];
  const total = thumbTotal[fileKey] ?? 0;
  const loading = thumbLoading.has(fileKey);
  const failed = thumbFailed.has(fileKey);

  if (failed) return `<div class="small" style="margin-top:8px;">⚠ No se pudieron cargar las vistas previas. Usa el campo de texto para especificar el orden.</div>`;
  if (!total && loading) return `<div class="small" style="margin-top:8px;"><span class="spinner" style="display:inline-block;margin-right:6px;"></span> Cargando vistas previas…</div>`;
  if (!total) return "";

  const order = reorderVisualOrder.length === total ? reorderVisualOrder : Array.from({ length: total }, (_, i) => i + 1);

  return `
    <div class="small" style="margin-bottom:4px;">Arrastra las páginas para reordenarlas. El orden se refleja en el campo de texto.</div>
    <div class="thumbGrid" id="thumbGridReorder">
      ${order.map((pageNum, idx) => {
        const src = pages[pageNum - 1];
        return `<div class="thumbCard${thumbDragIdx === idx ? " dragging" : ""}" data-thumbidx="${idx}" draggable="true">
          ${src ? `<img class="thumbImg" src="${src}" />` : `<div class="thumbSkeleton"></div>`}
          <div class="thumbNum">${pageNum}</div>
        </div>`;
      }).join("")}
    </div>`;
}

function renderThumbGridSelect(fileKey: string, selected: number[]): string {
  const pages = thumbPages[fileKey] ?? [];
  const total = thumbTotal[fileKey] ?? 0;
  if (!total) return `<div class="small" style="margin-top:6px;"><span class="spinner" style="display:inline-block;margin-right:6px;"></span> Cargando vistas previas…</div>`;
  const selSet = new Set(selected);
  return `
    <div class="small" style="margin-bottom:4px;">Haz clic en las páginas para seleccionarlas/deseleccionarlas.</div>
    <div class="thumbGrid" id="thumbSelectGrid">
      ${Array.from({ length: total }, (_, i) => i + 1).map(pg => {
        const src = pages[pg - 1];
        const sel = selSet.has(pg);
        return `<div class="thumbCard${sel ? " selected" : ""}" data-selectpage="${pg}">
          ${src ? `<img class="thumbImg" src="${src}" />` : `<div class="thumbSkeleton"></div>`}
          ${sel ? `<div class="thumbCheck">✓</div>` : ""}
          <div class="thumbNum">${pg}</div>
        </div>`;
      }).join("")}
    </div>
    ${selected.length ? `<div class="small" style="margin-top:4px;">Seleccionadas: ${selected.join(", ")}</div>` : ""}`;
}

// ─── Options panel ────────────────────────────────────────
function renderOptions(): string {
  const pv = activeTool === "split" ? validatePageInput(splitPages) : null;
  const dv = activeTool === "pdf2img" ? validateDpiInput(imgDpi) : null;
  const dpv = activeTool === "deletepages" ? validatePageInput(deletePagesInput) : null;
  const pwv = activeTool === "protect" && protectMode === "add" ? validateProtectPassword(protectNewPassword, protectConfirmPassword) : null;
  const rv = activeTool === "reorder" ? validateReorderInput(reorderInput) : null;
  const ropv = activeTool === "rotate" && rotateTarget === "range" ? validatePageInput(rotatePages) : null;
  const fKey = files[0]?.key ?? "";
  const hasThumb = fKey && thumbTotal[fKey];

  if (activeTool === "compress") return `<div>
    <div class="kv">Nivel de compresión</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
      ${(["small","balanced","best","aggressive"] as const).map(l => `<button class="btn${compressLevel===l?" primary":""}" data-cmpr="${l}">${l==="small"?"Ligera":l==="balanced"?"Equilibrada":l==="best"?"Máxima":"Agresiva"}</button>`).join("")}
    </div>
    <div class="small" style="margin-top:6px;">${compressLevel==="small"?"Reescritura rápida sin recompresión.":compressLevel==="balanced"?"Recompresión estándar con flate.":compressLevel==="best"?"Recompresión agresiva + linearización.":"Rasteriza páginas a 150 DPI JPEG — el texto no será seleccionable."}</div>
  </div>`;

  if (activeTool === "split") {
    const canVisual = !!(hasThumb && !thumbLoading.has(fKey));
    return `<div>
      ${canVisual ? `<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
        <button class="btn${splitVisualMode?" primary":""}" data-splitvis="1">🖼 Modo visual</button>
        <button class="btn${!splitVisualMode?" primary":""}" data-splitvis="0">✏ Modo texto</button>
      </div>` : ""}
      ${splitVisualMode && canVisual ? renderThumbGridSelect(fKey, visualSelectedPages) : `
        <div class="kv">Páginas</div>
        <input id="pages" class="input${pv?.type==="error"?" invalid":pv?.type==="ok"?" valid":""}" value="${escapeAttr(splitPages)}" placeholder="ej: 1,2,5-7; 10-12" style="margin-top:6px;" />
        <div id="pageHint">${renderVH(pv)}</div>
        <div class="small" style="margin-top:4px;">Formato: 1,3,5-7 (1-based). Separa con ; para múltiples PDFs en ZIP.</div>
      `}
      <div class="kv" style="margin-top:12px;">Salida</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
        ${(["single","zip"] as const).map(m => `<button class="btn${splitOutput===m?" primary":""}" data-splitout="${m}">${m==="single"?"PDF único":"ZIP (un PDF por rango)"}</button>`).join("")}
      </div>
    </div>`;
  }

  if (activeTool === "pdf2img") return `<div>
    <div class="kv">Formato</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
      ${(["png","jpg"] as const).map(f => `<button class="btn${imgFormat===f?" primary":""}" data-imgfmt="${f}">${f.toUpperCase()}</button>`).join("")}
    </div>
    <div class="kv" style="margin-top:10px;">DPI (36–600)</div>
    <input id="dpi" type="number" min="36" max="600" class="input${dv?.type==="error"?" invalid":dv?.type==="ok"?" valid":""}" value="${imgDpi}" style="margin-top:6px;" />
    <div id="dpiHint">${renderVH(dv)}</div>
    <div class="small" style="margin-top:4px;">Genera un ZIP con todas las páginas. Mayor DPI = mayor calidad.</div>
  </div>`;

  if (activeTool === "rotate") return `<div>
    <div class="kv">Ángulo</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
      ${([90,180,270] as const).map(a => `<button class="btn${rotateAngle===a?" primary":""}" data-rotangle="${a}">${a===90?"90° →":a===180?"180°":"270° ←"}</button>`).join("")}
    </div>
    <div class="kv" style="margin-top:12px;">Aplicar a</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
      <button class="btn${rotateTarget==="all"?" primary":""}" data-rottgt="all">Todas las páginas</button>
      <button class="btn${rotateTarget==="range"?" primary":""}" data-rottgt="range">Páginas específicas</button>
    </div>
    ${rotateTarget==="range"?`
      <input id="rotatePages" class="input${ropv?.type==="error"?" invalid":ropv?.type==="ok"?" valid":""}" value="${escapeAttr(rotatePages)}" placeholder="ej: 1,3,5-7" style="margin-top:8px;" />
      <div id="rotatePagesHint">${renderVH(ropv)}</div>`:""}
  </div>`;

  if (activeTool === "img2pdf") return `<div>
    <div class="kv">Tamaño de página</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
      <button class="btn${img2pdfLayout==="auto"?" primary":""}" data-img2pdflayout="auto">Auto (tamaño imagen)</button>
      <button class="btn${img2pdfLayout==="a4"?" primary":""}" data-img2pdflayout="a4">A4</button>
      <button class="btn${img2pdfLayout==="letter"?" primary":""}" data-img2pdflayout="letter">Letter</button>
    </div>
    <div class="small" style="margin-top:6px;">Cada imagen → una página. Con A4/Letter la imagen se escala para ajustarse.</div>
  </div>`;

  if (activeTool === "protect") return `<div>
    <div class="kv">Modo</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
      <button class="btn${protectMode==="add"?" primary":""}" data-protmode="add">Añadir contraseña</button>
      <button class="btn${protectMode==="remove"?" primary":""}" data-protmode="remove">Quitar contraseña</button>
    </div>
    ${protectMode==="add"?`
      <div style="margin-top:12px;">
        <div class="kv">Nueva contraseña</div>
        <input id="newPwd" class="input" type="password" value="${escapeAttr(protectNewPassword)}" placeholder="Contraseña nueva" style="margin-top:6px;" autocomplete="new-password" />
        <div class="kv" style="margin-top:8px;">Confirmar contraseña</div>
        <input id="confirmPwd" class="input" type="password" value="${escapeAttr(protectConfirmPassword)}" placeholder="Repetir contraseña" style="margin-top:6px;" autocomplete="new-password" />
        <div id="pwdHint">${renderVH(pwv)}</div>
      </div>`:`
      <div class="small" style="margin-top:8px;">Usa el campo de contraseña en el archivo para desencriptar. El PDF resultante no tendrá contraseña.</div>`}
  </div>`;

  if (activeTool === "deletepages") {
    const canVisual = !!(hasThumb && !thumbLoading.has(fKey));
    return `<div>
      ${canVisual ? `<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
        <button class="btn${deleteVisualMode?" primary":""}" data-deletevis="1">🖼 Modo visual</button>
        <button class="btn${!deleteVisualMode?" primary":""}" data-deletevis="0">✏ Modo texto</button>
      </div>` : ""}
      ${deleteVisualMode && canVisual ? renderThumbGridSelect(fKey, visualSelectedPages) : `
        <div class="kv">Páginas a eliminar</div>
        <input id="deletePages" class="input${dpv?.type==="error"?" invalid":dpv?.type==="ok"?" valid":""}" value="${escapeAttr(deletePagesInput)}" placeholder="ej: 1,3,5-7" style="margin-top:6px;" />
        <div id="deletePagesHint">${renderVH(dpv)}</div>
        <div class="small" style="margin-top:4px;">Las páginas indicadas serán eliminadas. Las demás se conservan.</div>`}
    </div>`;
  }

  if (activeTool === "watermark") return `<div>
    <div class="kv">Texto</div>
    <input id="wmText" class="input" value="${escapeAttr(watermarkText)}" placeholder="ej: CONFIDENCIAL" style="margin-top:6px;" />
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
      <div><div class="kv">Opacidad (%)</div><input id="wmOpacity" type="number" min="1" max="100" class="input" value="${watermarkOpacity}" style="margin-top:4px;" /></div>
      <div><div class="kv">Ángulo (°)</div><input id="wmAngle" type="number" min="-180" max="180" class="input" value="${watermarkAngle}" style="margin-top:4px;" /></div>
      <div><div class="kv">Tamaño (pt)</div><input id="wmSize" type="number" min="8" max="300" class="input" value="${watermarkSize}" style="margin-top:4px;" /></div>
      <div><div class="kv">Color</div><input id="wmColor" type="color" class="input" value="${watermarkColor}" style="margin-top:4px;height:36px;padding:2px;" /></div>
    </div>
  </div>`;

  if (activeTool === "pagenumbers") return `<div>
    <div class="kv">Posición</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
      <button class="btn${pageNumPosition==="bottom-left"?" primary":""}" data-pgpos="bottom-left">Inf. izquierda</button>
      <button class="btn${pageNumPosition==="bottom-center"?" primary":""}" data-pgpos="bottom-center">Inf. centro</button>
      <button class="btn${pageNumPosition==="bottom-right"?" primary":""}" data-pgpos="bottom-right">Inf. derecha</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
      <div><div class="kv">Número inicial</div><input id="pgStart" type="number" min="0" class="input" value="${pageNumStart}" style="margin-top:4px;" /></div>
      <div><div class="kv">Prefijo</div><input id="pgPrefix" class="input" value="${escapeAttr(pageNumPrefix)}" placeholder="ej: Pág. " style="margin-top:4px;" /></div>
      <div><div class="kv">Tamaño fuente (pt)</div><input id="pgSize" type="number" min="6" max="72" class="input" value="${pageNumFontSize}" style="margin-top:4px;" /></div>
    </div>
  </div>`;

  if (activeTool === "metadata") return `<div>
    <div class="small" style="margin-bottom:8px;">Los campos vacíos conservan los metadatos actuales del PDF.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div><div class="kv">Título</div><input id="metaTitle" class="input" value="${escapeAttr(metaTitle)}" placeholder="Título" style="margin-top:4px;" /></div>
      <div><div class="kv">Autor</div><input id="metaAuthor" class="input" value="${escapeAttr(metaAuthor)}" placeholder="Autor" style="margin-top:4px;" /></div>
      <div><div class="kv">Tema</div><input id="metaSubject" class="input" value="${escapeAttr(metaSubject)}" placeholder="Tema" style="margin-top:4px;" /></div>
      <div><div class="kv">Palabras clave</div><input id="metaKeywords" class="input" value="${escapeAttr(metaKeywords)}" placeholder="kw1, kw2" style="margin-top:4px;" /></div>
      <div><div class="kv">Creador</div><input id="metaCreator" class="input" value="${escapeAttr(metaCreator)}" placeholder="Aplicación creadora" style="margin-top:4px;" /></div>
    </div>
  </div>`;

  if (activeTool === "extracttext") return `<div>
    <div class="small">Extrae texto de todas las páginas → archivo <strong>.txt</strong>. Requiere PDF con texto seleccionable (no PDFs escaneados sin OCR).</div>
  </div>`;

  if (activeTool === "crop") return `<div>
    <div class="kv">Unidad</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
      <button class="btn${cropUnit==="mm"?" primary":""}" data-cropunit="mm">Milímetros (mm)</button>
      <button class="btn${cropUnit==="pt"?" primary":""}" data-cropunit="pt">Puntos (pt)</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
      <div><div class="kv">Superior</div><input id="cropTop" type="number" min="0" class="input" value="${cropTop}" style="margin-top:4px;" /></div>
      <div><div class="kv">Inferior</div><input id="cropBottom" type="number" min="0" class="input" value="${cropBottom}" style="margin-top:4px;" /></div>
      <div><div class="kv">Izquierdo</div><input id="cropLeft" type="number" min="0" class="input" value="${cropLeft}" style="margin-top:4px;" /></div>
      <div><div class="kv">Derecho</div><input id="cropRight" type="number" min="0" class="input" value="${cropRight}" style="margin-top:4px;" /></div>
    </div>
    <div class="small" style="margin-top:6px;">Reduce el área visible de todas las páginas. El contenido fuera del recorte queda oculto.</div>
  </div>`;

  if (activeTool === "reorder") {
    const thumbsReady = hasThumb;
    return `<div>
      <div class="kv">Nuevo orden de páginas</div>
      <input id="reorderInput" class="input${rv?.type==="error"?" invalid":rv?.type==="ok"?" valid":""}" value="${escapeAttr(reorderInput)}" placeholder="ej: 3,1,2,4,5" style="margin-top:6px;" />
      <div id="reorderHint">${renderVH(rv)}</div>
      <div class="small" style="margin-top:4px;">Lista completa de páginas (1-based) en el nuevo orden, separadas por comas.</div>
      ${thumbsReady ? renderThumbGridReorder(fKey) : (thumbLoading.has(fKey) ? `<div class="small" style="margin-top:8px;"><span class="spinner" style="display:inline-block;margin-right:6px;"></span> Cargando vista previa…</div>` : "")}
    </div>`;
  }

  return `<div class="small">Sin opciones adicionales.</div>`;
}

// ─── Main render ──────────────────────────────────────────
function render() {
  // Preserve scroll positions across re-renders
  const prevWorkspaceScroll = document.getElementById("toolWorkspace")?.scrollTop ?? 0;
  const prevPanelScroll = document.querySelector<HTMLElement>(".panel-body")?.scrollTop ?? 0;

  updateURLHash();
  const tool = TOOLS.find(t => t.id === activeTool)!;
  const filtered = getFilteredTools();
  const themeIcon = currentTheme === "light" ? "🌙" : "☀️";
  const isImg = activeTool === "img2pdf";
  const isMulti = activeTool === "merge" || activeTool === "img2pdf";
  const runOk = canRun();
  const fileVal = files.length > 0 ? validateFiles() : null;
  const hasRunning = isJobRunning || pendingJobs.length > 0;
  const completedJobs = jobs.filter(j => j.status === "done" && j.outputBlob);

  app.innerHTML = `
    <div class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <div class="logo">📄</div>
          <div>
            <div class="h1">PDF Toolkit</div>
            <div class="p">100% local · Sin subida</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          ${deferredInstallPrompt ? `<button id="installBtn" title="Instalar como app">⬇ Instalar</button>` : ""}
          <button class="themeBtn" id="themeToggle" title="Cambiar tema (T)">${themeIcon}</button>
        </div>
      </div>
    </div>

    <div class="ide-body">

      <aside class="sidebar${sidebarCollapsed ? " collapsed" : ""}" id="sidebar">
        <div class="sidebar-header">
          <span class="sidebar-title">Herramientas</span>
          <button class="icon-btn" data-action="toggleSidebar" title="Colapsar barra lateral">◀</button>
        </div>
        <div class="sidebar-search">
          <input id="search" class="input" placeholder="Buscar herramientas…" value="${escapeAttr(searchQuery)}" style="font-size:12px;padding:7px 10px;" />
        </div>
        <div class="sidebar-tools tools" id="tools"></div>
      </aside>

      <div class="sidebar-resizer" id="sidebarResizer"></div>

      <div class="main-col">

        <div class="tool-workspace" id="toolWorkspace">

          <div class="workspace-header">
            <div class="breadcrumb">
              ${sidebarCollapsed ? `<button class="icon-btn" data-action="toggleSidebar" title="Mostrar barra lateral" style="margin-right:4px;">☰</button>` : ""}
              <span class="breadcrumb-root">PDF Toolkit</span>
              <span class="breadcrumb-sep">›</span>
              <span class="breadcrumb-active">${TOOL_ICONS[activeTool] ?? "📄"} ${tool.title}</span>
            </div>
            <div class="workspace-actions">
              <button class="btn" id="pick">Subir</button>
              <button class="btn" id="clear" ${files.length ? "" : "disabled"}>Limpiar</button>
              ${hasRunning ? `<button class="btn danger" id="cancel">✕ Cancelar${pendingJobs.length > 0 ? " (" + (pendingJobs.length + 1) + ")" : ""}</button>` : ""}
              <button class="btn primary" id="run" ${runOk ? "" : "disabled"}>
                ${isJobRunning ? "Procesando…" : pendingJobs.length > 0 ? `En cola (${pendingJobs.length + 1})…` : "Ejecutar"}
              </button>
            </div>
          </div>

          <div class="workspace-inner">

            <div class="tool-intro">
              <div class="h2">${tool.title}</div>
              <div class="p">${tool.subtitle}</div>
              <div class="badges" style="margin-top:8px;">
                ${tool.tags.map(t => `<span class="badge">${t}</span>`).join("")}
                <span class="badge primary">Modo privado</span>
              </div>
            </div>

            <div class="split"></div>

            <div class="drop" id="drop">
              <div class="dropIcon">⬆</div>
              <div class="dropTitle">${isImg ? "Arrastra imágenes aquí" : "Arrastra PDFs aquí"}</div>
              <div class="small">${isImg ? "JPG y PNG admitidos" : "o haz clic en <strong>Subir</strong>"}</div>
            </div>

            <div class="files" id="files">
              ${isMulti && files.length > 1 ? `<div class="small" style="margin-bottom:2px;">Arrastra los nombres para reordenar.</div>` : ""}
              ${files.length === 0
                ? `<div class="small">Sin archivos seleccionados.</div>`
                : files.map((f, idx) => {
                    const th0 = thumbPages[f.key]?.[0];
                    const tl = thumbLoading.has(f.key);
                    const tf = thumbFailed.has(f.key);
                    const tc = thumbTotal[f.key];
                    return `<div class="fileRow" data-idx="${idx}">
                      ${isMulti && files.length > 1 ? `<div class="dragHandle" title="Reordenar" aria-hidden="true">↕</div>` : ""}
                      ${!isImg ? (th0 ? `<img class="filePrev" src="${th0}" alt="p1" />` : tl ? `<div class="filePrevSkeleton"></div>` : tf ? `<div class="icon">🔒</div>` : `<div class="icon">📄</div>`) : `<div class="icon">🖼️</div>`}
                      <div class="fileInfo">
                        <div class="fileName">${escapeAttr(f.file.name)}</div>
                        <div class="fileMeta">${prettyBytes(f.file.size)}${tc ? ` • <span class="pgCount">${tc} pág.</span>` : tl ? ` • <span class="pgCount">…</span>` : ""}</div>
                      </div>
                      ${!isImg ? `<div class="filePassword">
                        <input class="input" data-pass="${idx}" value="${escapeAttr(f.password ?? "")}" placeholder="Contraseña (si protegido)" autocomplete="off" />
                        <div class="small">Solo en tu navegador.</div>
                      </div>` : ""}
                      <button class="btn" data-rm="${idx}">Quitar</button>
                    </div>`;
                  }).join("")}
              ${renderVH(fileVal)}
            </div>

            <div class="split"></div>

            <div>
              <div class="h1">Opciones</div>
              <div class="p">Procesado en un Web Worker — sin subida de datos.</div>
              <div style="margin-top:12px;">${renderOptions()}</div>
            </div>

            <div class="small" style="margin-top:24px;text-align:center;opacity:.5;">
              Atajos: Ctrl+O abrir · Enter ejecutar · Esc limpiar · Ctrl+1–9 herramienta · T tema
            </div>

          </div>
        </div>

        <div class="panel-resizer" id="panelResizer"></div>

        <div class="bottom-panel${bottomPanelCollapsed ? " collapsed" : ""}" id="bottomPanel">
          <div class="panel-tabbar">
            <button class="panel-tab active" id="toggleBottomPanel">
              HISTORIAL
              ${hasRunning ? `<span class="spinner" style="width:10px;height:10px;border-width:2px;margin-left:4px;"></span>` : ""}
              ${jobs.length ? `<span class="panel-badge">${jobs.length}</span>` : ""}
            </button>
            <div class="panel-actions">
              ${completedJobs.length > 1 ? `<button class="btn" style="font-size:11px;padding:4px 10px;" id="dlAll">⬇ Todos (${completedJobs.length})</button>` : ""}
              <button class="btn" style="font-size:11px;padding:4px 10px;" id="clearJobs" ${jobs.length ? "" : "disabled"}>Limpiar</button>
              <button class="icon-btn" id="collapsePanel" title="${bottomPanelCollapsed ? "Expandir panel" : "Colapsar panel"}">${bottomPanelCollapsed ? "▲" : "▼"}</button>
            </div>
          </div>
          <div class="panel-body">
            <div class="jobs">
              ${jobs.length === 0
                ? `<div class="small">Sin trabajos aún.</div>`
                : jobs.map(j => {
                    const outSz = j.outputBlob?.size;
                    const sizeInfo = j.inputSize ? `Entrada: ${prettyBytes(j.inputSize)}` : "";
                    const outInfo = outSz ? ` → Salida: ${prettyBytes(outSz)}` : "";
                    const red = (j.inputSize && outSz && j.toolId === "compress" && outSz < j.inputSize)
                      ? ` (↓${Math.round((1 - outSz / j.inputSize) * 100)}%)` : "";
                    const canUse = j.status === "done" && j.outputBlob && j.outputName?.endsWith(".pdf");
                    return `<div class="jobRow ${j.status}">
                      <div class="row">
                        <div style="min-width:0">
                          <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${j.toolTitle}</div>
                          <div class="kv">${new Date(j.createdAt).toLocaleString()} • ${j.inputCount} archivo(s)</div>
                          ${sizeInfo ? `<div class="jobSize">${sizeInfo}${outInfo}${red ? `<span class="reduction">${red}</span>` : ""}</div>` : ""}
                        </div>
                        <div>${j.status === "running"
                          ? `<span class="spinner"></span>`
                          : `<span class="badge${j.status === "done" ? " primary" : j.status === "error" ? " error" : ""}">${j.status === "queued" ? "En cola" : j.status === "done" ? "Completado" : "Error"}</span>`}
                        </div>
                      </div>
                      <div style="margin-top:10px;">
                        <div class="progressBar"><div class="progressFill${j.status === "running" ? " running" : ""}" style="width:${j.progress}%"></div></div>
                        <div class="kv" style="margin-top:6px;">${j.progress}%${j.progressNote ? ` – ${escapeAttr(j.progressNote)}` : ""}</div>
                      </div>
                      ${j.error ? `<div class="err">${escapeAttr(j.error)}</div>` : ""}
                      ${j.status === "done" && j.outputBlob && j.outputName ? `
                        <div class="successMsg">Proceso completado exitosamente.</div>
                        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                          <button class="btn primary" data-dl="${j.id}">⬇ ${escapeAttr(j.outputName)}</button>
                          ${canUse ? `<button class="btn" data-useinput="${j.id}">Usar como entrada</button>` : ""}
                        </div>` : ""}
                    </div>`;
                  }).join("")}
            </div>
          </div>
        </div>

      </div>
    </div>

    <div class="statusbar">
      <button class="status-btn" data-action="toggleSidebar" title="Alternar barra lateral (B)">
        ${sidebarCollapsed ? "☰" : "⊟"}
      </button>
      <span class="status-sep">│</span>
      <span class="status-item">${TOOL_ICONS[activeTool] ?? "📄"} ${tool.title}</span>
      ${files.length > 0 ? `<span class="status-sep">│</span><span class="status-item">📁 ${files.length} archivo(s)${files.length === 1 ? " · " + prettyBytes(totalInputSize()) : ""}</span>` : ""}
      ${isJobRunning ? `<span class="status-sep">│</span><span class="status-item"><span class="spinner-tiny"></span> Procesando…</span>` : ""}
      ${pendingJobs.length > 0 ? `<span class="status-sep">│</span><span class="status-item">En cola: ${pendingJobs.length}</span>` : ""}
      <div class="status-right">
        <span class="status-item">🔒 100% local</span>
      </div>
    </div>`;

  // ── Inject tools list ──────────────────────────────────
  const toolsEl = document.getElementById("tools")!;
  toolsEl.innerHTML = renderToolsList(filtered);
  bindToolButtons(toolsEl);

  // ── File input ─────────────────────────────────────────
  const input = document.createElement("input");
  input.type = "file";
  input.accept = isImg ? "image/jpeg,image/png,.jpg,.jpeg,.png" : "application/pdf,.pdf";
  input.multiple = isMulti;
  input.onchange = () => onFilesChosen(input.files);

  document.getElementById("pick")!.onclick = () => input.click();
  document.getElementById("clear")!.onclick = clearFiles;
  document.getElementById("run")!.onclick = runJob;
  document.getElementById("cancel")?.addEventListener("click", cancelAllJobs);
  document.getElementById("clearJobs")!.onclick = () => { jobs = []; saveJobsToStorage(); render(); };
  document.getElementById("dlAll")?.addEventListener("click", downloadAllCompleted);
  document.getElementById("themeToggle")!.onclick = toggleTheme;
  document.getElementById("installBtn")?.addEventListener("click", () => { deferredInstallPrompt?.prompt(); });

  // ── Search ─────────────────────────────────────────────
  const searchEl = document.getElementById("search") as HTMLInputElement;
  searchEl.oninput = () => {
    searchQuery = searchEl.value;
    const c = document.getElementById("tools")!;
    c.innerHTML = renderToolsList(getFilteredTools());
    bindToolButtons(c);
  };

  // ── IDE panel controls ─────────────────────────────────
  document.querySelectorAll<HTMLButtonElement>("[data-action='toggleSidebar']").forEach(b => {
    b.onclick = () => { sidebarCollapsed = !sidebarCollapsed; render(); };
  });

  document.getElementById("toggleBottomPanel")?.addEventListener("click", () => {
    bottomPanelCollapsed = !bottomPanelCollapsed; render();
  });
  document.getElementById("collapsePanel")?.addEventListener("click", () => {
    bottomPanelCollapsed = !bottomPanelCollapsed; render();
  });

  // ── Sidebar resize ──────────────────────────────────────
  const sidebarResizer = document.getElementById("sidebarResizer");
  if (sidebarResizer) {
    sidebarResizer.addEventListener("mousedown", (e) => {
      if (sidebarCollapsed) return;
      e.preventDefault();
      sidebarResizer.classList.add("active");
      const startX = e.clientX;
      const startW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w")) || 280;
      const onMove = (ev: MouseEvent) => {
        const newW = Math.max(180, Math.min(520, startW + ev.clientX - startX));
        document.documentElement.style.setProperty("--sidebar-w", newW + "px");
      };
      const onUp = () => {
        sidebarResizer.classList.remove("active");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // ── Panel resize ────────────────────────────────────────
  const panelResizer = document.getElementById("panelResizer");
  if (panelResizer) {
    panelResizer.addEventListener("mousedown", (e) => {
      if (bottomPanelCollapsed) return;
      e.preventDefault();
      panelResizer.classList.add("active");
      const startY = e.clientY;
      const startH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bottom-panel-h")) || 250;
      const onMove = (ev: MouseEvent) => {
        const newH = Math.max(80, Math.min(window.innerHeight * 0.65, startH - (ev.clientY - startY)));
        document.documentElement.style.setProperty("--bottom-panel-h", newH + "px");
      };
      const onUp = () => {
        panelResizer.classList.remove("active");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // ── Compress ────────────────────────────────────────────
  document.querySelectorAll<HTMLButtonElement>("[data-cmpr]").forEach(b => { b.onclick = () => { compressLevel = b.dataset.cmpr as any; render(); }; });

  // ── Split ───────────────────────────────────────────────
  document.querySelectorAll<HTMLButtonElement>("[data-splitout]").forEach(b => { b.onclick = () => { splitOutput = b.dataset.splitout as any; render(); }; });
  document.querySelectorAll<HTMLButtonElement>("[data-splitvis]").forEach(b => {
    b.onclick = () => {
      const on = b.dataset.splitvis === "1";
      if (on && !splitVisualMode) { visualSelectedPages = parsePageList(splitPages); splitVisualMode = true; }
      else { splitVisualMode = false; }
      render();
    };
  });
  const pagesEl = document.getElementById("pages") as HTMLInputElement | null;
  if (pagesEl) pagesEl.oninput = () => {
    splitPages = pagesEl.value;
    const v = validatePageInput(splitPages);
    const h = document.getElementById("pageHint"); if (h) h.innerHTML = renderVH(v);
    pagesEl.className = `input${v?.type==="error"?" invalid":v?.type==="ok"?" valid":""}`;
    (document.getElementById("run") as HTMLButtonElement|null)!.disabled = !canRun();
  };

  // ── PDF2img ─────────────────────────────────────────────
  document.querySelectorAll<HTMLButtonElement>("[data-imgfmt]").forEach(b => { b.onclick = () => { imgFormat = b.dataset.imgfmt as any; render(); }; });
  const dpiEl = document.getElementById("dpi") as HTMLInputElement | null;
  if (dpiEl) dpiEl.oninput = () => {
    imgDpi = Number(dpiEl.value) || 150;
    const v = validateDpiInput(imgDpi);
    const h = document.getElementById("dpiHint"); if (h) h.innerHTML = renderVH(v);
    dpiEl.className = `input${v?.type==="error"?" invalid":v?.type==="ok"?" valid":""}`;
    (document.getElementById("run") as HTMLButtonElement|null)!.disabled = !canRun();
  };

  // ── Rotate ──────────────────────────────────────────────
  document.querySelectorAll<HTMLButtonElement>("[data-rotangle]").forEach(b => { b.onclick = () => { rotateAngle = Number(b.dataset.rotangle) as any; render(); }; });
  document.querySelectorAll<HTMLButtonElement>("[data-rottgt]").forEach(b => { b.onclick = () => { rotateTarget = b.dataset.rottgt as any; render(); }; });
  const rPEl = document.getElementById("rotatePages") as HTMLInputElement | null;
  if (rPEl) rPEl.oninput = () => {
    rotatePages = rPEl.value;
    const v = validatePageInput(rotatePages);
    const h = document.getElementById("rotatePagesHint"); if (h) h.innerHTML = renderVH(v);
    rPEl.className = `input${v?.type==="error"?" invalid":v?.type==="ok"?" valid":""}`;
    (document.getElementById("run") as HTMLButtonElement|null)!.disabled = !canRun();
  };

  // ── img2pdf ─────────────────────────────────────────────
  document.querySelectorAll<HTMLButtonElement>("[data-img2pdflayout]").forEach(b => { b.onclick = () => { img2pdfLayout = b.dataset.img2pdflayout as any; render(); }; });

  // ── Protect ─────────────────────────────────────────────
  document.querySelectorAll<HTMLButtonElement>("[data-protmode]").forEach(b => { b.onclick = () => { protectMode = b.dataset.protmode as any; render(); }; });
  const np = document.getElementById("newPwd") as HTMLInputElement | null;
  if (np) np.oninput = () => { protectNewPassword = np.value; const h = document.getElementById("pwdHint"); if (h) h.innerHTML = renderVH(validateProtectPassword(protectNewPassword, protectConfirmPassword)); (document.getElementById("run") as HTMLButtonElement|null)!.disabled = !canRun(); };
  const cp = document.getElementById("confirmPwd") as HTMLInputElement | null;
  if (cp) cp.oninput = () => { protectConfirmPassword = cp.value; const h = document.getElementById("pwdHint"); if (h) h.innerHTML = renderVH(validateProtectPassword(protectNewPassword, protectConfirmPassword)); (document.getElementById("run") as HTMLButtonElement|null)!.disabled = !canRun(); };

  // ── Delete pages ────────────────────────────────────────
  document.querySelectorAll<HTMLButtonElement>("[data-deletevis]").forEach(b => {
    b.onclick = () => {
      const on = b.dataset.deletevis === "1";
      if (on && !deleteVisualMode) { visualSelectedPages = parsePageList(deletePagesInput); deleteVisualMode = true; }
      else { deleteVisualMode = false; }
      render();
    };
  });
  const dpEl = document.getElementById("deletePages") as HTMLInputElement | null;
  if (dpEl) dpEl.oninput = () => {
    deletePagesInput = dpEl.value;
    const v = validatePageInput(deletePagesInput);
    const h = document.getElementById("deletePagesHint"); if (h) h.innerHTML = renderVH(v);
    dpEl.className = `input${v?.type==="error"?" invalid":v?.type==="ok"?" valid":""}`;
    (document.getElementById("run") as HTMLButtonElement|null)!.disabled = !canRun();
  };

  // ── Watermark ───────────────────────────────────────────
  const wmt = document.getElementById("wmText") as HTMLInputElement | null;
  if (wmt) wmt.oninput = () => { watermarkText = wmt.value; (document.getElementById("run") as HTMLButtonElement|null)!.disabled = !canRun(); };
  const wmo = document.getElementById("wmOpacity") as HTMLInputElement | null;
  if (wmo) wmo.oninput = () => { watermarkOpacity = Number(wmo.value)||30; };
  const wma = document.getElementById("wmAngle") as HTMLInputElement | null;
  if (wma) wma.oninput = () => { watermarkAngle = Number(wma.value)||0; };
  const wms = document.getElementById("wmSize") as HTMLInputElement | null;
  if (wms) wms.oninput = () => { watermarkSize = Math.max(8, Number(wms.value)||60); };
  const wmc = document.getElementById("wmColor") as HTMLInputElement | null;
  if (wmc) wmc.oninput = () => { watermarkColor = wmc.value; };

  // ── Page numbers ────────────────────────────────────────
  document.querySelectorAll<HTMLButtonElement>("[data-pgpos]").forEach(b => { b.onclick = () => { pageNumPosition = b.dataset.pgpos as any; render(); }; });
  const pgs = document.getElementById("pgStart") as HTMLInputElement | null;
  if (pgs) pgs.oninput = () => { pageNumStart = Number(pgs.value)||1; };
  const pgp = document.getElementById("pgPrefix") as HTMLInputElement | null;
  if (pgp) pgp.oninput = () => { pageNumPrefix = pgp.value; };
  const pgsz = document.getElementById("pgSize") as HTMLInputElement | null;
  if (pgsz) pgsz.oninput = () => { pageNumFontSize = Math.max(6, Number(pgsz.value)||11); };

  // ── Metadata ────────────────────────────────────────────
  const mts: [string, () => void][] = [
    ["metaTitle",    () => metaTitle    = (document.getElementById("metaTitle")    as HTMLInputElement)?.value ?? metaTitle],
    ["metaAuthor",   () => metaAuthor   = (document.getElementById("metaAuthor")   as HTMLInputElement)?.value ?? metaAuthor],
    ["metaSubject",  () => metaSubject  = (document.getElementById("metaSubject")  as HTMLInputElement)?.value ?? metaSubject],
    ["metaKeywords", () => metaKeywords = (document.getElementById("metaKeywords") as HTMLInputElement)?.value ?? metaKeywords],
    ["metaCreator",  () => metaCreator  = (document.getElementById("metaCreator")  as HTMLInputElement)?.value ?? metaCreator],
  ];
  mts.forEach(([id, fn]) => { const el = document.getElementById(id) as HTMLInputElement | null; if (el) el.oninput = fn; });

  // ── Crop ────────────────────────────────────────────────
  document.querySelectorAll<HTMLButtonElement>("[data-cropunit]").forEach(b => { b.onclick = () => { cropUnit = b.dataset.cropunit as any; render(); }; });
  const cropFields: [string, () => void][] = [
    ["cropTop",    () => cropTop    = Math.max(0, Number((document.getElementById("cropTop")    as HTMLInputElement)?.value) || 0)],
    ["cropBottom", () => cropBottom = Math.max(0, Number((document.getElementById("cropBottom") as HTMLInputElement)?.value) || 0)],
    ["cropLeft",   () => cropLeft   = Math.max(0, Number((document.getElementById("cropLeft")   as HTMLInputElement)?.value) || 0)],
    ["cropRight",  () => cropRight  = Math.max(0, Number((document.getElementById("cropRight")  as HTMLInputElement)?.value) || 0)],
  ];
  cropFields.forEach(([id, fn]) => { const el = document.getElementById(id) as HTMLInputElement | null; if (el) el.oninput = fn; });

  // ── Reorder text input ──────────────────────────────────
  const reEl = document.getElementById("reorderInput") as HTMLInputElement | null;
  if (reEl) reEl.oninput = () => {
    reorderInput = reEl.value;
    const parts = reorderInput.trim().split(",").map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
    if (parts.length && new Set(parts).size === parts.length) reorderVisualOrder = parts;
    const v = validateReorderInput(reorderInput);
    const h = document.getElementById("reorderHint"); if (h) h.innerHTML = renderVH(v);
    reEl.className = `input${v?.type==="error"?" invalid":v?.type==="ok"?" valid":""}`;
    (document.getElementById("run") as HTMLButtonElement|null)!.disabled = !canRun();
  };

  // ── Visual page selection (split / deletepages) ─────────
  document.querySelectorAll<HTMLDivElement>(".thumbCard[data-selectpage]").forEach(card => {
    const page = Number(card.dataset.selectpage);
    card.onclick = () => {
      const idx = visualSelectedPages.indexOf(page);
      if (idx >= 0) visualSelectedPages = visualSelectedPages.filter(p => p !== page);
      else visualSelectedPages = [...visualSelectedPages, page].sort((a, b) => a - b);
      if (activeTool === "split") { splitPages = visualSelectedPages.join(",") || "1"; }
      if (activeTool === "deletepages") { deletePagesInput = visualSelectedPages.join(",") || "1"; }
      render();
    };
  });

  // ── Reorder thumbnail drag ──────────────────────────────
  const thumbCards = document.querySelectorAll<HTMLDivElement>(".thumbCard[data-thumbidx]");
  thumbCards.forEach(card => {
    const idx = Number(card.dataset.thumbidx);
    card.ondragstart = (e) => { thumbDragIdx = idx; card.classList.add("dragging"); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; };
    card.ondragend = () => { thumbDragIdx = null; card.classList.remove("dragging"); thumbCards.forEach(c => c.classList.remove("dropTarget")); };
    card.ondragover = (e) => { if (thumbDragIdx === null || thumbDragIdx === idx) return; e.preventDefault(); card.classList.add("dropTarget"); };
    card.ondragleave = () => card.classList.remove("dropTarget");
    card.ondrop = (e) => {
      e.preventDefault(); card.classList.remove("dropTarget");
      const from = thumbDragIdx; thumbDragIdx = null;
      if (from === null || from === idx) return;
      const o = [...reorderVisualOrder]; const [m] = o.splice(from, 1); o.splice(idx, 0, m);
      reorderVisualOrder = o; reorderInput = o.join(",");
      render();
    };
  });

  // ── Drop zone ───────────────────────────────────────────
  const drop = document.getElementById("drop")!;
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("dragover"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("dragover"); if (e.dataTransfer?.files) onFilesChosen(e.dataTransfer.files); });

  // ── Downloads + use as input ────────────────────────────
  document.querySelectorAll<HTMLButtonElement>("[data-dl]").forEach(b => {
    b.onclick = () => { const j = jobs.find(j => j.id === b.dataset.dl); if (j?.outputBlob && j.outputName) downloadBlob(j.outputBlob, j.outputName); };
  });
  document.querySelectorAll<HTMLButtonElement>("[data-useinput]").forEach(b => {
    b.onclick = () => useJobAsInput(b.dataset.useinput!);
  });

  // ── File remove + passwords ─────────────────────────────
  document.querySelectorAll<HTMLButtonElement>("[data-rm]").forEach(b => { b.onclick = () => removeFile(Number(b.dataset.rm)); });
  document.querySelectorAll<HTMLInputElement>("[data-pass]").forEach(inp => {
    inp.oninput = () => { const i = Number(inp.dataset.pass); if (Number.isFinite(i) && files[i]) files[i] = { ...files[i], password: inp.value.trim() }; };
  });

  // ── File reorder drag (merge / img2pdf) ─────────────────
  const rows = document.querySelectorAll<HTMLDivElement>(".fileRow[data-idx]");
  rows.forEach(row => {
    const idx = Number(row.dataset.idx);
    const canDrag = isMulti && files.length > 1;
    row.draggable = canDrag;
    if (!canDrag) return;
    row.ondragstart = (e) => { draggingIdx = idx; row.classList.add("dragging"); e.dataTransfer?.setData("text/plain", String(idx)); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; };
    row.ondragend = () => { draggingIdx = null; row.classList.remove("dragging"); rows.forEach(r => r.classList.remove("dropTarget")); };
    row.ondragover = (e) => { if (draggingIdx === null || draggingIdx === idx) return; e.preventDefault(); row.classList.add("dropTarget"); };
    row.ondragleave = () => row.classList.remove("dropTarget");
    row.ondrop = (e) => { e.preventDefault(); row.classList.remove("dropTarget"); const from = draggingIdx ?? Number(e.dataTransfer?.getData("text/plain")); draggingIdx = null; if (Number.isFinite(from)) moveFile(Number(from), idx); render(); };
  });

  // ── Restore scroll positions ────────────────────────────
  const ws = document.getElementById("toolWorkspace"); if (ws) ws.scrollTop = prevWorkspaceScroll;
  const pb = document.querySelector<HTMLElement>(".panel-body"); if (pb) pb.scrollTop = prevPanelScroll;
}

// ─── Keyboard shortcuts (one-time setup) ─────────────────
document.addEventListener("keydown", (e) => {
  const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as Element)?.tagName ?? "");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
    e.preventDefault(); document.getElementById("pick")?.click();
  }
  if (e.key === "Enter" && !inInput) {
    const btn = document.getElementById("run") as HTMLButtonElement | null;
    if (btn && !btn.disabled) btn.click();
  }
  if (e.key === "Escape" && !inInput && files.length > 0) clearFiles();
  if (e.key.toLowerCase() === "t" && !inInput) toggleTheme();
  if (e.key.toLowerCase() === "b" && !inInput) { sidebarCollapsed = !sidebarCollapsed; render(); }
  if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
    const idx = parseInt(e.key) - 1;
    if (TOOLS[idx]) { e.preventDefault(); setActiveTool(TOOLS[idx].id); }
  }
});

// ─── Init ────────────────────────────────────────────────
restoreFromURLHash();
loadJobsFromStorage();
render();
