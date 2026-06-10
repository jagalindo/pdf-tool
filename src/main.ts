import "./styles.css";
import type { Job, ToolDef, ToolId } from "./types";
import type { WorkerEvent, WorkerRequest } from "./worker/messages";
import type { ThumbEvent } from "./worker/thumb.worker";
import { buildZip } from "./utils/zip";
import { t, getLang, setLang, LANGS, type I18nKey } from "./i18n";

type SelectedFile = { file: File; key: string; password: string };

const TOOLS: ToolDef[] = [
  { id: "merge",       accepts: "pdf",   output: "pdf" },
  { id: "split",       accepts: "pdf",   output: "pdf" },
  { id: "compress",    accepts: "pdf",   output: "pdf" },
  { id: "pdf2img",     accepts: "pdf",   output: "zip" },
  { id: "rotate",      accepts: "pdf",   output: "pdf" },
  { id: "img2pdf",     accepts: "image", output: "pdf" },
  { id: "protect",     accepts: "pdf",   output: "pdf" },
  { id: "deletepages", accepts: "pdf",   output: "pdf" },
  { id: "watermark",   accepts: "pdf",   output: "pdf" },
  { id: "pagenumbers", accepts: "pdf",   output: "pdf" },
  { id: "metadata",    accepts: "pdf",   output: "pdf" },
  { id: "extracttext", accepts: "pdf",   output: "txt" },
  { id: "crop",        accepts: "pdf",   output: "pdf" },
  { id: "reorder",     accepts: "pdf",   output: "pdf" },
];

const TOOL_ICONS: Record<string, string> = {
  merge:"🔗", split:"✂️", compress:"🗜️", pdf2img:"🖼️",
  rotate:"🔄", img2pdf:"📸", protect:"🔒", deletepages:"🗑️",
  watermark:"💧", pagenumbers:"🔢", metadata:"🏷️",
  extracttext:"📝", crop:"✂", reorder:"↕️",
};

const TOOL_TAGS: Record<ToolId, I18nKey[]> = {
  merge:       ["tag.pdf", "tag.offline", "tag.fast"],
  split:       ["tag.pages", "tag.offline", "tag.zip"],
  compress:    ["tag.wasm", "tag.offline"],
  pdf2img:     ["tag.wasm", "tag.offline", "tag.zip"],
  rotate:      ["tag.pages", "tag.offline"],
  img2pdf:     ["tag.images", "tag.offline"],
  protect:     ["tag.security", "tag.wasm", "tag.offline"],
  deletepages: ["tag.pages", "tag.offline"],
  watermark:   ["tag.offline"],
  pagenumbers: ["tag.offline"],
  metadata:    ["tag.offline"],
  extracttext: ["tag.wasm", "tag.offline"],
  crop:        ["tag.pages", "tag.offline"],
  reorder:     ["tag.pages", "tag.offline"],
};

const TOOL_GROUPS: { nameKey: I18nKey; tools: ToolId[] }[] = [
  { nameKey: "group.organize", tools: ["merge", "split", "reorder", "deletepages", "rotate"] },
  { nameKey: "group.convert",  tools: ["pdf2img", "img2pdf", "extracttext"] },
  { nameKey: "group.enhance",  tools: ["watermark", "pagenumbers", "metadata", "crop"] },
  { nameKey: "group.security", tools: ["protect", "compress"] },
];

function toolTitle(id: ToolId) { return t(`tool.${id}.title` as I18nKey); }
function toolSubtitle(id: ToolId) { return t(`tool.${id}.subtitle` as I18nKey); }

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

// ─── Language ─────────────────────────────────────────────
function toggleLang() {
  const idx = LANGS.indexOf(getLang());
  setLang(LANGS[(idx + 1) % LANGS.length]);
  render();
}

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

function jpegBufToBlobUrl(buf: ArrayBuffer): string {
  return URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
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

// Register service worker — use BASE_URL so it works on GitHub Pages subpaths
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js").catch(() => { /* ignore */ });
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
  for (const url of thumbPages[key] ?? []) URL.revokeObjectURL(url);
  delete thumbPages[key];
  delete thumbTotal[key];
  thumbLoading.delete(key);
  thumbFailed.delete(key);
}

function handleThumbMessage(ev: MessageEvent<ThumbEvent>) {
  const msg = ev.data;
  if (msg.type === "thumb") {
    if (!thumbPages[msg.fileKey]) thumbPages[msg.fileKey] = [];
    thumbPages[msg.fileKey][msg.index] = jpegBufToBlobUrl(msg.jpeg);
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
      error: (j.status === "running" || j.status === "queued") ? t("job.interrupted") : j.error,
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
  if (view === "home") {
    history.replaceState(null, "", location.pathname + location.search);
    return;
  }
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
    view = "tool";
    currentStep = 1;
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
    const holders = document.querySelectorAll<HTMLElement>(`[data-jobid="${msg.jobId}"]`);
    let updated = false;
    holders.forEach(holder => {
      const fill = holder.querySelector<HTMLElement>(".progressFill");
      const pct  = holder.querySelector<HTMLElement>(".progressPct");
      if (fill && pct) {
        fill.style.width = `${msg.progress}%`;
        pct.textContent  = `${msg.progress}%${msg.note ? ` – ${msg.note}` : ""}`;
        updated = true;
      }
    });
    if (!updated) render();
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
let view: "home" | "tool" = "home";
let currentStep: 1 | 2 | 3 = 1;
let historyOpen = false;
let currentJobId: string | null = null;
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
let reorderRotations: Record<number, number> = {};   // pageNum → cumulative degrees
let reorderSelected: Set<number> = new Set();         // indices in reorderVisualOrder
let reorderDragOverIdx: number | null = null;
let reorderThumbSize = 120;
let reorderLastSelectedIdx: number | null = null;
// shared visual selection (split + delete)
let visualSelectedPages: number[] = [];

// Does the active tool have an options step?
function toolHasOptions(id: ToolId): boolean { return id !== "extracttext"; }

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
  const txt = input.trim();
  if (!txt) return { type: "error", msg: t("val.pagesEmpty") };
  if (/[^0-9,;\s\n\-]/.test(txt)) return { type: "error", msg: t("val.pagesChars") };
  const { flat, groups } = parsePageGroups(txt);
  if (!flat.length) return { type: "error", msg: t("val.pagesNone") };
  if (flat.length > 500) return { type: "warn", msg: t("val.pagesMany", flat.length) };
  if (Math.max(...flat) > 10000) return { type: "warn", msg: t("val.pageMaxHigh") };
  return { type: "ok", msg: t("val.pagesOk", flat.length, groups.length > 1 ? t("val.pagesGroups", groups.length) : "") };
}

function validateDpiInput(v: number): VR {
  if (!Number.isFinite(v) || v <= 0) return { type: "error", msg: t("val.dpiInvalid") };
  if (v < 36) return { type: "error", msg: t("val.dpiMin") };
  if (v > 600) return { type: "error", msg: t("val.dpiMax") };
  if (v > 300) return { type: "warn", msg: t("val.dpiHigh", v) };
  return { type: "ok", msg: t("val.dpiOk", v) };
}

function validateProtectPassword(pwd: string, confirm: string): VR {
  if (!pwd) return { type: "error", msg: t("val.pwdEmpty") };
  if (pwd !== confirm) return { type: "error", msg: t("val.pwdMismatch") };
  if (pwd.length < 4) return { type: "warn", msg: t("val.pwdShort") };
  return { type: "ok", msg: t("val.pwdOk") };
}

function validateReorderInput(input: string): VR {
  const txt = input.trim();
  if (!txt) return { type: "error", msg: t("val.reorderEmpty") };
  if (/[^0-9,\s]/.test(txt)) return { type: "error", msg: t("val.reorderChars") };
  const nums = txt.split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
  if (nums.some(n => !Number.isInteger(n) || n < 1)) return { type: "error", msg: t("val.reorderInts") };
  if (new Set(nums).size !== nums.length) return { type: "error", msg: t("val.reorderDupes") };
  const totalKnown = files[0] ? thumbTotal[files[0].key] : undefined;
  if (totalKnown) {
    const missing = Array.from({ length: totalKnown }, (_, i) => i + 1).filter(p => !nums.includes(p));
    if (missing.length) return { type: "error", msg: t("val.reorderMissing", missing.join(", "), totalKnown) };
    if (nums.some(n => n > totalKnown)) return { type: "error", msg: t("val.reorderRange", totalKnown) };
  }
  return { type: "ok", msg: t("val.reorderOk", nums.length) };
}

function validateFiles(): VR {
  const isImg = activeTool === "img2pdf";
  const isMulti = activeTool === "merge" || activeTool === "img2pdf";
  if (files.length === 0) return { type: "error", msg: isImg ? t("val.filesNoneImg") : t("val.filesNonePdf") };
  if (activeTool === "merge" && files.length < 2) return { type: "error", msg: t("val.mergeMin") };
  if (activeTool === "merge" && files.length > MAX_MERGE_FILES) return { type: "error", msg: t("val.mergeMax", MAX_MERGE_FILES) };
  if (!isMulti && files.length > 1) return { type: "warn", msg: t("val.onlyFirst") };
  if (files.some(f => f.file.size === 0)) return { type: "error", msg: t("val.emptyFile") };
  if (files.some(f => f.file.size > MAX_FILE_SIZE)) return { type: "error", msg: t("val.fileTooBig", prettyBytes(MAX_FILE_SIZE)) };
  const big = files.find(f => f.file.size > WARN_FILE_SIZE);
  if (big) return { type: "warn", msg: t("val.fileBig", big.file.name, prettyBytes(big.file.size)) };
  return null;
}

function filesOk(): boolean {
  return files.length > 0 && validateFiles()?.type !== "error";
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

function syncRunBtn() {
  const rb = document.getElementById("run") as HTMLButtonElement | null;
  if (rb) rb.disabled = !canRun();
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
    if (imgs.length < all.length) alert(t("alert.ignoredImg", all.length - imgs.length));
    accepted = imgs.filter(f => f.size > 0 && f.size <= MAX_FILE_SIZE);
  } else {
    const pdfs = all.filter(f => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length < all.length) alert(t("alert.ignoredPdf", all.length - pdfs.length));
    const big = pdfs.find(f => f.size > MAX_FILE_SIZE);
    if (big) alert(t("alert.tooBigIgnored", big.name, prettyBytes(MAX_FILE_SIZE)));
    accepted = pdfs.filter(f => f.size > 0 && f.size <= MAX_FILE_SIZE);
  }
  if (!accepted.length) return;
  const map = new Map(files.map(f => [f.key, f]));
  for (const f of accepted) {
    const key = makeKey(f);
    map.set(key, map.get(key) ?? { file: f, key, password: "" });
  }
  if (activeTool === "merge" && map.size > MAX_MERGE_FILES) {
    alert(t("alert.mergeTrim", MAX_MERGE_FILES));
    files = Array.from(map.values()).slice(0, MAX_MERGE_FILES);
  } else {
    files = Array.from(map.values());
  }
  visualSelectedPages = [];
  if (activeTool === "reorder" && files.length === 1) { reorderVisualOrder = []; reorderInput = ""; reorderRotations = {}; reorderSelected = new Set(); reorderDragOverIdx = null; reorderLastSelectedIdx = null; }
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
  reorderRotations = {}; reorderSelected = new Set(); reorderDragOverIdx = null; reorderLastSelectedIdx = null;
  visualSelectedPages = [];
  render();
}

function setActiveTool(next: ToolId) {
  activeTool = next; files = [];
  reorderVisualOrder = []; reorderInput = "";
  reorderRotations = {}; reorderSelected = new Set(); reorderDragOverIdx = null; reorderLastSelectedIdx = null;
  visualSelectedPages = []; splitVisualMode = false; deleteVisualMode = false;
  view = "tool"; currentStep = 1; currentJobId = null;
  updateURLHash(); render();
  window.scrollTo({ top: 0 });
}

function goHome() {
  view = "home"; currentStep = 1; currentJobId = null;
  for (const sf of files) clearThumbs(sf.key);
  files = [];
  reorderVisualOrder = []; reorderInput = "";
  reorderRotations = {}; reorderSelected = new Set(); reorderDragOverIdx = null; reorderLastSelectedIdx = null;
  visualSelectedPages = []; splitVisualMode = false; deleteVisualMode = false;
  updateURLHash(); render();
  window.scrollTo({ top: 0 });
}

function goToStep(step: 1 | 2 | 3) {
  currentStep = step;
  render();
  window.scrollTo({ top: 0 });
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
    alert(t("alert.readError", e?.message ?? e));
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
  if (activeTool === "watermark" && !watermarkText.trim()) return alert(t("alert.watermarkText"));
  if (activeTool === "reorder" && validateReorderInput(reorderInput)?.type === "error") return alert(validateReorderInput(reorderInput)!.msg);

  const jobId = uid();
  const job: Job = { id: jobId, toolId: activeTool, toolTitle: toolTitle(activeTool), createdAt: Date.now(), status: "queued", progress: 0, inputCount: files.length, inputSize: totalInputSize() };
  jobs = [job, ...jobs];
  currentJobId = jobId;
  currentStep = 3;
  render();
  window.scrollTo({ top: 0 });

  const built = await buildRequest(jobId);
  if (!built) { jobs = jobs.filter(j => j.id !== jobId); currentJobId = null; currentStep = toolHasOptions(activeTool) ? 2 : 1; render(); return; }

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
  jobs = jobs.map(j => (j.status === "running" || j.status === "queued") ? { ...j, status: "error", progress: 0, progressNote: undefined, error: t("job.cancelled") } : j);
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
  downloadBlob(new Blob([zip.buffer as ArrayBuffer], { type: "application/zip" }), t("history.zipName", new Date().toISOString().slice(0, 10)));
}

function useJobAsInput(jobId: string) {
  const job = jobs.find(j => j.id === jobId);
  if (!job?.outputBlob || !job.outputName) return;
  const file = new File([job.outputBlob], job.outputName, { type: "application/pdf" });
  const key = makeKey(file);
  for (const sf of files) clearThumbs(sf.key);
  files = [{ file, key, password: "" }];
  reorderVisualOrder = []; reorderInput = "";
  reorderRotations = {}; reorderSelected = new Set(); reorderDragOverIdx = null; reorderLastSelectedIdx = null;
  visualSelectedPages = []; splitVisualMode = false; deleteVisualMode = false;
  if (view !== "tool") view = "tool";
  currentStep = 1;
  historyOpen = false;
  requestThumbnails(files[0]);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─── Tool cards (home) ────────────────────────────────────
function getFilteredTools() {
  if (!searchQuery.trim()) return TOOLS;
  const q = searchQuery.toLowerCase();
  return TOOLS.filter(td =>
    toolTitle(td.id).toLowerCase().includes(q) ||
    toolSubtitle(td.id).toLowerCase().includes(q) ||
    TOOL_TAGS[td.id].some(k => t(k).toLowerCase().includes(q)));
}

function renderToolCard(td: ToolDef): string {
  return `<button class="toolCard" data-tool="${td.id}">
    <span class="toolCardIcon">${TOOL_ICONS[td.id] ?? "📄"}</span>
    <span class="toolCardText">
      <span class="toolCardTitle">${toolTitle(td.id)}</span>
      <span class="toolCardSub">${toolSubtitle(td.id)}</span>
    </span>
  </button>`;
}

function renderToolGrid(filtered: ToolDef[]): string {
  if (!filtered.length) return `<div class="small" style="padding:16px;text-align:center;">${t("home.noResults")}</div>`;
  if (searchQuery.trim()) return `<div class="toolGrid">${filtered.map(renderToolCard).join("")}</div>`;
  return TOOL_GROUPS.map(g => {
    const gTools = g.tools.map(id => TOOLS.find(td => td.id === id)!).filter(Boolean);
    return `<section class="toolGroupSection">
      <h2 class="toolGroupTitle">${t(g.nameKey)}</h2>
      <div class="toolGrid">${gTools.map(renderToolCard).join("")}</div>
    </section>`;
  }).join("");
}

function bindToolCards(c: HTMLElement) {
  c.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(b => {
    b.onclick = () => setActiveTool(b.dataset.tool as ToolId);
  });
}

// ─── Thumbnail grid rendering ─────────────────────────────
function renderThumbGridReorder(fileKey: string): string {
  const pages = thumbPages[fileKey] ?? [];
  const total = thumbTotal[fileKey] ?? 0;
  const loading = thumbLoading.has(fileKey);
  const failed = thumbFailed.has(fileKey);

  if (failed) return `<div class="small" style="margin-top:8px;">${t("thumb.loadFailed")}</div>`;
  if (!total && loading) return `<div class="small" style="margin-top:8px;"><span class="spinner" style="display:inline-block;margin-right:6px;"></span> ${t("thumb.loading")}</div>`;
  if (!total) return "";

  const order = reorderVisualOrder.length > 0 ? reorderVisualOrder : Array.from({ length: total }, (_, i) => i + 1);

  const cards = order.map((pageNum, idx) => {
    const src = pages[pageNum - 1];
    const rot = reorderRotations[pageNum] ?? 0;
    const sel = reorderSelected.has(idx);
    const dragging = thumbDragIdx === idx;
    const insertBefore = reorderDragOverIdx === idx && thumbDragIdx !== null && thumbDragIdx !== idx;
    return `${insertBefore ? `<div class="insertBefore"></div>` : ""}` +
      `<div class="thumbCard${dragging ? " dragging" : ""}${sel ? " selected" : ""}" data-thumbidx="${idx}" draggable="true" tabindex="0">
        <div class="thumbToolbar">
          <button class="thumbToolbarBtn" data-rot-left="${idx}" title="${t("reorder.rotateLeft")}">↺</button>
          <button class="thumbToolbarBtn" data-rot-right="${idx}" title="${t("reorder.rotateRight")}">↻</button>
          <button class="thumbToolbarBtn" data-del-page="${idx}" title="${t("reorder.delete")}">🗑</button>
        </div>
        ${src ? `<img class="thumbImg" src="${src}" style="${rot ? `transform:rotate(${rot}deg)` : ""}" />` : `<div class="thumbSkeleton"></div>`}
        <div class="thumbNum">${pageNum}</div>
      </div>`;
  }).join("");

  const actionBar = reorderSelected.size > 0 ? `
    <div class="reorderActionBar">
      <span class="actionLabel">${t("reorder.selected", reorderSelected.size)}</span>
      <button class="btn" data-batch-rot-left="1">↺ ${t("reorder.rotateLeft")}</button>
      <button class="btn" data-batch-rot-right="1">↻ ${t("reorder.rotateRight")}</button>
      <button class="btn danger" data-batch-delete="1">🗑 ${t("reorder.deleteSelected")}</button>
      <button class="btn" data-batch-deselect="1">${t("reorder.deselectAll")}</button>
    </div>` : "";

  return `
    <div class="reorderSizeRow">
      <label for="reorderSizeSlider">${t("reorder.thumbSize")}</label>
      <input type="range" id="reorderSizeSlider" min="80" max="220" step="20" value="${reorderThumbSize}" title="${t("reorder.sizeSlider")}" />
    </div>
    <div class="small" style="margin-bottom:4px;">${t("thumb.dragReorder")}</div>
    <div class="thumbGrid reorderGrid" id="thumbGridReorder" style="--reorder-thumb-size:${reorderThumbSize}px;">
      ${cards}
    </div>
    ${actionBar}`;
}

function renderThumbGridSelect(fileKey: string, selected: number[]): string {
  const pages = thumbPages[fileKey] ?? [];
  const total = thumbTotal[fileKey] ?? 0;
  if (!total) return `<div class="small" style="margin-top:6px;"><span class="spinner" style="display:inline-block;margin-right:6px;"></span> ${t("thumb.loading")}</div>`;
  const selSet = new Set(selected);
  return `
    <div class="small" style="margin-bottom:4px;">${t("thumb.clickSelect")}</div>
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
    ${selected.length ? `<div class="small" style="margin-top:4px;">${t("thumb.selected", selected.join(", "))}</div>` : ""}`;
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
    <div class="kv">${t("opt.compressLevel")}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
      ${(["small","balanced","best","aggressive"] as const).map(l => `<button class="btn${compressLevel===l?" primary":""}" data-cmpr="${l}">${t(`opt.cmp.${l}` as I18nKey)}</button>`).join("")}
    </div>
    <div class="small" style="margin-top:6px;">${t(`opt.cmp.${compressLevel}Desc` as I18nKey)}</div>
  </div>`;

  if (activeTool === "split") {
    const canVisual = !!(hasThumb && !thumbLoading.has(fKey));
    return `<div>
      ${canVisual ? `<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
        <button class="btn${splitVisualMode?" primary":""}" data-splitvis="1">${t("opt.visualMode")}</button>
        <button class="btn${!splitVisualMode?" primary":""}" data-splitvis="0">${t("opt.textMode")}</button>
      </div>` : ""}
      ${splitVisualMode && canVisual ? renderThumbGridSelect(fKey, visualSelectedPages) : `
        <div class="kv">${t("opt.pages")}</div>
        <input id="pages" class="input${pv?.type==="error"?" invalid":pv?.type==="ok"?" valid":""}" value="${escapeAttr(splitPages)}" placeholder="${t("opt.pagesPlaceholder")}" style="margin-top:6px;" />
        <div id="pageHint">${renderVH(pv)}</div>
        <div class="small" style="margin-top:4px;">${t("opt.splitFormat")}</div>
      `}
      <div class="kv" style="margin-top:12px;">${t("opt.output")}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
        ${(["single","zip"] as const).map(m => `<button class="btn${splitOutput===m?" primary":""}" data-splitout="${m}">${m==="single"?t("opt.singlePdf"):t("opt.zipPerRange")}</button>`).join("")}
      </div>
    </div>`;
  }

  if (activeTool === "pdf2img") return `<div>
    <div class="kv">${t("opt.format")}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
      ${(["png","jpg"] as const).map(f => `<button class="btn${imgFormat===f?" primary":""}" data-imgfmt="${f}">${f.toUpperCase()}</button>`).join("")}
    </div>
    <div class="kv" style="margin-top:10px;">${t("opt.dpi")}</div>
    <input id="dpi" type="number" min="36" max="600" class="input${dv?.type==="error"?" invalid":dv?.type==="ok"?" valid":""}" value="${imgDpi}" style="margin-top:6px;" />
    <div id="dpiHint">${renderVH(dv)}</div>
    <div class="small" style="margin-top:4px;">${t("opt.pdf2imgNote")}</div>
  </div>`;

  if (activeTool === "rotate") return `<div>
    <div class="kv">${t("opt.angle")}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
      ${([90,180,270] as const).map(a => `<button class="btn${rotateAngle===a?" primary":""}" data-rotangle="${a}">${a===90?"90° →":a===180?"180°":"270° ←"}</button>`).join("")}
    </div>
    <div class="kv" style="margin-top:12px;">${t("opt.applyTo")}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
      <button class="btn${rotateTarget==="all"?" primary":""}" data-rottgt="all">${t("opt.allPages")}</button>
      <button class="btn${rotateTarget==="range"?" primary":""}" data-rottgt="range">${t("opt.specificPages")}</button>
    </div>
    ${rotateTarget==="range"?`
      <input id="rotatePages" class="input${ropv?.type==="error"?" invalid":ropv?.type==="ok"?" valid":""}" value="${escapeAttr(rotatePages)}" placeholder="${t("opt.pagesPlaceholder2")}" style="margin-top:8px;" />
      <div id="rotatePagesHint">${renderVH(ropv)}</div>`:""}
  </div>`;

  if (activeTool === "img2pdf") return `<div>
    <div class="kv">${t("opt.pageSize")}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
      <button class="btn${img2pdfLayout==="auto"?" primary":""}" data-img2pdflayout="auto">${t("opt.autoSize")}</button>
      <button class="btn${img2pdfLayout==="a4"?" primary":""}" data-img2pdflayout="a4">A4</button>
      <button class="btn${img2pdfLayout==="letter"?" primary":""}" data-img2pdflayout="letter">Letter</button>
    </div>
    <div class="small" style="margin-top:6px;">${t("opt.img2pdfNote")}</div>
  </div>`;

  if (activeTool === "protect") return `<div>
    <div class="kv">${t("opt.mode")}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
      <button class="btn${protectMode==="add"?" primary":""}" data-protmode="add">${t("opt.addPassword")}</button>
      <button class="btn${protectMode==="remove"?" primary":""}" data-protmode="remove">${t("opt.removePassword")}</button>
    </div>
    ${protectMode==="add"?`
      <div style="margin-top:12px;">
        <div class="kv">${t("opt.newPassword")}</div>
        <input id="newPwd" class="input" type="password" value="${escapeAttr(protectNewPassword)}" placeholder="${t("opt.newPwdPlaceholder")}" style="margin-top:6px;" autocomplete="new-password" />
        <div class="kv" style="margin-top:8px;">${t("opt.confirmPassword")}</div>
        <input id="confirmPwd" class="input" type="password" value="${escapeAttr(protectConfirmPassword)}" placeholder="${t("opt.confirmPwdPlaceholder")}" style="margin-top:6px;" autocomplete="new-password" />
        <div id="pwdHint">${renderVH(pwv)}</div>
      </div>`:`
      <div class="small" style="margin-top:8px;">${t("opt.removeNote")}</div>`}
  </div>`;

  if (activeTool === "deletepages") {
    const canVisual = !!(hasThumb && !thumbLoading.has(fKey));
    return `<div>
      ${canVisual ? `<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
        <button class="btn${deleteVisualMode?" primary":""}" data-deletevis="1">${t("opt.visualMode")}</button>
        <button class="btn${!deleteVisualMode?" primary":""}" data-deletevis="0">${t("opt.textMode")}</button>
      </div>` : ""}
      ${deleteVisualMode && canVisual ? renderThumbGridSelect(fKey, visualSelectedPages) : `
        <div class="kv">${t("opt.pagesToDelete")}</div>
        <input id="deletePages" class="input${dpv?.type==="error"?" invalid":dpv?.type==="ok"?" valid":""}" value="${escapeAttr(deletePagesInput)}" placeholder="${t("opt.pagesPlaceholder2")}" style="margin-top:6px;" />
        <div id="deletePagesHint">${renderVH(dpv)}</div>
        <div class="small" style="margin-top:4px;">${t("opt.deleteNote")}</div>`}
    </div>`;
  }

  if (activeTool === "watermark") return `<div>
    <div class="kv">${t("opt.text")}</div>
    <input id="wmText" class="input" value="${escapeAttr(watermarkText)}" placeholder="${t("opt.wmPlaceholder")}" style="margin-top:6px;" />
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
      <div><div class="kv">${t("opt.opacity")}</div><input id="wmOpacity" type="number" min="1" max="100" class="input" value="${watermarkOpacity}" style="margin-top:4px;" /></div>
      <div><div class="kv">${t("opt.angleDeg")}</div><input id="wmAngle" type="number" min="-180" max="180" class="input" value="${watermarkAngle}" style="margin-top:4px;" /></div>
      <div><div class="kv">${t("opt.sizePt")}</div><input id="wmSize" type="number" min="8" max="300" class="input" value="${watermarkSize}" style="margin-top:4px;" /></div>
      <div><div class="kv">${t("opt.color")}</div><input id="wmColor" type="color" class="input" value="${watermarkColor}" style="margin-top:4px;height:36px;padding:2px;" /></div>
    </div>
  </div>`;

  if (activeTool === "pagenumbers") return `<div>
    <div class="kv">${t("opt.position")}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
      <button class="btn${pageNumPosition==="bottom-left"?" primary":""}" data-pgpos="bottom-left">${t("opt.bottomLeft")}</button>
      <button class="btn${pageNumPosition==="bottom-center"?" primary":""}" data-pgpos="bottom-center">${t("opt.bottomCenter")}</button>
      <button class="btn${pageNumPosition==="bottom-right"?" primary":""}" data-pgpos="bottom-right">${t("opt.bottomRight")}</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
      <div><div class="kv">${t("opt.startNumber")}</div><input id="pgStart" type="number" min="0" class="input" value="${pageNumStart}" style="margin-top:4px;" /></div>
      <div><div class="kv">${t("opt.prefix")}</div><input id="pgPrefix" class="input" value="${escapeAttr(pageNumPrefix)}" placeholder="${t("opt.prefixPlaceholder")}" style="margin-top:4px;" /></div>
      <div><div class="kv">${t("opt.fontSize")}</div><input id="pgSize" type="number" min="6" max="72" class="input" value="${pageNumFontSize}" style="margin-top:4px;" /></div>
    </div>
  </div>`;

  if (activeTool === "metadata") return `<div>
    <div class="small" style="margin-bottom:8px;">${t("opt.metaNote")}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div><div class="kv">${t("opt.metaTitle")}</div><input id="metaTitle" class="input" value="${escapeAttr(metaTitle)}" placeholder="${t("opt.metaTitle")}" style="margin-top:4px;" /></div>
      <div><div class="kv">${t("opt.metaAuthor")}</div><input id="metaAuthor" class="input" value="${escapeAttr(metaAuthor)}" placeholder="${t("opt.metaAuthor")}" style="margin-top:4px;" /></div>
      <div><div class="kv">${t("opt.metaSubject")}</div><input id="metaSubject" class="input" value="${escapeAttr(metaSubject)}" placeholder="${t("opt.metaSubject")}" style="margin-top:4px;" /></div>
      <div><div class="kv">${t("opt.metaKeywords")}</div><input id="metaKeywords" class="input" value="${escapeAttr(metaKeywords)}" placeholder="kw1, kw2" style="margin-top:4px;" /></div>
      <div><div class="kv">${t("opt.metaCreator")}</div><input id="metaCreator" class="input" value="${escapeAttr(metaCreator)}" placeholder="${t("opt.metaCreatorPlaceholder")}" style="margin-top:4px;" /></div>
    </div>
  </div>`;

  if (activeTool === "extracttext") return `<div>
    <div class="small">${t("opt.extractNote")}</div>
  </div>`;

  if (activeTool === "crop") return `<div>
    <div class="kv">${t("opt.unit")}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
      <button class="btn${cropUnit==="mm"?" primary":""}" data-cropunit="mm">${t("opt.mm")}</button>
      <button class="btn${cropUnit==="pt"?" primary":""}" data-cropunit="pt">${t("opt.pt")}</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
      <div><div class="kv">${t("opt.cropTop")}</div><input id="cropTop" type="number" min="0" class="input" value="${cropTop}" style="margin-top:4px;" /></div>
      <div><div class="kv">${t("opt.cropBottom")}</div><input id="cropBottom" type="number" min="0" class="input" value="${cropBottom}" style="margin-top:4px;" /></div>
      <div><div class="kv">${t("opt.cropLeft")}</div><input id="cropLeft" type="number" min="0" class="input" value="${cropLeft}" style="margin-top:4px;" /></div>
      <div><div class="kv">${t("opt.cropRight")}</div><input id="cropRight" type="number" min="0" class="input" value="${cropRight}" style="margin-top:4px;" /></div>
    </div>
    <div class="small" style="margin-top:6px;">${t("opt.cropNote")}</div>
  </div>`;

  if (activeTool === "reorder") {
    const thumbsReady = hasThumb;
    return `<div>
      <div class="kv">${t("opt.newOrder")}</div>
      <input id="reorderInput" class="input${rv?.type==="error"?" invalid":rv?.type==="ok"?" valid":""}" value="${escapeAttr(reorderInput)}" placeholder="${t("opt.reorderPlaceholder")}" style="margin-top:6px;" />
      <div id="reorderHint">${renderVH(rv)}</div>
      <div class="small" style="margin-top:4px;">${t("opt.reorderNote")}</div>
      ${thumbsReady ? renderThumbGridReorder(fKey) : (thumbLoading.has(fKey) ? `<div class="small" style="margin-top:8px;"><span class="spinner" style="display:inline-block;margin-right:6px;"></span> ${t("thumb.loading")}</div>` : "")}
    </div>`;
  }

  return `<div class="small">${t("opt.noOptions")}</div>`;
}

// ─── Job row (history + result) ───────────────────────────
function renderJobRow(j: Job): string {
  const outSz = j.outputBlob?.size;
  const sizeInfo = j.inputSize ? t("job.input", prettyBytes(j.inputSize)) : "";
  const outInfo = outSz ? t("job.output", prettyBytes(outSz)) : "";
  const red = (j.inputSize && outSz && j.toolId === "compress" && outSz < j.inputSize)
    ? ` (↓${Math.round((1 - outSz / j.inputSize) * 100)}%)` : "";
  const canUse = j.status === "done" && j.outputBlob && j.outputName?.endsWith(".pdf");
  return `<div class="jobRow ${j.status}" data-jobid="${j.id}">
    <div class="row">
      <div style="min-width:0">
        <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeAttr(j.toolTitle)}</div>
        <div class="kv">${new Date(j.createdAt).toLocaleString()} • ${t("job.files", j.inputCount)}</div>
        ${sizeInfo ? `<div class="jobSize">${sizeInfo}${outInfo}${red ? `<span class="reduction">${red}</span>` : ""}</div>` : ""}
      </div>
      <div>${j.status === "running"
        ? `<span class="spinner"></span>`
        : `<span class="badge${j.status === "done" ? " primary" : j.status === "error" ? " error" : ""}">${j.status === "queued" ? t("job.queued") : j.status === "done" ? t("job.done") : t("job.error")}</span>`}
      </div>
    </div>
    <div style="margin-top:10px;">
      <div class="progressBar"><div class="progressFill${j.status === "running" ? " running" : ""}" style="width:${j.progress}%"></div></div>
      <div class="progressPct kv" style="margin-top:6px;">${j.progress}%${j.progressNote ? ` – ${escapeAttr(j.progressNote)}` : ""}</div>
    </div>
    ${j.error ? `<div class="err">${escapeAttr(j.error)}</div>` : ""}
    ${j.status === "done" && j.outputBlob && j.outputName ? `
      <div class="successMsg">${t("job.success")}</div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
        <button class="btn primary" data-dl="${j.id}">⬇ ${escapeAttr(j.outputName)}</button>
        ${canUse ? `<button class="btn" data-useinput="${j.id}">${t("btn.useAsInput")}</button>` : ""}
      </div>` : ""}
  </div>`;
}

// ─── Wizard pieces ────────────────────────────────────────
function renderStepper(): string {
  const stepsList: Array<{ step: 1 | 2 | 3; label: string }> = toolHasOptions(activeTool)
    ? [{ step: 1, label: t("step.1") }, { step: 2, label: t("step.2") }, { step: 3, label: t("step.3") }]
    : [{ step: 1, label: t("step.1") }, { step: 3, label: t("step.3") }];
  return `<div class="stepper">
    ${stepsList.map((s, i) => {
      const state = s.step === currentStep ? "current" : s.step < currentStep ? "done" : "todo";
      const clickable = s.step < currentStep;
      return `${i > 0 ? `<div class="stepLine${s.step <= currentStep ? " active" : ""}"></div>` : ""}
        <button class="step ${state}" data-step="${s.step}" ${clickable ? "" : "disabled"}>
          <span class="stepNum">${state === "done" ? "✓" : i + 1}</span>
          <span class="stepLabel">${s.label}</span>
        </button>`;
    }).join("")}
  </div>`;
}

function renderStep1(): string {
  const isImg = activeTool === "img2pdf";
  const isMulti = activeTool === "merge" || activeTool === "img2pdf";
  const fileVal = files.length > 0 ? validateFiles() : null;
  return `
    <div class="drop" id="drop">
      <div class="dropIcon">⬆</div>
      <div class="dropTitle">${isImg ? t("drop.titleImg") : t("drop.titlePdf")}</div>
      <div class="small">${isImg ? t("drop.hintImg") : t("drop.hintPdf")}</div>
    </div>
    <div class="files" id="files">
      ${isMulti && files.length > 1 ? `<div class="small" style="margin-bottom:2px;">${t("files.reorderHint")}</div>` : ""}
      ${files.length === 0
        ? `<div class="small">${t("files.none")}</div>`
        : files.map((f, idx) => {
            const th0 = thumbPages[f.key]?.[0];
            const tl = thumbLoading.has(f.key);
            const tf = thumbFailed.has(f.key);
            const tc = thumbTotal[f.key];
            return `<div class="fileRow" data-idx="${idx}">
              ${isMulti && files.length > 1 ? `<div class="dragHandle" title="${t("files.dragTitle")}" aria-hidden="true">↕</div>` : ""}
              ${!isImg ? (th0 ? `<img class="filePrev" src="${th0}" alt="p1" />` : tl ? `<div class="filePrevSkeleton"></div>` : tf ? `<div class="icon">🔒</div>` : `<div class="icon">📄</div>`) : `<div class="icon">🖼️</div>`}
              <div class="fileInfo">
                <div class="fileName">${escapeAttr(f.file.name)}</div>
                <div class="fileMeta">${prettyBytes(f.file.size)}${tc ? ` • <span class="pgCount">${t("files.pageChip", tc)}</span>` : tl ? ` • <span class="pgCount">…</span>` : ""}</div>
              </div>
              ${!isImg ? `<div class="filePassword">
                <input class="input" data-pass="${idx}" value="${escapeAttr(f.password ?? "")}" placeholder="${t("files.passwordPlaceholder")}" autocomplete="off" />
                <div class="small">${t("files.passwordNote")}</div>
              </div>` : ""}
              <button class="btn" data-rm="${idx}">${t("btn.remove")}</button>
            </div>`;
          }).join("")}
      ${renderVH(fileVal)}
    </div>
    <div class="wizardFooter">
      <button class="btn" id="pick">${t("btn.upload")}</button>
      <button class="btn" id="clear" ${files.length ? "" : "disabled"}>${t("btn.clear")}</button>
      <span style="flex:1"></span>
      <button class="btn primary big" id="continueBtn" ${filesOk() ? "" : "disabled"}>${toolHasOptions(activeTool) ? t("btn.continue") : t("btn.run")}</button>
    </div>`;
}

function renderStep2(): string {
  const runOk = canRun();
  return `
    <div class="optionsPane">
      <div class="p" style="margin-bottom:12px;">${t("misc.workerNote")}</div>
      ${renderOptions()}
    </div>
    <div class="wizardFooter">
      <button class="btn" id="backBtn">${t("btn.back")}</button>
      <span style="flex:1"></span>
      <button class="btn primary big" id="run" ${runOk ? "" : "disabled"}>
        ${isJobRunning ? t("btn.running") : pendingJobs.length > 0 ? t("btn.queued", pendingJobs.length + 1) : t("btn.run")}
      </button>
    </div>`;
}

function renderStep3(): string {
  const job = currentJobId ? jobs.find(j => j.id === currentJobId) : undefined;
  if (!job) return `<div class="resultCard">
    <div class="small">${t("result.none")}</div>
    <div class="wizardFooter"><button class="btn" id="startOverBtn">${t("btn.startOver")}</button></div>
  </div>`;

  if (job.status === "running" || job.status === "queued") {
    return `<div class="resultCard" data-jobid="${job.id}">
      <div class="resultIcon"><span class="spinner big"></span></div>
      <div class="resultTitle">${job.status === "queued" ? t("result.queuedTitle") : t("result.workingTitle")}</div>
      <div style="margin-top:16px;max-width:420px;margin-left:auto;margin-right:auto;">
        <div class="progressBar"><div class="progressFill${job.status === "running" ? " running" : ""}" style="width:${job.progress}%"></div></div>
        <div class="progressPct kv" style="margin-top:8px;">${job.progress}%${job.progressNote ? ` – ${escapeAttr(job.progressNote)}` : ""}</div>
      </div>
      <div class="wizardFooter" style="justify-content:center;">
        <button class="btn danger" id="cancel">${t("btn.cancel")}${pendingJobs.length > 0 ? ` (${pendingJobs.length + 1})` : ""}</button>
      </div>
    </div>`;
  }

  if (job.status === "error") {
    return `<div class="resultCard" data-jobid="${job.id}">
      <div class="resultIcon error">✕</div>
      <div class="resultTitle">${t("result.errorTitle")}</div>
      ${job.error ? `<div class="err" style="display:inline-block;margin-top:12px;">${escapeAttr(job.error)}</div>` : ""}
      <div class="wizardFooter" style="justify-content:center;">
        <button class="btn primary big" id="tryAgainBtn">${t("btn.tryAgain")}</button>
        <button class="btn" id="startOverBtn">${t("btn.startOver")}</button>
      </div>
    </div>`;
  }

  // done
  const canUse = job.outputBlob && job.outputName?.endsWith(".pdf");
  const outSz = job.outputBlob?.size;
  const red = (job.inputSize && outSz && job.toolId === "compress" && outSz < job.inputSize)
    ? ` (↓${Math.round((1 - outSz / job.inputSize) * 100)}%)` : "";
  return `<div class="resultCard success" data-jobid="${job.id}">
    <div class="resultIcon success">✓</div>
    <div class="resultTitle">${t("result.doneTitle")}</div>
    <div class="p" style="font-size:13px;">${t("result.doneSub")}</div>
    ${job.inputSize && outSz ? `<div class="jobSize" style="margin-top:8px;">${t("job.input", prettyBytes(job.inputSize))}${t("job.output", prettyBytes(outSz))}${red ? `<span class="reduction">${red}</span>` : ""}</div>` : ""}
    <div class="wizardFooter" style="justify-content:center;flex-wrap:wrap;">
      <button class="btn primary big" data-dl="${job.id}">${t("result.download", escapeAttr(job.outputName ?? ""))}</button>
      ${canUse ? `<button class="btn" data-useinput="${job.id}">${t("btn.useAsInput")}</button>` : ""}
      <button class="btn" id="startOverBtn">${t("btn.startOver")}</button>
    </div>
  </div>`;
}

// ─── Top bar ──────────────────────────────────────────────
function renderTopbar(): string {
  const themeIcon = currentTheme === "light" ? "🌙" : "☀️";
  const hasRunning = isJobRunning || pendingJobs.length > 0;
  return `<div class="topbar">
    <div class="topbar-inner">
      <button class="brand" id="brandBtn" title="${t("app.name")}">
        <div class="logo">📄</div>
        <div class="brandText">
          <div class="h1">${t("app.name")}</div>
          <div class="p">${t("app.tagline")}</div>
        </div>
      </button>
      <div style="display:flex;gap:8px;align-items:center;">
        ${deferredInstallPrompt ? `<button id="installBtn" title="${t("topbar.installTitle")}">${t("topbar.install")}</button>` : ""}
        <button class="btn historyBtn${historyOpen ? " primary" : ""}" id="historyBtn">
          ${hasRunning ? `<span class="spinner" style="width:10px;height:10px;border-width:2px;"></span>` : "🕘"}
          ${t("topbar.history")}
          ${jobs.length ? `<span class="countBadge">${jobs.length}</span>` : ""}
        </button>
        <button class="themeBtn" id="langToggle" title="ES / EN / DE / FR" style="width:auto;border-radius:999px;padding:0 10px;font-size:12px;font-weight:700;">${getLang().toUpperCase()}</button>
        <button class="themeBtn" id="themeToggle" title="${t("topbar.themeTitle")}">${themeIcon}</button>
      </div>
    </div>
  </div>`;
}

// ─── History drawer ───────────────────────────────────────
function renderHistoryDrawer(): string {
  const completedJobs = jobs.filter(j => j.status === "done" && j.outputBlob);
  return `
    <div class="drawerOverlay${historyOpen ? " open" : ""}" id="drawerOverlay"></div>
    <aside class="historyDrawer${historyOpen ? " open" : ""}" id="historyDrawer">
      <div class="drawerHeader">
        <div class="h2" style="font-size:15px;">🕘 ${t("topbar.history")} ${jobs.length ? `<span class="countBadge">${jobs.length}</span>` : ""}</div>
        <div style="display:flex;gap:6px;align-items:center;">
          ${completedJobs.length > 1 ? `<button class="btn" style="font-size:11px;padding:4px 10px;" id="dlAll">${t("btn.downloadAll", completedJobs.length)}</button>` : ""}
          <button class="btn" style="font-size:11px;padding:4px 10px;" id="clearJobs" ${jobs.length ? "" : "disabled"}>${t("btn.clear")}</button>
          <button class="icon-btn" id="closeDrawer" title="✕">✕</button>
        </div>
      </div>
      <div class="drawerBody">
        <div class="jobs">
          ${jobs.length === 0 ? `<div class="small">${t("history.empty")}</div>` : jobs.map(renderJobRow).join("")}
        </div>
      </div>
    </aside>`;
}

// ─── Main render ──────────────────────────────────────────
function render() {
  const prevScrollY = window.scrollY;
  const prevDrawerScroll = document.querySelector<HTMLElement>(".drawerBody")?.scrollTop ?? 0;

  updateURLHash();
  document.title = t("doc.title");
  const isImg = activeTool === "img2pdf";
  const isMulti = activeTool === "merge" || activeTool === "img2pdf";

  if (view === "home") {
    app.innerHTML = `
      ${renderTopbar()}
      <main class="home">
        <div class="hero">
          <h1 class="heroTitle">${t("app.name")}</h1>
          <p class="heroSub">🔒 ${t("app.hero")}</p>
        </div>
        <div class="homeSearch">
          <input id="search" class="input" placeholder="${t("home.searchPlaceholder")}" value="${escapeAttr(searchQuery)}" />
        </div>
        <div id="toolGridWrap">${renderToolGrid(getFilteredTools())}</div>
      </main>
      ${renderHistoryDrawer()}`;
  } else {
    app.innerHTML = `
      ${renderTopbar()}
      <main class="wizard">
        <div class="wizardHeader">
          <button class="btn" id="backToTools">${t("wizard.backToTools")}</button>
          <div class="wizardTitle">
            <span class="wizardIcon">${TOOL_ICONS[activeTool] ?? "📄"}</span>
            <div>
              <div class="h2">${toolTitle(activeTool)}</div>
              <div class="p">${toolSubtitle(activeTool)}</div>
            </div>
          </div>
          <div class="badges wizardBadges">
            ${TOOL_TAGS[activeTool].map(k => `<span class="badge">${t(k)}</span>`).join("")}
            <span class="badge primary">${t("tag.private")}</span>
          </div>
        </div>
        ${renderStepper()}
        <div class="wizardPane">
          ${currentStep === 1 ? renderStep1() : currentStep === 2 ? renderStep2() : renderStep3()}
        </div>
        <div class="small" style="margin-top:24px;text-align:center;opacity:.5;">${t("misc.shortcuts")}</div>
      </main>
      ${renderHistoryDrawer()}`;
  }

  // ── Topbar bindings ─────────────────────────────────────
  document.getElementById("brandBtn")!.onclick = goHome;
  document.getElementById("themeToggle")!.onclick = toggleTheme;
  document.getElementById("langToggle")!.onclick = toggleLang;
  document.getElementById("installBtn")?.addEventListener("click", () => { deferredInstallPrompt?.prompt(); });
  document.getElementById("historyBtn")!.onclick = () => { historyOpen = !historyOpen; render(); };
  document.getElementById("closeDrawer")?.addEventListener("click", () => { historyOpen = false; render(); });
  document.getElementById("drawerOverlay")?.addEventListener("click", () => { if (historyOpen) { historyOpen = false; render(); } });
  document.getElementById("clearJobs")?.addEventListener("click", () => { jobs = []; saveJobsToStorage(); render(); });
  document.getElementById("dlAll")?.addEventListener("click", downloadAllCompleted);

  // ── Downloads + use as input (drawer + result) ──────────
  document.querySelectorAll<HTMLButtonElement>("[data-dl]").forEach(b => {
    b.onclick = () => { const j = jobs.find(j => j.id === b.dataset.dl); if (j?.outputBlob && j.outputName) downloadBlob(j.outputBlob, j.outputName); };
  });
  document.querySelectorAll<HTMLButtonElement>("[data-useinput]").forEach(b => {
    b.onclick = () => useJobAsInput(b.dataset.useinput!);
  });

  if (view === "home") {
    const gridWrap = document.getElementById("toolGridWrap")!;
    bindToolCards(gridWrap);
    const searchEl = document.getElementById("search") as HTMLInputElement;
    searchEl.oninput = () => {
      searchQuery = searchEl.value;
      gridWrap.innerHTML = renderToolGrid(getFilteredTools());
      bindToolCards(gridWrap);
    };
    const drawer = document.querySelector<HTMLElement>(".drawerBody"); if (drawer) drawer.scrollTop = prevDrawerScroll;
    window.scrollTo({ top: prevScrollY });
    return;
  }

  // ── Wizard bindings ─────────────────────────────────────
  document.getElementById("backToTools")!.onclick = goHome;
  document.querySelectorAll<HTMLButtonElement>(".step[data-step]").forEach(b => {
    b.onclick = () => { const s = Number(b.dataset.step) as 1 | 2 | 3; if (s < currentStep) goToStep(s); };
  });

  // File input (used by drop zone + pick + Ctrl+O)
  const input = document.createElement("input");
  input.type = "file";
  input.accept = isImg ? "image/jpeg,image/png,.jpg,.jpeg,.png" : "application/pdf,.pdf";
  input.multiple = isMulti;
  input.onchange = () => onFilesChosen(input.files);
  fileInputOpener = () => input.click();

  // Step 1
  document.getElementById("pick")?.addEventListener("click", () => input.click());
  document.getElementById("clear")?.addEventListener("click", clearFiles);
  document.getElementById("continueBtn")?.addEventListener("click", () => {
    if (!filesOk()) return;
    if (toolHasOptions(activeTool)) goToStep(2);
    else runJob();
  });

  const drop = document.getElementById("drop");
  if (drop) {
    drop.addEventListener("click", () => input.click());
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("dragover"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("dragover"); if (e.dataTransfer?.files) onFilesChosen(e.dataTransfer.files); });
  }

  // Step 2 / 3 navigation
  document.getElementById("backBtn")?.addEventListener("click", () => goToStep(1));
  document.getElementById("run")?.addEventListener("click", runJob);
  document.getElementById("cancel")?.addEventListener("click", cancelAllJobs);
  document.getElementById("tryAgainBtn")?.addEventListener("click", () => goToStep(toolHasOptions(activeTool) ? 2 : 1));
  document.getElementById("startOverBtn")?.addEventListener("click", () => { currentJobId = null; clearFiles(); goToStep(1); });

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
    syncRunBtn();
  };

  // ── PDF2img ─────────────────────────────────────────────
  document.querySelectorAll<HTMLButtonElement>("[data-imgfmt]").forEach(b => { b.onclick = () => { imgFormat = b.dataset.imgfmt as any; render(); }; });
  const dpiEl = document.getElementById("dpi") as HTMLInputElement | null;
  if (dpiEl) dpiEl.oninput = () => {
    imgDpi = Number(dpiEl.value) || 150;
    const v = validateDpiInput(imgDpi);
    const h = document.getElementById("dpiHint"); if (h) h.innerHTML = renderVH(v);
    dpiEl.className = `input${v?.type==="error"?" invalid":v?.type==="ok"?" valid":""}`;
    syncRunBtn();
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
    syncRunBtn();
  };

  // ── img2pdf ─────────────────────────────────────────────
  document.querySelectorAll<HTMLButtonElement>("[data-img2pdflayout]").forEach(b => { b.onclick = () => { img2pdfLayout = b.dataset.img2pdflayout as any; render(); }; });

  // ── Protect ─────────────────────────────────────────────
  document.querySelectorAll<HTMLButtonElement>("[data-protmode]").forEach(b => { b.onclick = () => { protectMode = b.dataset.protmode as any; render(); }; });
  const np = document.getElementById("newPwd") as HTMLInputElement | null;
  if (np) np.oninput = () => { protectNewPassword = np.value; const h = document.getElementById("pwdHint"); if (h) h.innerHTML = renderVH(validateProtectPassword(protectNewPassword, protectConfirmPassword)); syncRunBtn(); };
  const cp = document.getElementById("confirmPwd") as HTMLInputElement | null;
  if (cp) cp.oninput = () => { protectConfirmPassword = cp.value; const h = document.getElementById("pwdHint"); if (h) h.innerHTML = renderVH(validateProtectPassword(protectNewPassword, protectConfirmPassword)); syncRunBtn(); };

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
    syncRunBtn();
  };

  // ── Watermark ───────────────────────────────────────────
  const wmt = document.getElementById("wmText") as HTMLInputElement | null;
  if (wmt) wmt.oninput = () => { watermarkText = wmt.value; syncRunBtn(); };
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
    syncRunBtn();
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

  // ── Reorder thumbnail drag + interactions ───────────────
  const thumbGridEl = document.getElementById("thumbGridReorder");

  // Size slider — no full render needed
  const sizeSlider = document.getElementById("reorderSizeSlider") as HTMLInputElement | null;
  if (sizeSlider) {
    sizeSlider.oninput = () => {
      reorderThumbSize = Number(sizeSlider.value);
      if (thumbGridEl) (thumbGridEl as HTMLElement).style.setProperty("--reorder-thumb-size", `${reorderThumbSize}px`);
    };
  }

  // Click grid background to deselect all
  if (thumbGridEl) {
    thumbGridEl.addEventListener("click", (e) => {
      if ((e.target as Element).closest(".thumbCard")) return;
      reorderSelected = new Set();
      render();
    });
  }

  const thumbCards = document.querySelectorAll<HTMLDivElement>(".thumbCard[data-thumbidx]");

  // Helper: delete page by visual index
  function deleteReorderPage(idx: number) {
    reorderVisualOrder = reorderVisualOrder.filter((_, i) => i !== idx);
    reorderInput = reorderVisualOrder.join(",");
    // Fix selected indices — remove idx, shift down those above
    const newSel = new Set<number>();
    reorderSelected.forEach(i => { if (i < idx) newSel.add(i); else if (i > idx) newSel.add(i - 1); });
    reorderSelected = newSel;
    if (reorderLastSelectedIdx !== null) {
      if (reorderLastSelectedIdx === idx) reorderLastSelectedIdx = null;
      else if (reorderLastSelectedIdx > idx) reorderLastSelectedIdx--;
    }
    render();
  }

  // Helper: rotate page by visual index
  function rotateReorderPage(idx: number, delta: number) {
    const pageNum = reorderVisualOrder[idx];
    if (pageNum === undefined) return;
    const cur = reorderRotations[pageNum] ?? 0;
    reorderRotations[pageNum] = ((cur + delta) % 360 + 360) % 360;
    // Update img transform directly without full re-render
    const card = document.querySelector<HTMLDivElement>(`.thumbCard[data-thumbidx="${idx}"]`);
    const img = card?.querySelector<HTMLImageElement>(".thumbImg");
    if (img) img.style.transform = reorderRotations[pageNum] ? `rotate(${reorderRotations[pageNum]}deg)` : "";
  }

  thumbCards.forEach(card => {
    const idx = Number(card.dataset.thumbidx);

    // Drag
    card.ondragstart = (e) => { thumbDragIdx = idx; card.classList.add("dragging"); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; };
    card.ondragend = () => {
      thumbDragIdx = null; reorderDragOverIdx = null;
      card.classList.remove("dragging");
      render();
    };
    card.ondragover = (e) => {
      if (thumbDragIdx === null || thumbDragIdx === idx) return;
      e.preventDefault();
      if (reorderDragOverIdx !== idx) { reorderDragOverIdx = idx; render(); }
    };
    card.ondragleave = (e) => {
      if (!card.contains(e.relatedTarget as Node)) {
        if (reorderDragOverIdx === idx) { reorderDragOverIdx = null; render(); }
      }
    };
    card.ondrop = (e) => {
      e.preventDefault();
      const from = thumbDragIdx; thumbDragIdx = null; reorderDragOverIdx = null;
      if (from === null || from === idx) { render(); return; }
      const o = [...reorderVisualOrder]; const [m] = o.splice(from, 1); o.splice(idx, 0, m);
      reorderVisualOrder = o; reorderInput = o.join(",");
      render();
    };

    // Click to select (not on toolbar buttons)
    card.addEventListener("click", (e) => {
      if ((e.target as Element).closest(".thumbToolbarBtn")) return;
      if ((e as MouseEvent).shiftKey && reorderLastSelectedIdx !== null) {
        const lo = Math.min(reorderLastSelectedIdx, idx);
        const hi = Math.max(reorderLastSelectedIdx, idx);
        for (let i = lo; i <= hi; i++) reorderSelected.add(i);
      } else {
        if (reorderSelected.has(idx)) reorderSelected.delete(idx);
        else reorderSelected.add(idx);
        reorderLastSelectedIdx = idx;
      }
      render();
    });

    // Keyboard navigation
    card.addEventListener("keydown", (e) => {
      const allCards = Array.from(document.querySelectorAll<HTMLDivElement>(".thumbCard[data-thumbidx]"));
      const gridStyle = thumbGridEl ? getComputedStyle(thumbGridEl) : null;
      const cols = gridStyle ? Math.round(thumbGridEl!.clientWidth / (reorderThumbSize + 8)) : 1;
      const curIdx = Number(card.dataset.thumbidx);
      if (e.key === "ArrowRight") { const next = allCards.find(c => Number(c.dataset.thumbidx) === curIdx + 1); next?.focus(); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { const prev = allCards.find(c => Number(c.dataset.thumbidx) === curIdx - 1); prev?.focus(); e.preventDefault(); }
      else if (e.key === "ArrowDown") { const below = allCards.find(c => Number(c.dataset.thumbidx) === curIdx + cols); below?.focus(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { const above = allCards.find(c => Number(c.dataset.thumbidx) === curIdx - cols); above?.focus(); e.preventDefault(); }
      else if (e.key === "Delete" || e.key === "Backspace") { deleteReorderPage(curIdx); }
      else if (e.key === "r") { rotateReorderPage(curIdx, 90); }
      else if (e.key === "l") { rotateReorderPage(curIdx, -90); }
      else if (e.key === " ") { e.preventDefault(); if (reorderSelected.has(curIdx)) reorderSelected.delete(curIdx); else reorderSelected.add(curIdx); reorderLastSelectedIdx = curIdx; render(); }
    });
  });

  // Hover toolbar buttons
  document.querySelectorAll<HTMLButtonElement>("[data-rot-left]").forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); rotateReorderPage(Number(btn.dataset.rotLeft), -90); };
  });
  document.querySelectorAll<HTMLButtonElement>("[data-rot-right]").forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); rotateReorderPage(Number(btn.dataset.rotRight), 90); };
  });
  document.querySelectorAll<HTMLButtonElement>("[data-del-page]").forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); deleteReorderPage(Number(btn.dataset.delPage)); };
  });

  // Batch action bar
  document.querySelector<HTMLButtonElement>("[data-batch-rot-left]")?.addEventListener("click", () => {
    reorderSelected.forEach(idx => rotateReorderPage(idx, -90));
    // batch rotation updated img transforms directly in rotateReorderPage; but we need a render since cards may not exist
    render();
  });
  document.querySelector<HTMLButtonElement>("[data-batch-rot-right]")?.addEventListener("click", () => {
    reorderSelected.forEach(idx => rotateReorderPage(idx, 90));
    render();
  });
  document.querySelector<HTMLButtonElement>("[data-batch-delete]")?.addEventListener("click", () => {
    const indices = Array.from(reorderSelected).sort((a, b) => b - a); // delete from end
    indices.forEach(idx => {
      reorderVisualOrder = reorderVisualOrder.filter((_, i) => i !== idx);
    });
    reorderInput = reorderVisualOrder.join(",");
    reorderSelected = new Set();
    reorderLastSelectedIdx = null;
    render();
  });
  document.querySelector<HTMLButtonElement>("[data-batch-deselect]")?.addEventListener("click", () => {
    reorderSelected = new Set();
    render();
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
  const drawer = document.querySelector<HTMLElement>(".drawerBody"); if (drawer) drawer.scrollTop = prevDrawerScroll;
  window.scrollTo({ top: prevScrollY });
}

// ─── Keyboard shortcuts (one-time setup) ─────────────────
let fileInputOpener: (() => void) | null = null;

document.addEventListener("keydown", (e) => {
  const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as Element)?.tagName ?? "");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
    if (view === "tool" && currentStep === 1) { e.preventDefault(); fileInputOpener?.(); }
  }
  if (e.key === "Enter" && !inInput && view === "tool") {
    const btn = (document.getElementById("continueBtn") ?? document.getElementById("run")) as HTMLButtonElement | null;
    if (btn && !btn.disabled) btn.click();
  }
  if (e.key === "Escape" && !inInput) {
    if (historyOpen) { historyOpen = false; render(); return; }
    if (view !== "tool") return;
    if (currentStep === 3) goToStep(toolHasOptions(activeTool) ? 2 : 1);
    else if (currentStep === 2) goToStep(1);
    else if (files.length > 0) clearFiles();
    else goHome();
  }
  if (e.key.toLowerCase() === "t" && !inInput) toggleTheme();
});

// ─── Init ────────────────────────────────────────────────
document.documentElement.lang = getLang();
restoreFromURLHash();
loadJobsFromStorage();
render();
