import { join } from "node:path";
import type { Page } from "playwright";
import { GenerationBlockedError, GenerationFailedError } from "../errors.js";
import { artifactBasename, writeArtifactMetadata } from "../output/artifacts.js";
import { downloadResult } from "./download.js";
import { flowLocators } from "./locators.js";
import type { EditAutomation, EditMediaInput, EditMediaResult, ProjectMedia } from "./types.js";
import {
  activateGenerationSubmit,
  addIngredientFromProject,
  projectSubUrl,
  resolveExistingProject,
  uploadIngredientMedia
} from "./ui.js";

export class EditPage implements EditAutomation {
  constructor(private readonly page: Page) {}

  async listProjectMedia(project?: string): Promise<ProjectMedia[]> {
    const projectId = await resolveExistingProject(this.page, project);
    await this.page.goto(projectSubUrl(projectId, ""), { waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(1000);

    return this.page.evaluate(() => {
      const results: Array<{ id: string; type: "image" | "video"; src: string; name?: string }> = [];
      const seen = new Set<string>();

      // Redesigned grid: flow-image-tile / flow-video-tile elements carry the stable
      // id in data-media-id.
      for (const [selector, type] of [["flow-image-tile img[data-media-id]", "image"], ["flow-video-tile [data-media-id]", "video"]] as const) {
        for (const el of [...document.querySelectorAll(selector)]) {
          const id = el.getAttribute("data-media-id");
          const src = (el as HTMLImageElement).currentSrc || el.getAttribute("src") || "";
          if (!id || !src || seen.has(id)) continue;
          seen.add(id);
          const alt = (el as HTMLImageElement).alt?.trim();
          const name = alt && !/tile displaying|option|generated image|user profile/i.test(alt) ? alt : undefined;
          results.push({ id, type, src, name });
        }
      }

      if (results.length > 0) return results;

      // Legacy/fixture sources: authenticated media URLs.
      for (const img of [...document.querySelectorAll("img")] as HTMLImageElement[]) {
        const src = img.currentSrc || img.src;
        if (!/media\.getMediaUrlRedirect/.test(src) || /mediaUrlType=/.test(src)) continue;
        const match = src.match(/[?&]name=([0-9a-f-]+)/i);
        if (!match) continue;
        const id = match[1];
        if (seen.has(id)) continue;
        seen.add(id);
        results.push({ id, type: "image", src });
      }
      for (const vid of [...document.querySelectorAll("video")] as HTMLVideoElement[]) {
        const src = vid.currentSrc || vid.src;
        if (!/media\.getMediaUrlRedirect/.test(src)) continue;
        const match = src.match(/[?&]name=([0-9a-f-]+)/i);
        if (!match) continue;
        const id = match[1];
        if (seen.has(id)) continue;
        seen.add(id);
        results.push({ id, type: "video", src });
      }
      return results;
    });
  }

  async editMedia(input: EditMediaInput): Promise<EditMediaResult> {
    const projectId = await resolveExistingProject(this.page, input.project);
    await this.page.goto(projectSubUrl(projectId, ""), { waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(1000);

    const mediaSrc = await this.findMediaById(input.mediaId);
    if (!mediaSrc) {
      throw new GenerationFailedError(`Media with id "${input.mediaId}" not found in the project.`);
    }

    await this.openMediaForEdit(mediaSrc);

    // Reference media now goes through the prompt-bar ingredient picker (the
    // redesigned Flow has one unified media browser for uploads and project assets).
    for (const file of input.referenceImages) await uploadIngredientMedia(this.page, file);
    for (const ref of input.fromProject) {
      const picked = await addIngredientFromProject(this.page, ref);
      if (!picked) {
        throw new GenerationFailedError(`Reference "${ref}" was not found in the Flow ingredient picker.`);
      }
      await this.page.keyboard.press("Escape").catch(() => undefined);
      await this.page.waitForTimeout(400);
    }

    const editBox = flowLocators(this.page).promptBox.first();
    await editBox.waitFor({ state: "visible", timeout: 15000 });
    await editBox.click();
    await editBox.press("ControlOrMeta+a").catch(() => undefined);
    await editBox.press("Backspace").catch(() => undefined);
    await editBox.pressSequentially(input.prompt, { delay: 8 });

    const locators = flowLocators(this.page);
    const before = new Set(await this.resultSrcs());
    await activateGenerationSubmit(this.page);

    const newSrcs = await this.waitForResults(before, (input.timeout ?? 900) * 1000, locators);

    const context = this.page.context();
    const artifacts: { path: string; metadataPath: string }[] = [];
    for (let index = 0; index < newSrcs.length; index += 1) {
      const basename = artifactBasename(`edit-${input.mediaId.slice(0, 8)}`, index + 1);
      const type: "image" | "video" = /\.mp4|video/i.test(newSrcs[index]) ? "video" : "image";
      const { assetPath } = await downloadResult({
        page: this.page, context, src: newSrcs[index], type, quality: "original", outDir: input.outDir, basename
      });
      const metadataPath = join(input.outDir, `${basename}.json`);
      await writeArtifactMetadata(metadataPath, {
        jobId: `edit-${input.mediaId.slice(0, 8)}`, type, prompt: input.prompt,
        project: input.project, requestedOutputs: newSrcs.length, quality: "original",
        downloadedAt: new Date().toISOString(), source: "google-flow-browser",
        flowUrl: this.page.url(), status: "downloaded"
      });
      artifacts.push({ path: assetPath, metadataPath });
    }

    if (artifacts.length === 0) {
      throw new GenerationFailedError("Edit produced no downloadable results.");
    }

    return { mediaId: input.mediaId, artifacts, flowUrl: this.page.url() };
  }

  private async findMediaById(mediaId: string): Promise<string | undefined> {
    return this.page.evaluate((id) => {
      // Redesigned grid: the stable id lives in data-media-id.
      const el = [...document.querySelectorAll("[data-media-id]")].find((e) => e.getAttribute("data-media-id") === id);
      if (el) {
        const media = el.matches("img,video") ? el : el.querySelector("img,video");
        const src = media ? (media as HTMLImageElement).currentSrc || media.getAttribute("src") || "" : "";
        if (src) return src;
      }
      for (const img of [...document.querySelectorAll("img")] as HTMLImageElement[]) {
        const src = img.currentSrc || img.src;
        if (src.includes(id)) return src;
      }
      for (const vid of [...document.querySelectorAll("video")] as HTMLVideoElement[]) {
        const src = vid.currentSrc || vid.src;
        if (src.includes(id)) return src;
      }
      return undefined;
    }, mediaId);
  }

  private async openMediaForEdit(src: string): Promise<void> {
    const found = await this.page.evaluate((s) => {
      const els = [...document.querySelectorAll("img,video")] as Array<HTMLImageElement | HTMLVideoElement>;
      const el = els.find((e) => ((e as HTMLVideoElement).currentSrc || e.src) === s);
      if (!el) return false;
      const clickable = (el.closest("a,button,[role=button]") as HTMLElement) || (el as HTMLElement);
      clickable.setAttribute("data-gflow-edit", "1");
      return true;
    }, src);
    if (!found) throw new GenerationFailedError("Could not locate the media element to edit.");
    await this.page.locator('[data-gflow-edit="1"]').first().click();
    await this.page.evaluate(() => document.querySelector('[data-gflow-edit="1"]')?.removeAttribute("data-gflow-edit"));
    // Wait for the edit/character detail view to load — it shows "What do you want to change?"
    await this.page.getByText(/What do you want to change/i).first()
      .waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
    await this.page.waitForTimeout(500);
  }

  private async resultSrcs(): Promise<string[]> {
    return this.page.evaluate(() => {
      const out: string[] = [];
      for (const v of [...document.querySelectorAll("video")] as HTMLVideoElement[]) {
        const s = v.currentSrc || v.src;
        if (/media\.getMediaUrlRedirect/.test(s)) out.push(s);
      }
      for (const i of [...document.querySelectorAll("img")] as HTMLImageElement[]) {
        const s = i.currentSrc || i.src;
        if (/media\.getMediaUrlRedirect/.test(s) && !/mediaUrlType=/.test(s)) out.push(s);
      }
      return out;
    });
  }

  private async waitForResults(
    before: Set<string>,
    timeoutMs: number,
    locators: ReturnType<typeof flowLocators>
  ): Promise<string[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await locators.blockedMarker.first().isVisible().catch(() => false)) {
        throw new GenerationBlockedError("Flow blocked this edit.");
      }
      if (await locators.failedMarker.first().isVisible().catch(() => false)) {
        throw new GenerationFailedError("Flow reported the edit failed.");
      }
      const added = (await this.resultSrcs()).filter((s) => !before.has(s));
      if (added.length > 0) return added;
      await this.page.waitForTimeout(1500);
    }
    const added = (await this.resultSrcs()).filter((s) => !before.has(s));
    if (added.length > 0) return added;
    throw new GenerationFailedError("Timed out waiting for edit results.");
  }
}
