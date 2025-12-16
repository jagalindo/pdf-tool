import "./styles.css";
import type { Job, ToolDef, ToolId } from "./types";
import type { WorkerEvent, WorkerRequest } from "./worker/messages";

const TOOLS: ToolDef[] = [
  { id: "merge", title: "Merge PDFs", subtitle: "Combine multiple PDFs into one", tags: ["PDF", "Offline", "Fast"], accepts: "pdf", output: "pdf" },
  { id: "split", title: "Split PDF", subtitle: "Extract selected pages (usa 1,3,5-7; salida PDF único o ZIP)", tags: ["Pages", "Offline", "ZIP"], accepts: "pdf", output: "pdf" },
  { id: "compress", title: "Compress PDF", subtitle: "Decent compression (qpdf-wasm rewrite)", tags: ["WASM", "Offline"], accepts: "pdf", output: "pdf" },
  { id: "pdf2img", title: "PDF → Image", subtitle: "Render all pages to PNG/JPG ZIP (MuPDF WASM)", tags: ["WASM", "Offline", "ZIP"], accepts: "pdf", output: "zip" },
];

const app = document.querySelector<HTMLDivElement>("#app")!;

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

// Worker
const worker = new Worker(new URL("./worker/engine.worker.ts", import.meta.url), { type: "module" });

// State
let activeTool: ToolId = "merge";
let files: File[] = [];
let jobs: Job[] = [];
let draggingIdx: number | null = null;

let compressLevel: "small"|"balanced"|"best" = "balanced";
let splitPages = "1";
let splitOutput: "single" | "zip" = "single";
let imgFormat: "png"|"jpg" = "png";
let imgDpi = 150;

worker.onmessage = (ev: MessageEvent<WorkerEvent>) => {
  const msg = ev.data;
  if (msg.type === "progress") {
    jobs = jobs.map(j => j.id === msg.jobId ? { ...j, status:"running", progress: msg.progress } : j);
    render();
  } else if (msg.type === "result") {
    const blob = new Blob([msg.outputBytes], { type: msg.mime });
    jobs = jobs.map(j => j.id === msg.jobId ? { ...j, status:"done", progress: 100, outputName: msg.outputName, outputBlob: blob } : j);
    render();
  } else if (msg.type === "error") {
    jobs = jobs.map(j => j.id === msg.jobId ? { ...j, status:"error", error: msg.message } : j);
    render();
  }
};

function parsePageList(input: string): number[] {
  const out: number[] = [];
  for (const part of input.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^([0-9]+)\s*-\s*([0-9]+)$/);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      const lo = Math.min(a,b), hi = Math.max(a,b);
      for (let x=lo; x<=hi; x++) out.push(x);
    } else {
      const n = Number(p);
      if (Number.isFinite(n) && n>0) out.push(n);
    }
  }
  return Array.from(new Set(out)).sort((a,b)=>a-b);
}

function parsePageGroups(input: string): { flat: number[]; groups: number[][] } {
  const groups: number[][] = [];
  for (const chunk of input.split(/;|\n/)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const list = parsePageList(trimmed);
    if (list.length) groups.push(list);
  }
  const flat = Array.from(new Set(groups.flat())).sort((a,b)=>a-b);
  return { flat, groups };
}

async function readFileBytes(f: File): Promise<ArrayBuffer> {
  return await f.arrayBuffer();
}

async function runJob() {
  if (files.length === 0) return alert("Add PDFs first.");

  if (activeTool === "merge" && files.length < 2) return alert("Merge needs at least 2 PDFs.");

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
  };
  jobs = [job, ...jobs];
  render();

  try {
    if (activeTool === "merge") {
      const payload = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: await readFileBytes(f) })));
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
        file: { name: f.name, bytes: await readFileBytes(f) },
        pages: flat,
        ranges: groups.length ? groups : [flat],
        output: splitOutput,
      };
      worker.postMessage(req, [ (req as any).file.bytes ]);
      return;
    }
    if (activeTool === "compress") {
      const f = files[0];
      const req: WorkerRequest = { type: "compress", jobId, file: { name: f.name, bytes: await readFileBytes(f) }, level: compressLevel };
      worker.postMessage(req, [ (req as any).file.bytes ]);
      return;
    }
    if (activeTool === "pdf2img") {
      const f = files[0];
      const req: WorkerRequest = { type: "pdf2img", jobId, file: { name: f.name, bytes: await readFileBytes(f) }, format: imgFormat, dpi: imgDpi };
      worker.postMessage(req, [ (req as any).file.bytes ]);
      return;
    }
  } catch (e:any) {
    jobs = jobs.map(j => j.id === jobId ? { ...j, status:"error", error: e?.message ?? String(e) } : j);
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
  const next = Array.from(list).filter(f => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (next.length !== list.length) alert("Only PDFs are accepted in this demo.");
  const map = new Map(files.map(f => [`${f.name}:${f.size}`, f]));
  for (const f of next) map.set(`${f.name}:${f.size}`, f);
  files = Array.from(map.values());
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

function render() {
  const tool = TOOLS.find(t => t.id === activeTool)!;

  app.innerHTML = `
    <div class="topbar">
      <div class="container row">
        <div class="brand">
          <div class="logo">📄</div>
          <div>
            <div class="h1">PDF Toolkit</div>
            <div class="p">100% client-side • Vite + WASM + Workers</div>
          </div>
        </div>
        <div style="display:flex; gap:10px; align-items:center; width:420px; max-width:50vw;">
          <input id="search" class="input" placeholder="Search tools…" />
        </div>
      </div>
    </div>

    <div class="container grid">
      <div class="card">
        <div class="cardHeader"><div class="h1">Tools</div></div>
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
                  <span class="badge primary">Privacy mode</span>
                </div>
              </div>
              <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                <button class="btn" id="pick">Upload</button>
                <button class="btn" id="clear" ${files.length ? "" : "disabled"}>Clear</button>
                <button class="btn primary" id="run">Run</button>
              </div>
            </div>

            <div class="split"></div>

            <div class="drop" id="drop">
              <div>
                <div style="font-weight:700">Drop PDFs here</div>
                <div class="small">or click Upload</div>
              </div>
            </div>

            <div class="files" id="files">
              ${activeTool === "merge" && files.length > 1 ? `<div class="small" style="margin-bottom:2px;">Arrastra los nombres para reordenar antes de combinar.</div>` : ""}
              ${files.length === 0 ? `<div class="small">No files selected.</div>` : files.map((f, idx) => `
                <div class="fileRow" data-idx="${idx}">
                  ${activeTool === "merge" && files.length > 1 ? `<div class="dragHandle" title="Drag to reorder" aria-hidden="true">↕</div>` : ""}
                  <div class="icon">📄</div>
                  <div class="fileInfo">
                    <div class="fileName">${f.name}</div>
                    <div class="fileMeta">${prettyBytes(f.size)}</div>
                  </div>
                  <button class="btn" data-rm="${idx}">Remove</button>
                </div>
              `).join("")}
            </div>

            <div class="split"></div>

            <div class="card" style="box-shadow:none;">
              <div class="cardBody" style="padding:0;">
                <div class="h1">Options</div>
                <div class="p">All processing happens in a Web Worker (no upload).</div>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px;">
                  ${activeTool === "compress" ? `
                    <div>
                      <div class="kv">Compression</div>
                      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
                        ${(["small","balanced","best"] as const).map(l => `<button class="btn ${compressLevel===l ? "primary":""}" data-cmpr="${l}">${l}</button>`).join("")}
                      </div>
                      <div class="small" style="margin-top:6px;">Uses qpdf-wasm rewrite (not Ghostscript-level but decent).</div>
                    </div>
                  ` : ""}

                  ${activeTool === "split" ? `
                    <div>
                      <div class="kv">Pages</div>
                      <input id="pages" class="input" value="${splitPages}" placeholder="e.g. 1,2,5-7; 10-12" style="margin-top:6px;" />
                      <div class="small" style="margin-top:6px;">Formato: 1,3,5-7 (páginas son 1-based). Separa rangos con ; para múltiples PDFs en ZIP.</div>
                      <div class="kv" style="margin-top:12px;">Salida</div>
                      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
                        ${(["single","zip"] as const).map(mode => `<button class="btn ${splitOutput===mode ? "primary":""}" data-splitout="${mode}">${mode==="single" ? "PDF único" : "ZIP (un PDF por rango/página)"}</button>`).join("")}
                      </div>
                      <div class="small" style="margin-top:6px;">ZIP crea un PDF por página o por rango (ej: 1-3;10-12) dentro de un .zip.</div>
                    </div>
                  ` : ""}

                  ${activeTool === "pdf2img" ? `
                    <div>
                      <div class="kv">Format</div>
                      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
                        ${(["png","jpg"] as const).map(f => `<button class="btn ${imgFormat===f ? "primary":""}" data-imgfmt="${f}">${f.toUpperCase()}</button>`).join("")}
                      </div>
                      <div class="kv" style="margin-top:10px;">DPI</div>
                      <input id="dpi" class="input" value="${imgDpi}" style="margin-top:6px;" />
                      <div class="small" style="margin-top:6px;">Outputs a ZIP with all pages as ${imgFormat.toUpperCase()}.</div>
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
              <div class="h1">History</div>
              <button class="btn" id="clearJobs" ${jobs.length ? "" : "disabled"}>Clear</button>
            </div>
          </div>
          <div class="cardBody">
            <div class="jobs" id="jobs">
              ${jobs.length === 0 ? `<div class="small">No jobs yet.</div>` : jobs.map(j => `
                <div class="jobRow">
                  <div class="row">
                    <div style="min-width:0">
                      <div style="font-weight:700; font-size: 13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${j.toolTitle}</div>
                      <div class="kv">${new Date(j.createdAt).toLocaleString()} • ${j.inputCount} input(s)</div>
                    </div>
                    <div>
                      <span class="badge ${j.status==="done" ? "primary" : ""}">${j.status}</span>
                    </div>
                  </div>
                  <div style="margin-top:10px;">
                    <div class="progressBar"><div class="progressFill" style="width:${j.progress}%"></div></div>
                    <div class="kv" style="margin-top:6px;">${j.progress}%</div>
                  </div>
                  ${j.error ? `<div class="err">${j.error}</div>` : ""}
                  ${j.outputBlob && j.outputName ? `
                    <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
                      <button class="btn primary" data-dl="${j.id}">Download ${j.outputName}</button>
                    </div>
                  ` : ""}
                </div>
              `).join("")}
            </div>
          </div>
        </div>

        <div class="small" style="text-align:center;">
          Tip: for huge PDFs, add OPFS + streaming later. This demo keeps it simple.
        </div>
      </div>
    </div>
  `;

  // tools list
  const toolsEl = document.getElementById("tools")!;
  toolsEl.innerHTML = TOOLS.map(t => `
    <button class="toolBtn" data-tool="${t.id}">
      <div style="font-weight:750; font-size: 13px;">${t.title} ${t.id===activeTool ? `<span class="badge primary" style="margin-left:6px;">Selected</span>` : ""}</div>
      <div class="p">${t.subtitle}</div>
      <div class="badges">${t.tags.map(x=>`<span class="badge">${x}</span>`).join("")}</div>
    </button>
  `).join("");

  // handlers
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
  if (pages) pages.oninput = () => { splitPages = pages.value; };

  const dpi = document.getElementById("dpi") as HTMLInputElement | null;
  if (dpi) dpi.oninput = () => { imgDpi = Number(dpi.value) || 150; };

  // drag and drop
  const drop = document.getElementById("drop")!;
  drop.addEventListener("dragover", (e) => { e.preventDefault(); });
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
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
