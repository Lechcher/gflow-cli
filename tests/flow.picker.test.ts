import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromium, type Page } from "playwright";
import { FlowPage } from "../src/flow/page.js";

const FIXTURE = `file://${process.cwd()}/fixtures/flow/index.html`;

// What the ingredient picker has attached to the prompt (set by the fixture's
// tile handlers) — proof that a reference actually reached the prompt.
const attachedRefs = (page: Page) =>
  page.evaluate(() => {
    const raw = (document.getElementById("prompt") as HTMLElement).dataset.attached ?? "";
    return raw.split("|").filter(Boolean);
  });

describe("Flow ingredient picker", () => {
  it("attaches a saved character to the prompt through the Characters tab", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "gflow-picker-profile-"));
    const outDir = await mkdtemp(join(tmpdir(), "gflow-picker-out-"));
    const context = await chromium.launchPersistentContext(profileDir, { headless: true });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(FIXTURE);
      const flow = new FlowPage(page);
      await flow.runJob({
        job: { id: "with-character", type: "image", prompt: "editorial still", outputs: 1, out: outDir, ingredients: [], character: ["Untitled Character"] },
        outDir
      });
      expect(await attachedRefs(page)).toContain("Untitled Character");
    } finally {
      await context.close();
    }
  }, 60000);

  it("uploads a video start-frame image through the picker (Frames slots are gone)", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "gflow-picker-profile-"));
    const outDir = await mkdtemp(join(tmpdir(), "gflow-picker-out-"));
    const framePath = join(profileDir, "start-frame.png");
    await writeFile(framePath, Buffer.from("fake-png-bytes"));
    const context = await chromium.launchPersistentContext(profileDir, { headless: true, acceptDownloads: true });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`${FIXTURE}?type=video`);
      const flow = new FlowPage(page);
      await flow.runJob({
        job: {
          id: "with-frame", type: "video", prompt: "a short clip", outputs: 1,
          startFrame: framePath, out: outDir, ingredients: [], character: []
        },
        outDir
      });
      expect(await attachedRefs(page)).toContain("start-frame.png");
    } finally {
      await context.close();
    }
  }, 60000);
});
