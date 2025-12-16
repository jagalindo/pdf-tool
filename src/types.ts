export type ToolId = "merge" | "split" | "compress" | "pdf2img";

export type ToolDef = {
  id: ToolId;
  title: string;
  subtitle: string;
  tags: string[];
  accepts: "pdf";
  output: "pdf" | "zip";
};

export type JobStatus = "queued" | "running" | "done" | "error";

export type Job = {
  id: string;
  toolId: ToolId;
  toolTitle: string;
  createdAt: number;
  status: JobStatus;
  progress: number;
  inputCount: number;
  outputName?: string;
  outputBlob?: Blob;
  error?: string;
};
