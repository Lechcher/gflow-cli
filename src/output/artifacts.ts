import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ArtifactPlanInput {
  outDir: string;
  jobId: string;
  index: number;
  extension: string;
}

export interface ArtifactPlan {
  assetPath: string;
  metadataPath: string;
}

export interface ArtifactMetadata {
  jobId: string;
  type: "image" | "video" | "music";
  prompt: string;
  project?: string;
  model?: string;
  ratio?: string;
  duration?: number;
  requestedOutputs: number;
  quality?: "original" | "2k" | "4k";
  characters?: string[];
  /** Style/sound description requested for a music job (as sent to the Producer chat). */
  style?: string;
  /** Lyrics requested for a music job (as sent to the Producer chat). */
  lyrics?: string;
  /** Whether an instrumental (no vocals) song was requested. */
  instrumental?: boolean;
  /** Media attached to the chat turn for this run, as requested (paths and names). */
  attachments?: {
    photos: string[];
    videos: string[];
    fromProject: string[];
  };
  downloadedAt: string;
  source: "google-flow-browser" | "google-flow-music-browser";
  flowUrl: string;
  status: "downloaded";
}

export function artifactBasename(jobId: string, index: number): string {
  return `${jobId}-${String(index).padStart(3, "0")}`;
}

export function createArtifactPlan(input: ArtifactPlanInput): ArtifactPlan {
  const cleanExtension = input.extension.startsWith(".") ? input.extension : `.${input.extension}`;
  // Files are written directly into outDir; the job-id prefix keeps them unique across jobs.
  const basename = artifactBasename(input.jobId, input.index);

  return {
    assetPath: join(input.outDir, `${basename}${cleanExtension}`),
    metadataPath: join(input.outDir, `${basename}.json`)
  };
}

export async function writeArtifactMetadata(path: string, metadata: ArtifactMetadata): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}
