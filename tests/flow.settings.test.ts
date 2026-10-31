import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromium, type Page } from "playwright";
import { FlowPage } from "../src/flow/page.js";
import { UiContractError } from "../src/errors.js";

const FIXTURE = `file://${process.cwd()}/fixtures/flow/index.html`;

// Read the Agent-settings dialog's per-section radio state from the fixture.
const sectionState = (page: Page, section: "image" | "video") =>
  page.evaluate((s) => {
    const root = document.querySelector(`[data-section="${s}"]`)!;
    const checked = (group: string) =>
      [...root.querySelectorAll(`[data-radio="${group}"]`)]
        .find((el) => el.getAttribute("aria-checked") === "true")
        ?.textContent?.trim() ?? null;
    const model = root.querySelector("[aria-label$='generation default model']")?.textContent?.trim() ?? null;
    return { ratio: checked("ratio"), outputs: checked("outputs"), model };
  }, section);

describe("Flow settings via Agent settings dialog", () => {
  it("applies image/video requests to the matching section and keeps the other untouched", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "gflow-settings-profile-"));
    const outDir = await mkdtemp(join(tmpdir(), "gflow-settings-out-"));
    const context = await chromium.launchPersistentContext(profileDir, { headless: true, acceptDownloads: true });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(FIXTURE);
      const flow = new FlowPage(page);

      // Image job: ratio + outputs + model land in the image-default section only.
      await flow.runJob({
        job: {
          id: "settings-image",
          type: "image",
          prompt: "editorial still",
          ratio: "4:3",
          outputs: 1,
          model: "nano-banana-pro",
          out: outDir,
          ingredients: [],
          character: []
        },
        outDir
      });
      const image = await sectionState(page, "image");
      const video = await sectionState(page, "video");
      expect(image.ratio).toBe("crop_landscape4:3");
      expect(image.outputs).toBe("x1"); // requested outputs: 1 (the fixture default was x2)
      expect(image.model).toBe("Nano Banana Pro arrow_drop_down");
      expect(video.ratio).toBe("crop_16_916:9"); // untouched default
      expect(video.outputs).toBe("x2");
      expect(video.model).toBe("Omni 1.1 Flash arrow_drop_down");

      // A second image run re-applies its own request (settings persist per project).
      await flow.runJob({
        job: {
          id: "settings-image-2",
          type: "image",
          prompt: "second still",
          ratio: "1:1",
          outputs: 1,
          out: outDir,
          ingredients: [],
          character: []
        },
        outDir
      });
      const image2 = await sectionState(page, "image");
      expect(image2.ratio).toBe("crop_square1:1");
      expect(image2.outputs).toBe("x1");

      // Video job: its ratio lands in the video-default section only. Flow's redesigned
      // prompt has no per-prompt mode switch, so the fixture pins the generation type per
      // page load — reload for the video run (defaults reset, then the job re-applies).
      await page.goto(`${FIXTURE}?type=video`);
      await flow.runJob({
        job: {
          id: "settings-video",
          type: "video",
          prompt: "a short clip",
          ratio: "9:16",
          outputs: 1,
          model: "veo-3.1-fast",
          out: outDir,
          ingredients: [],
          character: []
        },
        outDir
      });
      const video2 = await sectionState(page, "video");
      const image2AfterVideo = await sectionState(page, "image");
      expect(video2.ratio).toBe("crop_9_169:16");
      expect(video2.outputs).toBe("x1");
      expect(video2.model).toBe("Veo 3.1 - Fast arrow_drop_down");
      expect(image2AfterVideo.ratio).toBe("crop_16_916:9"); // image defaults untouched by the video job
    } finally {
      await context.close();
    }
  }, 150000);

  it("records the requested duration in metadata even though Flow exposes no duration control", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "gflow-duration-profile-"));
    const outDir = await mkdtemp(join(tmpdir(), "gflow-duration-out-"));
    const context = await chromium.launchPersistentContext(profileDir, { headless: true, acceptDownloads: true });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`${FIXTURE}?type=video`);
      const flow = new FlowPage(page);
      const result = await flow.runJob({
        job: { id: "duration-clip", type: "video", prompt: "misty lake", duration: 8, outputs: 1, out: outDir, ingredients: [], character: [] },
        outDir
      });
      expect(result.artifacts).toHaveLength(1);
      const metadata = JSON.parse(await readFile(result.artifacts[0]!.metadataPath, "utf8"));
      expect(metadata.duration).toBe(8);
    } finally {
      await context.close();
    }
  }, 90000);

  it("aborts before submit when a requested ratio is not offered for the type", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "gflow-blocked-profile-"));
    const outDir = await mkdtemp(join(tmpdir(), "gflow-blocked-out-"));
    const context = await chromium.launchPersistentContext(profileDir, { headless: true, acceptDownloads: true });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`${FIXTURE}?type=video`);
      const flow = new FlowPage(page);
      // Flow's video defaults only offer 16:9 and 9:16; a 1:1 request must fail loudly.
      await expect(
        flow.runJob({
          job: { id: "blocked-clip", type: "video", prompt: "square clip", ratio: "1:1", outputs: 1, out: outDir, ingredients: [], character: [] },
          outDir
        })
      ).rejects.toThrow(UiContractError);
      // The dialog must not be left hanging over the prompt box after the abort.
      expect(await page.locator("h2", { hasText: "Agent settings" }).first().isVisible().catch(() => false)).toBe(false);
    } finally {
      await context.close();
    }
  }, 90000);
});
