import type { ToolId } from "../types";

export type WorkerRequest =
  | { type: "merge"; jobId: string; files: Array<{ name: string; bytes: ArrayBuffer; password?: string }> }
  | { type: "split"; jobId: string; file: { name: string; bytes: ArrayBuffer; password?: string }; pages: number[]; ranges: number[][]; output: "single" | "zip" }
  | { type: "compress"; jobId: string; file: { name: string; bytes: ArrayBuffer; password?: string }; level: "small" | "balanced" | "best" }
  | { type: "pdf2img"; jobId: string; file: { name: string; bytes: ArrayBuffer; password?: string }; format: "png" | "jpg"; dpi: number };

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
  postMessage(msg, [outputBytes]);
}
