// downloadJob.ts
import { randomUUID } from "node:crypto";

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface DownloadJob {
  jobId: string;
  fileIds: number[];
  status: JobStatus;
  result?: Record<number, { available: boolean; downloadUrl?: string }>;
}

// In-memory storage
export const jobs = new Map<string, DownloadJob>();

// Create a new job
export const createJob = (fileIds: number[]): DownloadJob => {
  const jobId = randomUUID();
  const job: DownloadJob = {
    jobId,
    fileIds,
    status: "queued",
  };
  jobs.set(jobId, job);

  // Start background processing (non-blocking)
  void processJob(job);

  return job;
};

// Mock async job processing
const processJob = async (job: DownloadJob): Promise<void> => {
  job.status = "processing";

  for (const fileId of job.fileIds) {
    const delay = Math.floor(Math.random() * 5000) + 1000; // 1-6s
    await new Promise((res) => setTimeout(res, delay));

    job.result ??= {};
    const token = randomUUID();
    job.result[fileId] = {
      available: Math.random() > 0.3, // 70% chance available
      downloadUrl: `https://storage.example.com/downloads/${String(fileId)}.zip?token=${token}`,
    };
  }

  job.status = "completed";
};
