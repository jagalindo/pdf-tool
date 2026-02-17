import "./styles.css";
import type { Job, ToolDef, ToolId } from "./types";
import type { WorkerEvent, WorkerRequest } from "./worker/messages";

type SelectedFile = { file: File; key: string; password: string };

const TOOLS: ToolDef[] = [
  { id: "merge", title: "Combinar PDFs", subtitle: "Une varios PDFs en uno solo", tags: ["PDF", "Offline", "Rápido"], accepts: "pdf", output: "pdf" },
  { id: "split", title: "Dividir PDF", subtitle: "Extrae páginas seleccionadas (ej: 1,3,5-7; 10-12)", tags: ["Páginas", "Offline", "ZIP"], accepts: "pdf", output: "pdf" },
  { id: "compress", title: "Comprimir PDF", subtitle: "Compresión decente vía qpdf-wasm", tags: ["WASM", "Offline"], accepts: "pdf", output: "pdf" },
  { id: "pdf2img", title: "PDF a Imagen", subtitle: "Renderiza páginas a PNG/JPG en ZIP (MuPDF WASM)", tags: ["WASM", "Offline", "ZIP"], accepts: "pdf", output: "zip" },
];

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
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
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

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
const WARN_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
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
let compressLevel: "small" | "balanced" | "best" = "balanced";
let splitPages = "1";
let splitOutput: "single" | "zip" = "single";
let imgFormat: "png" | "jpg" = "png";
let imgDpi = 150;

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
  // Check for invalid characters
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

function validateFiles(): ValidationResult {
  if (files.length === 0) return { type: "error", msg: "Agrega al menos un archivo PDF." };
  if (activeTool === "merge" && files.length < 2) return { type: "error", msg: "Combinar necesita al menos 2 PDFs." };
  if (activeTool === "merge" && files.length > MAX_MERGE_FILES) return { type: "error", msg: `Máximo ${MAX_MERGE_FILES} archivos para combinar.` };
  if (activeTool !== "merge" && files.length > 1) return { type: "warn", msg: "Solo se procesará el primer archivo." };

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
  // Files basic check
  if (files.length === 0) return false;
  if (activeTool === "merge" && files.length < 2) return false;
  if (activeTool === "merge" && files.length > MAX_MERGE_FILES) return false;
  if (files.some(f => f.file.size === 0)) return false;
  if (files.some(f => f.file.size > MAX_FILE_SIZE)) return false;

  // Job already running
  if (isJobRunning) return false;

  // Tool-specific
  if (activeTool === "split") {
    const v = validatePageInput(splitPages);
    if (v?.type === "error") return false;
  }
  if (activeTool === "pdf2img") {
    const raw = imgDpi;
    if (!Number.isFinite(raw) || raw < 36 || raw > 600) return false;
  }
  return true;
}

function renderValidationHint(v: ValidationResult): string {
  if (!v) return "";
  const cls = v.type === "error" ? "validationHint" : v.type === "warn" ? "validationHint warn" : "validationHint ok";
  const icon = v.type === "error" ? "\u2718" : v.type === "warn" ? "\u26A0" : "\u2714";
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

// --- Job execution ---
async function runJob() {
  if (isJobRunning) return;

  // File validations
  const fileVal = validateFiles();
  if (fileVal?.type === "error") return alert(fileVal.msg);

  // Tool-specific validations
  if (activeTool === "split") {
    const pageVal = validatePageInput(splitPages);
    if (pageVal?.type === "error") return alert(pageVal.msg);
  }

  if (activeTool === "pdf2img") {
    const dpiVal = validateDpiInput(imgDpi);
    if (dpiVal?.type === "error") {
      imgDpi = clampDpi(imgDpi);
      render();
      return alert(dpiVal.msg);
    }
    imgDpi = clampDpi(imgDpi);
  }

  isJobRunning = true;
  const jobId = uid();
  const tool = TOOLS.find(t => t.id === activeTool)!;

  const job: Job = {
    id: jobId,
    toolId: activeTool,
    toolTitle: tool.title,
    createdAt: Date.now(),
    status: "queued",
    progress: 0,
    inputCount: files.length,
    inputSize: totalInputSize(),
  };
  jobs = [job, ...jobs];
  render();

  try {
    if (activeTool === "merge") {
      const payload = await Promise.all(
        files.map(async (f) => ({
          name: f.file.name,
          bytes: await readFileBytes(f.file),
          password: f.password?.trim() || undefined,
        }))
      );
      const req: WorkerRequest = { type: "merge", jobId, files: payload };
      worker.postMessage(req, payload.map(p => p.bytes));
      return;
    }
    if (activeTool === "split") {
      const { flat, groups } = parsePageGroups(splitPages);
      const f = files[0];
      const req: WorkerRequest = {
        type: "split",
        jobId,
        file: { name: f.file.name, bytes: await readFileBytes(f.file), password: f.password?.trim() || undefined },
        pages: flat,
        ranges: groups.length ? groups : [flat],
        output: splitOutput,
      };
      worker.postMessage(req, [(req as any).file.bytes]);
      return;
    }
    if (activeTool === "compress") {
      const f = files[0];
      const req: WorkerRequest = { type: "compress", jobId, file: { name: f.file.name, bytes: await readFileBytes(f.file), password: f.password?.trim() || undefined }, level: compressLevel };
      worker.postMessage(req, [(req as any).file.bytes]);
      return;
    }
    if (activeTool === "pdf2img") {
      const f = files[0];
      const req: WorkerRequest = { type: "pdf2img", jobId, file: { name: f.file.name, bytes: await readFileBytes(f.file), password: f.password?.trim() || undefined }, format: imgFormat, dpi: imgDpi };
      worker.postMessage(req, [(req as any).file.bytes]);
      return;
    }
  } catch (e: any) {
    isJobRunning = false;
    jobs = jobs.map(j => j.id === jobId ? { ...j, status: "error", error: e?.message ?? String(e) } : j);
    render();
  }
}

function setActiveTool(next: ToolId) {
  activeTool = next;
  files = [];
  render();
}

function onFilesChosen(list: FileList | null) {
  if (!list) return;
  const all = Array.from(list);
  const pdfs = all.filter(f => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  const rejected = all.length - pdfs.length;
  if (rejected > 0) alert(`${rejected} archivo(s) ignorado(s): solo se aceptan PDFs.`);

  const emptyFiles = pdfs.filter(f => f.size === 0);
  if (emptyFiles.length > 0) {
    alert(`"${emptyFiles[0].name}" está vacío (0 bytes) y fue ignorado.`);
  }
  const validPdfs = pdfs.filter(f => f.size > 0);

  const tooLarge = validPdfs.filter(f => f.size > MAX_FILE_SIZE);
  if (tooLarge.length > 0) {
    alert(`"${tooLarge[0].name}" excede el límite de ${prettyBytes(MAX_FILE_SIZE)} y fue ignorado.`);
  }
  const accepted = validPdfs.filter(f => f.size <= MAX_FILE_SIZE);

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
    default: return level;
  }
}

// --- Render ---
function render() {
  const tool = TOOLS.find(t => t.id === activeTool)!;
  const filteredTools = getFilteredTools();
  const themeIcon = currentTheme === "light" ? "\u{1F319}" : "\u{2600}\u{FE0F}";
  const needsMultipleFiles = activeTool === "merge";
  const runEnabled = canRun();
  const fileValidation = files.length > 0 ? validateFiles() : null;
  const pageValidation = activeTool === "split" ? validatePageInput(splitPages) : null;
  const dpiValidation = activeTool === "pdf2img" ? validateDpiInput(imgDpi) : null;

  app.innerHTML = `
    <div class="topbar">
      <div class="container row">
        <div class="brand">
          <div class="logo">\u{1F4C4}</div>
          <div>
            <div class="h1">PDF Toolkit</div>
            <div class="p">100% en tu navegador \u2022 Vite + WASM + Workers</div>
          </div>
        </div>
        <div style="display:flex; gap:10px; align-items:center; width:420px; max-width:50vw;">
          <input id="search" class="input" placeholder="Buscar herramientas\u2026" value="${escapeAttr(searchQuery)}" />
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
                <button class="btn primary" id="run" ${runEnabled ? "" : "disabled"}>${isJobRunning ? "Procesando\u2026" : "Ejecutar"}</button>
              </div>
            </div>

            <div class="split"></div>

            <div class="drop" id="drop">
              <div>
                <div style="font-weight:700">Arrastra PDFs aqu\u00ED</div>
                <div class="small">o haz clic en Subir</div>
              </div>
            </div>

            <div class="files" id="files">
              ${needsMultipleFiles && files.length > 1 ? `<div class="small" style="margin-bottom:2px;">Arrastra los nombres para reordenar antes de combinar.</div>` : ""}
              ${files.length === 0 ? `<div class="small">Sin archivos seleccionados.</div>` : files.map((f, idx) => `
                <div class="fileRow" data-idx="${idx}">
                  ${needsMultipleFiles && files.length > 1 ? `<div class="dragHandle" title="Arrastra para reordenar" aria-hidden="true">\u2195</div>` : ""}
                  <div class="icon">\u{1F4C4}</div>
                  <div class="fileInfo">
                    <div class="fileName">${escapeAttr(f.file.name)}</div>
                    <div class="fileMeta">${prettyBytes(f.file.size)}</div>
                  </div>
                  <div class="filePassword">
                    <input class="input" data-pass="${idx}" value="${escapeAttr(f.password ?? "")}" placeholder="Contrase\u00F1a (si protegido)" autocomplete="off" />
                    <div class="small">Solo en tu navegador.</div>
                  </div>
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

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px;">
                  ${activeTool === "compress" ? `
                    <div>
                      <div class="kv">Nivel de compresi\u00F3n</div>
                      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
                        ${(["small", "balanced", "best"] as const).map(l => `<button class="btn ${compressLevel === l ? "primary" : ""}" data-cmpr="${l}">${compressionLabel(l)}</button>`).join("")}
                      </div>
                      <div class="small" style="margin-top:6px;">${compressLevel === "small" ? "Reescritura r\u00E1pida sin recompresi\u00F3n." : compressLevel === "balanced" ? "Recompresi\u00F3n est\u00E1ndar con flate." : "Recompresi\u00F3n agresiva + linearizaci\u00F3n."}</div>
                    </div>
                  ` : ""}

                  ${activeTool === "split" ? `
                    <div>
                      <div class="kv">P\u00E1ginas</div>
                      <input id="pages" class="input ${pageValidation?.type === "error" ? "invalid" : pageValidation?.type === "ok" ? "valid" : ""}" value="${escapeAttr(splitPages)}" placeholder="ej: 1,2,5-7; 10-12" style="margin-top:6px;" />
                      ${renderValidationHint(pageValidation)}
                      <div class="small" style="margin-top:4px;">Formato: 1,3,5-7 (p\u00E1ginas 1-based). Separa rangos con ; para m\u00FAltiples PDFs en ZIP.</div>
                      <div class="kv" style="margin-top:12px;">Salida</div>
                      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
                        ${(["single", "zip"] as const).map(mode => `<button class="btn ${splitOutput === mode ? "primary" : ""}" data-splitout="${mode}">${mode === "single" ? "PDF \u00FAnico" : "ZIP (un PDF por rango)"}</button>`).join("")}
                      </div>
                    </div>
                  ` : ""}

                  ${activeTool === "pdf2img" ? `
                    <div>
                      <div class="kv">Formato</div>
                      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
                        ${(["png", "jpg"] as const).map(f => `<button class="btn ${imgFormat === f ? "primary" : ""}" data-imgfmt="${f}">${f.toUpperCase()}</button>`).join("")}
                      </div>
                      <div class="kv" style="margin-top:10px;">DPI (36\u2013600)</div>
                      <input id="dpi" type="number" min="36" max="600" class="input ${dpiValidation?.type === "error" ? "invalid" : dpiValidation?.type === "ok" ? "valid" : ""}" value="${imgDpi}" style="margin-top:6px;" />
                      ${renderValidationHint(dpiValidation)}
                      <div class="small" style="margin-top:4px;">Genera un ZIP con todas las p\u00E1ginas como ${imgFormat.toUpperCase()}. Mayor DPI = mayor calidad y tama\u00F1o.</div>
                    </div>
                  ` : ""}
                </div>
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
              ${jobs.length === 0 ? `<div class="small">Sin trabajos a\u00FAn.</div>` : jobs.map(j => {
                const outputSize = j.outputBlob?.size;
                const sizeInfo = j.inputSize ? `Entrada: ${prettyBytes(j.inputSize)}` : "";
                const outputInfo = outputSize ? ` \u2192 Salida: ${prettyBytes(outputSize)}` : "";
                const reduction = (j.inputSize && outputSize && j.toolId === "compress" && outputSize < j.inputSize)
                  ? ` (\u2193${Math.round((1 - outputSize / j.inputSize) * 100)}%)`
                  : "";
                return `
                <div class="jobRow">
                  <div class="row">
                    <div style="min-width:0">
                      <div style="font-weight:700; font-size: 13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${j.toolTitle}</div>
                      <div class="kv">${new Date(j.createdAt).toLocaleString()} \u2022 ${j.inputCount} archivo(s)</div>
                      ${sizeInfo ? `<div class="jobSize">${sizeInfo}${outputInfo}${reduction ? `<span class="reduction">${reduction}</span>` : ""}</div>` : ""}
                    </div>
                    <div>
                      <span class="badge ${j.status === "done" ? "primary" : ""}">${statusLabel(j.status)}</span>
                    </div>
                  </div>
                  <div style="margin-top:10px;">
                    <div class="progressBar"><div class="progressFill" style="width:${j.progress}%"></div></div>
                    <div class="kv" style="margin-top:6px;">${j.progress}%${j.progressNote ? ` \u2013 ${escapeAttr(j.progressNote)}` : ""}</div>
                  </div>
                  ${j.error ? `<div class="err">${escapeAttr(j.error)}</div>` : ""}
                  ${j.status === "done" && j.outputBlob && j.outputName ? `
                    <div class="successMsg">Proceso completado exitosamente.</div>
                    <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
                      <button class="btn primary" data-dl="${j.id}">Descargar ${escapeAttr(j.outputName)}</button>
                    </div>
                  ` : ""}
                </div>
              `;
              }).join("")}
            </div>
          </div>
        </div>

        <div class="small" style="text-align:center;">
          Todos los archivos se procesan localmente en tu navegador. Nada se sube a ning\u00FAn servidor.
        </div>
      </div>
    </div>
  `;

  // tools list
  const toolsEl = document.getElementById("tools")!;
  toolsEl.innerHTML = filteredTools.length === 0
    ? `<div class="small" style="padding:10px;">No se encontraron herramientas.</div>`
    : filteredTools.map(t => `
    <button class="toolBtn" data-tool="${t.id}">
      <div style="font-weight:750; font-size: 13px;">${t.title} ${t.id === activeTool ? `<span class="badge primary" style="margin-left:6px;">Activa</span>` : ""}</div>
      <div class="p">${t.subtitle}</div>
      <div class="badges">${t.tags.map(x => `<span class="badge">${x}</span>`).join("")}</div>
    </button>
  `).join("");

  // --- Event handlers ---
  toolsEl.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(btn => {
    btn.onclick = () => setActiveTool(btn.dataset.tool as ToolId);
  });

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,.pdf";
  input.multiple = activeTool === "merge";
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
    // Re-render tools list only
    const toolsContainer = document.getElementById("tools")!;
    const filtered = getFilteredTools();
    toolsContainer.innerHTML = filtered.length === 0
      ? `<div class="small" style="padding:10px;">No se encontraron herramientas.</div>`
      : filtered.map(t => `
        <button class="toolBtn" data-tool="${t.id}">
          <div style="font-weight:750; font-size: 13px;">${t.title} ${t.id === activeTool ? `<span class="badge primary" style="margin-left:6px;">Activa</span>` : ""}</div>
          <div class="p">${t.subtitle}</div>
          <div class="badges">${t.tags.map(x => `<span class="badge">${x}</span>`).join("")}</div>
        </button>
      `).join("");
    toolsContainer.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(btn => {
      btn.onclick = () => setActiveTool(btn.dataset.tool as ToolId);
    });
  };

  document.querySelectorAll<HTMLButtonElement>("[data-rm]").forEach(b => {
    b.onclick = () => removeFile(Number(b.dataset.rm));
  });

  // options
  document.querySelectorAll<HTMLButtonElement>("[data-cmpr]").forEach(b => {
    b.onclick = () => { compressLevel = b.dataset.cmpr as any; render(); };
  });
  document.querySelectorAll<HTMLButtonElement>("[data-imgfmt]").forEach(b => {
    b.onclick = () => { imgFormat = b.dataset.imgfmt as any; render(); };
  });
  document.querySelectorAll<HTMLButtonElement>("[data-splitout]").forEach(b => {
    b.onclick = () => { splitOutput = b.dataset.splitout as any; render(); };
  });
  const pages = document.getElementById("pages") as HTMLInputElement | null;
  if (pages) pages.oninput = () => {
    splitPages = pages.value;
    render();
  };

  const dpi = document.getElementById("dpi") as HTMLInputElement | null;
  if (dpi) dpi.oninput = () => {
    const raw = Number(dpi.value);
    imgDpi = Number.isFinite(raw) ? raw : 150;
    render();
  };

  document.querySelectorAll<HTMLInputElement>("[data-pass]").forEach(inp => {
    inp.oninput = () => {
      const idx = Number(inp.dataset.pass);
      if (Number.isFinite(idx) && files[idx]) files[idx] = { ...files[idx], password: inp.value };
    };
  });

  // drag and drop zone
  const drop = document.getElementById("drop")!;
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("dragover");
  });
  drop.addEventListener("dragleave", () => {
    drop.classList.remove("dragover");
  });
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("dragover");
    const dt = e.dataTransfer;
    if (!dt?.files) return;
    onFilesChosen(dt.files);
  });

  // downloads
  document.querySelectorAll<HTMLButtonElement>("[data-dl]").forEach(b => {
    b.onclick = () => {
      const job = jobs.find(j => j.id === b.dataset.dl);
      if (job?.outputBlob && job.outputName) downloadBlob(job.outputBlob, job.outputName);
    };
  });

  // reordering files (merge)
  const rows = document.querySelectorAll<HTMLDivElement>(".fileRow[data-idx]");
  rows.forEach(row => {
    const idx = Number(row.dataset.idx);
    const canReorder = activeTool === "merge" && files.length > 1;
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
      const to = idx;
      draggingIdx = null;
      if (Number.isFinite(from)) moveFile(Number(from), to);
      render();
    };
  });
}

render();
