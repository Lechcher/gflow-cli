import { join } from "node:path";
import type { Page } from "playwright";
import {
  CreditLimitError,
  GenerationBlockedError,
  GenerationFailedError,
  LoginRequiredError,
  ManualActionRequiredError,
  RateLimitedError
} from "../errors.js";
import { artifactBasename, writeArtifactMetadata } from "../output/artifacts.js";
import { downloadResult, type DownloadQuality } from "./download.js";
import type { GFlowJob } from "../jobs/schema.js";
import type { FlowAutomation, FlowAutomationRunInput, FlowJobResult } from "./types.js";
import { AGENT_SETTINGS_SECTION, RATIO_ICON, flowLocators } from "./locators.js";
import { UiContractError } from "../errors.js";
import {
  activateGenerationSubmit,
  agentSettingChecked,
  closeAgentSettings,
  closeIngredientPicker,
  collectResultMedia,
  dismissOpenLayers,
  navigateToProject,
  openAgentSettings,
  openIngredientPicker,
  pickAgentOutputs,
  pickAgentRatio,
  pickIngredientAsset,
  pickIngredientTab,
  pickModelInAgentSection,
  saveAgentSettings,
  setConfirmAutomatic,
  uploadIngredientMedia
} from "./ui.js";

// The redesigned Flow app lives at flow.google.com; the labs.google URL redirects here.
export const FLOW_URL = "https://flow.google.com";


export class FlowPage implements FlowAutomation {
  constructor(private readonly page: Page, private readonly flowUrl = FLOW_URL) {}

  async open(): Promise<void> {
    await this.page.goto(this.flowUrl, { waitUntil: "domcontentloaded" });
    // Flow is a single-page app. Wait for either the signed-in dashboard or, when already
    // inside a project, the prompt box. A login/consent wall shows neither, so the wait
    // times out and assertReady() reports the real problem.
    const locators = flowLocators(this.page);
    await locators.promptBox
      .first()
      .or(locators.dashboardMarker.first())
      .waitFor({ state: "visible", timeout: 20000 })
      .catch(() => undefined);
  }

  async assertReady(): Promise<void> {
    const locators = flowLocators(this.page);

    // A signed-in session shows the Flow dashboard (project list) or, inside a project, the
    // prompt box. Either one means we are authenticated and ready.
    const dashboardReady = await locators.dashboardMarker.first().isVisible().catch(() => false);
    const promptReady = (await locators.promptBox.count()) > 0;
    if (dashboardReady || promptReady) return;

    if (await locators.manualActionMarker.first().isVisible().catch(() => false)) {
      throw new ManualActionRequiredError("Flow requires login, consent, or verification.");
    }
    throw new LoginRequiredError();
  }

  async runJob(input: FlowAutomationRunInput): Promise<FlowJobResult> {
    const locators = flowLocators(this.page);
    if (input.job.project) {
      await navigateToProject(this.page, input.job.project);
      await locators.promptBox.first().waitFor({ state: "visible", timeout: 20000 }).catch(() => undefined);
    } else {
      await this.ensureProject();
    }
    await this.assertReady();
    await this.applySettings(input.job);

    if (input.job.type === "video") {
      if (input.job.startFrame) await this.uploadFrame("Start", input.job.startFrame);
      if (input.job.endFrame) await this.uploadFrame("End", input.job.endFrame);
    }

    if ((await locators.promptBox.count()) === 0) {
      throw new GenerationFailedError("Could not find the Flow prompt box. Open or create a project first.");
    }

    for (const name of input.job.character ?? []) {
      await this.referenceCharacter(name);
    }

    const before = new Set(await this.resultSrcs(input.job.type));
    await this.fillPrompt(input.job.prompt);
    await this.submit();

    const generationTimeoutSeconds = input.job.timeout ?? (input.job.type === "video" ? 1800 : 900);
    const newSrcs = await this.waitForResults(before, input.job.outputs, generationTimeoutSeconds * 1000, input.job.type);

    const context = this.page.context();
    const quality: DownloadQuality = input.job.upscale ?? "original";
    const artifacts = [];
    for (let index = 0; index < Math.min(input.job.outputs, newSrcs.length); index += 1) {
      const basename = artifactBasename(input.job.id, index + 1);
      const { assetPath } = await downloadResult({
        page: this.page,
        context,
        src: newSrcs[index],
        type: input.job.type,
        quality,
        outDir: input.outDir,
        basename
      });
      const metadataPath = join(input.outDir, `${basename}.json`);
      await writeArtifactMetadata(metadataPath, {
        jobId: input.job.id,
        type: input.job.type,
        prompt: input.job.prompt,
        project: input.job.project,
        model: input.job.model,
        ratio: input.job.ratio,
        duration: input.job.type === "video" ? input.job.duration : undefined,
        requestedOutputs: input.job.outputs,
        quality,
        characters: input.job.character?.length ? input.job.character : undefined,
        downloadedAt: new Date().toISOString(),
        source: "google-flow-browser",
        flowUrl: this.page.url(),
        status: "downloaded"
      });
      artifacts.push({ path: assetPath, metadataPath });
    }

    if (artifacts.length === 0) {
      throw new GenerationFailedError("No downloadable results appeared.");
    }

    return {
      jobId: input.job.id,
      artifacts,
      flowUrl: this.page.url()
    };
  }

  // Result media currently on the project grid (redesigned tiles carry
  // data-media-id; the fixture renders data:/getMediaUrlRedirect sources, which
  // the shared collector keeps working).
  private async resultSrcs(type: "image" | "video"): Promise<string[]> {
    const media = await collectResultMedia(this.page, type);
    if (media.length > 0) return media.map((m) => m.src);
    // Legacy/fixture sources: authenticated media URLs or data: URLs.
    const legacy = await this.page.evaluate((t) => {
      const els = [...document.querySelectorAll(t === "video" ? "video" : "img")] as Array<HTMLImageElement | HTMLVideoElement>;
      return els
        .map((e) => e.currentSrc || e.src)
        .filter((src) => /media\.getMediaUrlRedirect/.test(src) || src.startsWith("data:"));
    }, type);
    return [...new Set(legacy)];
  }

  // Enter a project so the prompt box exists. If the editor is already showing (real Flow
  // project or the test fixture), do nothing; otherwise open a fresh project from the dashboard.
  private async ensureProject(): Promise<void> {
    const locators = flowLocators(this.page);
    if ((await locators.promptBox.count()) > 0) return;
    const newProject = locators.newProjectButton.first();
    if (await newProject.count()) {
      await newProject.click().catch(() => undefined);
      await locators.promptBox.first().waitFor({ state: "visible", timeout: 20000 }).catch(() => undefined);
    }
  }

  // Open the Agent settings dialog and apply the project's generation defaults for
  // this job's type (image jobs drive the image-default section, video jobs the
  // video-default section), then Save. Per-project defaults replace the old
  // per-prompt pills; every requested value is verified in place before saving, so a
  // setting that cannot be applied aborts the run instead of spending credits on
  // stale defaults. When the settings control is absent (e.g. the offline fixture) we
  // leave the current defaults untouched.
  // Video duration: Flow exposes no duration control (verified live), so `--duration`
  // is accepted and recorded in metadata but not enforced.
  private async applySettings(job: GFlowJob): Promise<void> {
    const settings = flowLocators(this.page).settingsButton.first();
    if (!(await settings.count())) return;

    await openAgentSettings(this.page);
    const section = AGENT_SETTINGS_SECTION[job.type];
    try {
      if (job.ratio && RATIO_ICON[job.ratio]) {
        if (!(await pickAgentRatio(this.page, section, job.ratio))) {
          throw new UiContractError(`Flow does not offer aspect ratio ${job.ratio} for ${job.type} generation defaults.`);
        }
        const checked = await agentSettingChecked(this.page, section, new RegExp(`^${RATIO_ICON[job.ratio]}`));
        if (checked !== true) {
          throw new UiContractError(`Aspect ratio ${job.ratio} did not take effect for ${job.type} generation defaults.`);
        }
      }
      if (job.outputs) {
        if (!(await pickAgentOutputs(this.page, section, job.outputs))) {
          throw new UiContractError(`Flow does not offer ${job.outputs} output(s) for ${job.type} generation defaults.`);
        }
        const checked = await agentSettingChecked(this.page, section, new RegExp(`^x${job.outputs}$`));
        if (checked !== true) {
          throw new UiContractError(`${job.outputs} output(s) did not take effect for ${job.type} generation defaults.`);
        }
      }
      if (job.model) await pickModelInAgentSection(this.page, section, job.model);
      await setConfirmAutomatic(this.page);
      await saveAgentSettings(this.page);
    } catch (error) {
      // Never leave the dialog hanging over the prompt box for the next run.
      await closeAgentSettings(this.page).catch(() => undefined);
      throw error;
    }
  }

  // Video start/end frame images: Flow's redesign removed the per-prompt Frames
  // slots (Start/End), so the frame images are attached through the prompt-bar
  // ingredient picker as reference images instead — the start/end distinction is
  // lost until Flow exposes frame assignment again.
  private async uploadFrame(_slot: "Start" | "End", filePath: string): Promise<void> {
    await uploadIngredientMedia(this.page, filePath);
  }

  // Reference a saved character in the current generation.
  // Live-verified contract: the prompt-bar "+" opens the ingredient picker; its
  // "Characters" tab lists saved character tiles, and picking a tile attaches it
  // (selection-based; no confirm button).
  private async referenceCharacter(name: string): Promise<void> {
    const locators = flowLocators(this.page);
    if ((await locators.addIngredientButton.count()) === 0) return;

    await openIngredientPicker(this.page);
    await pickIngredientTab(this.page, /^accessibility_new\s*Characters$|^Characters$/i);
    const picked = await pickIngredientAsset(this.page, name);
    if (!picked) {
      await closeIngredientPicker(this.page);
      throw new GenerationFailedError(
        `Character "${name}" was not found in the Flow ingredient picker. Use \`gflow character list\` to check saved characters.`
      );
    }
    await this.page.waitForTimeout(300);
    await closeIngredientPicker(this.page);
  }

  private async fillPrompt(prompt: string): Promise<void> {
    const box = flowLocators(this.page).promptBox.first();
    // A leftover popover layer over the prompt box swallows the click; clear layers first,
    // and if a click is still intercepted, clear again and fall back to focusing directly.
    await dismissOpenLayers(this.page);
    // Short timeout: layers were just dismissed, so a still-intercepted click should reach
    // the recovery path quickly instead of burning the full 20s session default.
    await box.click({ timeout: 2000 }).catch(async () => {
      await dismissOpenLayers(this.page);
      await box.click({ timeout: 5000 }).catch(() => box.evaluate((el) => (el as HTMLElement).focus()));
    });
    // Clear any existing text (sequential/batch jobs reuse the same prompt box) with real
    // key events, then type so the contenteditable's framework registers the input.
    await box.press("ControlOrMeta+a").catch(() => undefined);
    await box.press("Backspace").catch(() => undefined);
    await box.pressSequentially(prompt, { delay: 8 });
  }

  private async submit(): Promise<void> {
    await activateGenerationSubmit(this.page);
  }

  private async waitForResults(before: Set<string>, expected: number, timeoutMs: number, type: "image" | "video"): Promise<string[]> {
    const locators = flowLocators(this.page);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await locators.rateLimitMarker.first().isVisible().catch(() => false)) {
        throw new RateLimitedError("Flow displayed a rate limit or unusual activity message.");
      }
      if (await locators.creditMarker.first().isVisible().catch(() => false)) {
        throw new CreditLimitError("Flow displayed a credit or quota message.");
      }
      if (await locators.blockedMarker.first().isVisible().catch(() => false)) {
        throw new GenerationBlockedError("Flow displayed a policy block message.");
      }
      if (await locators.failedMarker.first().isVisible().catch(() => false)) {
        throw new GenerationFailedError("Flow displayed a generation failed message.");
      }

      const added = (await this.resultSrcs(type)).filter((src) => !before.has(src));
      if (added.length >= expected) return added.slice(0, expected);
      await this.page.waitForTimeout(1500);
    }

    const added = (await this.resultSrcs(type)).filter((src) => !before.has(src));
    if (added.length > 0) return added;
    throw new GenerationFailedError(`Timed out waiting for ${expected} result(s).`);
  }
}
