import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { artifactBasename, createArtifactPlan, writeArtifactMetadata } from "../src/output/artifacts.js";

describe("artifact output", () => {
  it("creates deterministic asset and metadata paths", () => {
    const plan = createArtifactPlan({
      outDir: "/tmp/out",
      jobId: "hero-video",
      index: 1,
      extension: ".mp4"
    });

    expect(plan.assetPath).toBe("/tmp/out/hero-video-001.mp4");
    expect(plan.metadataPath).toBe("/tmp/out/hero-video-001.json");
  });

  it("writes metadata json beside the asset", async () => {
    const root = await mkdtemp(join(tmpdir(), "gflow-test-"));
    const plan = createArtifactPlan({
      outDir: root,
      jobId: "concept-image",
      index: 2,
      extension: "png"
    });

    await writeArtifactMetadata(plan.metadataPath, {
      jobId: "concept-image",
      type: "image",
      prompt: "Prompt",
      project: "Project",
      model: "model",
      ratio: "1:1",
      duration: undefined,
      requestedOutputs: 4,
      downloadedAt: "2026-06-02T00:00:00.000Z",
      source: "google-flow-browser",
      flowUrl: "https://labs.google/fx/tools/flow",
      status: "downloaded"
    });

    const metadata = JSON.parse(await readFile(plan.metadataPath, "utf8"));
    expect(metadata.jobId).toBe("concept-image");
    expect(metadata.status).toBe("downloaded");
  });

  it("writes music metadata with the structured song request", async () => {
    const root = await mkdtemp(join(tmpdir(), "gflow-test-"));
    const plan = createArtifactPlan({
      outDir: root,
      jobId: "lofi",
      index: 1,
      extension: ".mp3"
    });

    await writeArtifactMetadata(plan.metadataPath, {
      jobId: "lofi",
      type: "music",
      prompt: "a short rainy lo-fi hip hop beat for studying",
      style: "lo-fi hip hop, mellow piano, vinyl crackle",
      lyrics: "rain keeps me company",
      instrumental: false,
      duration: 30,
      requestedOutputs: 1,
      downloadedAt: "2026-11-03T00:00:00.000Z",
      source: "google-flow-music-browser",
      flowUrl: "https://www.flowmusic.app/session?t=true",
      status: "downloaded"
    });

    const metadata = JSON.parse(await readFile(plan.metadataPath, "utf8"));
    expect(metadata.plan ?? plan.assetPath).toMatch(/\.mp3$/);
    expect(metadata.type).toBe("music");
    expect(metadata.source).toBe("google-flow-music-browser");
    expect(metadata.style).toBe("lo-fi hip hop, mellow piano, vinyl crackle");
    expect(metadata.lyrics).toBe("rain keeps me company");
    expect(metadata.instrumental).toBe(false);
    expect(metadata.duration).toBe(30);
  });
});

describe("artifactBasename", () => {
  it("zero-pads the index and prefixes the job id", () => {
    expect(artifactBasename("hero", 1)).toBe("hero-001");
    expect(artifactBasename("hero", 12)).toBe("hero-012");
  });
});
