import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromium, type Page } from "playwright";
import { GenerationFailedError, UiContractError } from "../src/errors.js";
import { AgentPage } from "../src/flow/agent.js";
import { attachChatMedia } from "../src/flow/ui.js";
import { createProgram } from "../src/cli.js";
import type { AgentAutomation, FlowAutomation } from "../src/flow/types.js";

const FIXTURE = join(process.cwd(), "fixtures/flow/index.html");
const PROJECT_URL = "https://flow.google.com/project/abcdef123456";

// Serve the fixture as the project page so the agent path runs offline. The
// fixture honors ?silent-upload=video to model Flow ignoring uploaded videos.
async function openProject(page: Page, query = ""): Promise<void> {
  const body = await readFile(FIXTURE, "utf8");
  await page.route("https://flow.google.com/project/abcdef123456**", async (route) => {
    await route.fulfill({ contentType: "text/html", body });
  });
  await page.goto(`${PROJECT_URL}${query}`);
}

const chipCount = (page: Page) =>
  page.evaluate(() => document.querySelectorAll("flow-ingredient-bar flow-ingredient-chip").length);

const resultCount = (page: Page) =>
  page.evaluate(() => document.querySelectorAll("#results img, #results video").length);

describe("Agent chat media", () => {
  it("attaches a local photo and a project asset to the chat turn before submitting", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "gflow-agent-chat-"));
    const outDir = await mkdtemp(join(tmpdir(), "gflow-agent-chat-out-"));
    const photo = join(profileDir, "alley-ref.png");
    await writeFile(photo, Buffer.from("png-bytes"));
    const context = await chromium.launchPersistentContext(profileDir, { headless: true, acceptDownloads: true });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await openProject(page);
      const agent = new AgentPage(page);

      const result = await agent.runAgent({
        id: "chat-media",
        prompt: "turn this into a moody poster",
        outDir,
        photos: [photo],
        fromProject: ["Dolly over misty lake"]
      });

      // Both requested items attached before the prompt was sent.
      expect(await chipCount(page)).toBe(2);
      expect(result.artifacts).toHaveLength(1);

      // The attachments are recorded on the artifact metadata.
      const metadata = JSON.parse(await readFile(result.artifacts[0]!.metadataPath, "utf8"));
      expect(metadata.attachments).toEqual({
        photos: [photo],
        videos: [],
        fromProject: ["Dolly over misty lake"]
      });
    } finally {
      await context.close();
    }
  }, 60000);

  it("fails before submit when a requested project asset cannot be found", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "gflow-agent-chat-"));
    const outDir = await mkdtemp(join(tmpdir(), "gflow-agent-chat-out-"));
    const context = await chromium.launchPersistentContext(profileDir, { headless: true });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await openProject(page);
      const agent = new AgentPage(page);

      await expect(
        agent.runAgent({
          id: "missing-asset",
          prompt: "use the reference",
          outDir,
          fromProject: ["No Such Asset"]
        })
      ).rejects.toThrow(UiContractError);

      // Nothing was generated, and no attachment was left half-applied.
      expect(await resultCount(page)).toBe(0);
      expect(await chipCount(page)).toBe(0);
    } finally {
      await context.close();
    }
  }, 60000);

  it("fails before submit when an uploaded file never appears as an asset", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "gflow-agent-chat-"));
    const video = join(profileDir, "clip.mp4");
    await writeFile(video, Buffer.from("mp4-bytes"));
    const context = await chromium.launchPersistentContext(profileDir, { headless: true });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      // The fixture's silent-upload mode accepts the file but surfaces no asset —
      // Flow's current behavior for uploaded videos.
      await openProject(page, "?silent-upload=video");

      await expect(
        attachChatMedia(page, { videos: [video] }, { uploadTimeoutMs: 1200 })
      ).rejects.toThrow(/did not accept the uploaded file/);

      // No generation was started and the picker was closed by the failed attach.
      expect(await resultCount(page)).toBe(0);
      expect(await chipCount(page)).toBe(0);
      const pickerOpen = await page.locator("#picker").evaluate((el) => !(el as HTMLElement).hidden).catch(() => false);
      expect(pickerOpen).toBe(false);
    } finally {
      await context.close();
    }
  }, 60000);
});

describe("Batch agent jobs", () => {
  it("runs an agent job with media and records its attachments", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "gflow-agent-chat-"));
    const outDir = await mkdtemp(join(tmpdir(), "gflow-agent-chat-out-"));
    const photo = join(profileDir, "alley-ref.png");
    await writeFile(photo, Buffer.from("png-bytes"));
    const pipeline = join(profileDir, "pipeline.yaml");
    await writeFile(
      pipeline,
      `jobs:
  - id: hero-agent
    type: agent
    prompt: "turn this into a moody poster"
    photos:
      - ${photo}
    fromProject:
      - "Dolly over misty lake"
`,
      "utf8"
    );

    const context = await chromium.launchPersistentContext(profileDir, { headless: true, acceptDownloads: true });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await openProject(page);
      const agentAutomation: AgentAutomation = new AgentPage(page);
      // A create automation is required only if the pipeline has image/video jobs.
      const flowAutomation: FlowAutomation = {
        runJob: async () => {
          throw new Error("this pipeline has no image/video jobs");
        }
      };
      const program = createProgram({ automation: flowAutomation, agentAutomation });

      await program.parseAsync(["node", "gflow", "batch", pipeline, "--out", outDir]);

      const files = await readdir(outDir);
      expect(files.some((f) => f.startsWith("hero-agent-001.png"))).toBe(true);
      const metadataPath = join(outDir, "hero-agent-001.json");
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      expect(metadata.jobId).toBe("hero-agent");
      expect(metadata.attachments).toEqual({ photos: [photo], videos: [], fromProject: ["Dolly over misty lake"] });
      expect(await chipCount(page)).toBe(2);
    } finally {
      await context.close();
    }
  }, 90000);

  it("stops the pipeline when an agent job's media cannot be attached (same isolation as other job types)", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "gflow-agent-chat-out-"));
    const pipeline = join(outDir, "pipeline.yaml");
    await writeFile(
      pipeline,
      `jobs:
  - id: good-agent
    type: agent
    prompt: "make a poster"
    fromProject:
      - "Dolly over misty lake"
  - id: bad-agent
    type: agent
    prompt: "this one cannot attach"
    fromProject:
      - "No Such Asset"
  - id: never-runs
    type: agent
    prompt: "should not be attempted"
`,
      "utf8"
    );

    const calls: string[] = [];
    const agentAutomation: AgentAutomation = {
      async runAgent(input) {
        calls.push(input.id);
        if (input.fromProject?.includes("No Such Asset")) {
          throw new UiContractError("Could not find \"No Such Asset\" in the Flow ingredient picker.");
        }
        return { jobId: input.id, artifacts: [], flowUrl: PROJECT_URL };
      },
      async applySettings() {},
      async addInstruction() {},
      async listInstructions() { return []; },
      async clearInstructions() {}
    };
    const flowAutomation: FlowAutomation = {
      runJob: async () => {
        throw new Error("this pipeline has no image/video jobs");
      }
    };
    const program = createProgram({ automation: flowAutomation, agentAutomation });

    // A UI-contract failure stops the pipeline even with --continue-on-failure,
    // exactly as an unappliable setting stops an image/video job.
    await expect(
      program.parseAsync(["node", "gflow", "batch", pipeline, "--out", outDir, "--continue-on-failure"])
    ).rejects.toThrow(UiContractError);

    expect(calls).toEqual(["good-agent", "bad-agent"]);
    const runState = JSON.parse(await readFile(join(outDir, "gflow-run.json"), "utf8"));
    expect(runState.jobs.map((job: { id: string; status: string }) => `${job.id}:${job.status}`)).toEqual([
      "good-agent:completed",
      "bad-agent:failed",
      "never-runs:pending"
    ]);
  }, 60000);

  it("continues past an ordinary agent failure when continue-on-failure is set", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "gflow-agent-chat-out-"));
    const pipeline = join(outDir, "pipeline.yaml");
    await writeFile(
      pipeline,
      `jobs:
  - id: first-agent
    type: agent
    prompt: "may fail"
  - id: second-agent
    type: agent
    prompt: "should still run"
`,
      "utf8"
    );

    const calls: string[] = [];
    const agentAutomation: AgentAutomation = {
      async runAgent(input) {
        calls.push(input.id);
        if (input.id === "first-agent") throw new GenerationFailedError("timed out");
        return { jobId: input.id, artifacts: [], flowUrl: PROJECT_URL };
      },
      async applySettings() {},
      async addInstruction() {},
      async listInstructions() { return []; },
      async clearInstructions() {}
    };
    const flowAutomation: FlowAutomation = {
      runJob: async () => {
        throw new Error("this pipeline has no image/video jobs");
      }
    };
    const program = createProgram({ automation: flowAutomation, agentAutomation });

    await program.parseAsync(["node", "gflow", "batch", pipeline, "--out", outDir, "--continue-on-failure"]);

    expect(calls).toEqual(["first-agent", "second-agent"]);
    const runState = JSON.parse(await readFile(join(outDir, "gflow-run.json"), "utf8"));
    expect(runState.jobs.map((job: { id: string; status: string }) => `${job.id}:${job.status}`)).toEqual([
      "first-agent:failed",
      "second-agent:completed"
    ]);
  }, 60000);
});
