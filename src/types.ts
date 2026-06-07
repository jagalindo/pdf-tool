export type ToolId =
  | "merge"
  | "split"
  | "compress"
  | "pdf2img"
  | "rotate"
  | "img2pdf"
  | "protect"
  | "deletepages"
  | "watermark"
  | "pagenumbers"
  | "metadata"
  | "extracttext"
  | "crop"
  | "reorder";

export type ToolDef = {
  id: ToolId;
  title: string;
  subtitle: string;
  tags: string[];
  accepts: "pdf" | "image";
  output: "pdf" | "zip" | "txt";
};

export type JobStatus = "queued" | "running" | "done" | "error";

export type Job = {
  id: string;
  toolId: ToolId;
  toolTitle: string;
  createdAt: number;
  status: JobStatus;
  progress: number;
  progressNote?: string;
  inputCount: number;
  inputSize?: number;
  outputName?: string;
  outputBlob?: Blob;
  error?: string;
};
