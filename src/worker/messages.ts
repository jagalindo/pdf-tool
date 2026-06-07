import type { ToolId } from "../types";

export type WorkerRequest =
  | { type: "merge"; jobId: string; files: Array<{ name: string; bytes: ArrayBuffer; password?: string }> }
  | { type: "split"; jobId: string; file: { name: string; bytes: ArrayBuffer; password?: string }; pages: number[]; ranges: number[][]; output: "single" | "zip" }
  | { type: "compress"; jobId: string; file: { name: string; bytes: ArrayBuffer; password?: string }; level: "small" | "balanced" | "best" | "aggressive" }
  | { type: "pdf2img"; jobId: string; file: { name: string; bytes: ArrayBuffer; password?: string }; format: "png" | "jpg"; dpi: number }
  | { type: "rotate"; jobId: string; file: { name: string; bytes: ArrayBuffer; password?: string }; angle: 90 | 180 | 270; target: "all" | "range"; pages: number[] }
  | { type: "img2pdf"; jobId: string; files: Array<{ name: string; bytes: ArrayBuffer }>; layout: "auto" | "a4" | "letter" }
  | { type: "protect"; jobId: string; file: { name: string; bytes: ArrayBuffer; password?: string }; mode: "add" | "remove"; newPassword?: string }
  | { type: "deletepages"; jobId: string; file: { name: string; bytes: ArrayBuffer; password?: string }; pages: number[] }
  | { type: "watermark"; jobId: string; file: { name: string; bytes: ArrayBuffer; password?: string }; text: string; opacity: number; angle: number; size: number; color: string }
  | { type: "pagenumbers"; jobId: string; file: { name: string; bytes: ArrayBuffer; password?: string }; position: "bottom-center" | "bottom-right" | "bottom-left"; start: number; prefix: string; fontSize: number }
  | { type: "metadata"; jobId: string; file: { name: string; bytes: ArrayBuffer; password?: string }; title: string; author: string; subject: string; keywords: string; creator: string }
  | { type: "extracttext"; jobId: string; file: { name: string; bytes: ArrayBuffer; password?: string } }
  | { type: "crop"; jobId: string; file: { name: string; bytes: ArrayBuffer; password?: string }; top: number; right: number; bottom: number; left: number; unit: "mm" | "pt" }
  | { type: "reorder"; jobId: string; file: { name: string; bytes: ArrayBuffer; password?: string }; order: number[] };

export type WorkerEvent =
  | { type: "progress"; jobId: string; progress: number; note?: string }
  | { type: "result"; jobId: string; outputName: string; outputBytes: ArrayBuffer; mime: string }
  | { type: "error"; jobId: string; message: string };

export function postProgress(jobId: string, progress: number, note?: string) {
  const msg: WorkerEvent = { type: "progress", jobId, progress, note };
  postMessage(msg);
}

export function postError(jobId: string, message: string) {
  const msg: WorkerEvent = { type: "error", jobId, message };
  postMessage(msg);
}

export function postResult(jobId: string, outputName: string, outputBytes: ArrayBuffer, mime: string) {
  const msg: WorkerEvent = { type: "result", jobId, outputName, outputBytes, mime };
  (self as unknown as Worker).postMessage(msg, [outputBytes]);
}

// Silence unused import warning — ToolId is re-exported for downstream consumers.
export type { ToolId };
