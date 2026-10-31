import { join } from "node:path";
import type { Page } from "playwright";
import { GenerationBlockedError, GenerationFailedError, UiContractError } from "../errors.js";
import { artifactBasename, writeArtifactMetadata } from "../output/artifacts.js";
import { downloadResult } from "./download.js";
import { AGENT_SETTINGS_SECTION, RATIO_ICON, flowLocators } from "./locators.js";
import type {
  AgentAutomation, AgentInstructionInput, AgentInstructionSummary,
  AgentSettingsInput, FlowJobResult, RunAgentInput
} from "./types.js";
import {
  activateGenerationSubmit,
  agentSettingChecked,
  closeAgentSettings,
  closeIngredientPicker,
  collectResultMedia,
  navigateToProject,
  openAgentSettings,
  pickAgentOutputs,
  pickAgentRatio,
  pickIngredientAsset,
  pickModelInAgentSection,
  projectSubUrl,
  saveAgentSettings,
  setConfirmBeforeGenerating
} from "./ui.js";

export class AgentPage implements AgentAutomation {
  constructor(private readonly page: Page) {}

  // The redesigned Flow is agent-first: the prompt box is always the agent's
  // instruction bar, so "opening the agent" only means having a project open.
  private async openAgent(project?: string): Promise<void> {
    const projectId = await navigateToProject(this.page, project);
    await this.page.goto(projectSubUrl(projectId, ""), { waitUntil: "domcontentloaded" });
    await flowLocators(this.page).promptBox.first().waitFor({ state: "visible", timeout: 20000 });
  }

  async applySettings(input: AgentSettingsInput): Promise<void> {
    await this.openAgent(input.project);
    await openAgentSettings(this.page);
    try {
      if (input.confirm) await setConfirmBeforeGenerating(this.page, input.confirm);
      await this.applySection(AGENT_SETTINGS_SECTION.image, input.imageRatio, input.imageQuantity, input.imageModel);
      await this.applySection(AGENT_SETTINGS_SECTION.video, input.videoRatio, input.videoQuantity, input.videoModel);
      await saveAgentSettings(this.page);
    } catch (error) {
      await closeAgentSettings(this.page).catch(() => undefined);
      throw error;
    }
  }

  // Apply one defaults section's requested fields, verifying each landed.
  private async applySection(section: RegExp, ratio?: string, quantity?: number, model?: string): Promise<void> {
    if (ratio && RATIO_ICON[ratio]) {
      if (!(await pickAgentRatio(this.page, section, ratio))) {
        throw new UiContractError(`Flow does not offer aspect ratio ${ratio} for ${section.source} defaults.`);
      }
      if ((await agentSettingChecked(this.page, section, new RegExp(`^${RATIO_ICON[ratio]}`))) !== true) {
        throw new UiContractError(`Aspect ratio ${ratio} did not take effect for ${section.source} defaults.`);
      }
    }
    if (quantity) {
      if (!(await pickAgentOutputs(this.page, section, quantity))) {
        throw new UiContractError(`Flow does not offer ${quantity} output(s) for ${section.source} defaults.`);
      }
      if ((await agentSettingChecked(this.page, section, new RegExp(`^x${quantity}$`))) !== true) {
        throw new UiContractError(`${quantity} output(s) did not take effect for ${section.source} defaults.`);
      }
    }
    if (model) await pickModelInAgentSection(this.page, section, model);
  }

  async addInstruction(input: AgentInstructionInput): Promise<void> {
    await this.openAgent(input.project);
    await openAgentInstructions(this.page);

    // A reference image attaches through the ingredient picker.
    if (input.ref) {
      const picked = await pickIngredientAsset(this.page, input.ref);
      if (!picked) {
        await closeIngredientPicker(this.page);
        throw new GenerationFailedError(`Reference "${input.ref}" was not found in the Flow ingredient picker.`);
      }
      await closeIngredientPicker(this.page);
    }

    // Live-verified: the instruction sheet holds a plain <textarea>.
    const field = this.page.locator("textarea").last();
    if ((await field.count()) === 0) {
      throw new UiContractError("The Flow agent instructions sheet did not show a text field.");
    }
    await field.click().catch(() => undefined);
    await field.fill(input.text).catch(() => undefined);
    await this.confirmInstructionSheet();
    await this.page.waitForTimeout(300);
  }

  async listInstructions(project?: string): Promise<AgentInstructionSummary[]> {
    await this.openAgent(project);
    await openAgentInstructions(this.page);
    const texts = await this.page.evaluate(() =>
      [...document.querySelectorAll("textarea")]
        .map((t) => (t as HTMLTextAreaElement).value.trim())
        .filter((t) => t.length > 0)
    );
    await this.closeInstructionSheet();
    return texts.map((text) => ({ text, hasRef: false }));
  }

  async clearInstructions(project?: string): Promise<void> {
    await this.openAgent(project);
    await openAgentInstructions(this.page);
    for (let i = 0; i < 20; i += 1) {
      const removed = await this.page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find((b) => /remove instruction/i.test(b.textContent || ""));
        if (!btn) return false;
        btn.click();
        return true;
      });
      if (!removed) break;
      await this.page.waitForTimeout(250);
    }
    await this.confirmInstructionSheet();
  }

  async runAgent(input: RunAgentInput): Promise<FlowJobResult> {
    await this.openAgent(input.project);
    const locators = flowLocators(this.page);
    const box = locators.promptBox.first();
    await box.click();
    await box.press("ControlOrMeta+a").catch(() => undefined);
    await box.press("Backspace").catch(() => undefined);
    await box.pressSequentially(input.prompt, { delay: 8 });

    const before = new Set(await this.resultSrcs());
    await activateGenerationSubmit(this.page);

    const deadline = Date.now() + (input.timeout ?? 1800) * 1000;
    let newSrcs: string[] = [];
    while (Date.now() < deadline) {
      if (await locators.blockedMarker.first().isVisible().catch(() => false)) throw new GenerationBlockedError("Agent generation was blocked.");
      if (await locators.failedMarker.first().isVisible().catch(() => false)) throw new GenerationFailedError("Agent generation failed.");
      newSrcs = (await this.resultSrcs()).filter((s) => !before.has(s));
      if (newSrcs.length > 0) break;
      await this.page.waitForTimeout(2000);
    }
    if (newSrcs.length === 0) throw new GenerationFailedError("Agent produced no downloadable results in time.");

    const context = this.page.context();
    const artifacts: { path: string; metadataPath: string }[] = [];
    for (let index = 0; index < newSrcs.length; index += 1) {
      const basename = artifactBasename(input.id, index + 1);
      const type: "image" | "video" = /\.mp4|video/i.test(newSrcs[index]) ? "video" : "image";
      const { assetPath } = await downloadResult({ page: this.page, context, src: newSrcs[index], type, quality: "original", outDir: input.outDir, basename });
      const metadataPath = join(input.outDir, `${basename}.json`);
      await writeArtifactMetadata(metadataPath, {
        jobId: input.id, type, prompt: input.prompt, requestedOutputs: newSrcs.length, quality: "original",
        downloadedAt: new Date().toISOString(), source: "google-flow-browser", flowUrl: this.page.url(), status: "downloaded"
      });
      artifacts.push({ path: assetPath, metadataPath });
    }
    return { jobId: input.id, artifacts, flowUrl: this.page.url() };
  }

  private async resultSrcs(): Promise<string[]> {
    const media = await collectResultMedia(this.page, "image");
    if (media.length > 0) return media.map((m) => m.src);
    const legacy = await this.page.evaluate(() => {
      const out: string[] = [];
      for (const v of [...document.querySelectorAll("video")]) {
        const s = (v as HTMLVideoElement).currentSrc || (v as HTMLVideoElement).src;
        if (/media\.getMediaUrlRedirect/.test(s)) out.push(s);
      }
      for (const i of [...document.querySelectorAll("img")]) {
        const s = (i as HTMLImageElement).currentSrc || (i as HTMLImageElement).src;
        if ((/media\.getMediaUrlRedirect/.test(s) && !/mediaUrlType=/.test(s)) || s.startsWith("data:")) out.push(s);
      }
      return out;
    });
    return [...new Set(legacy)];
  }

  private async confirmInstructionSheet(): Promise<void> {
    // The sheet's Done/Save control, if it exists; Escape otherwise.
    const done = this.page.getByRole("button", { name: /^(Done|Save)$/i }).first();
    if (await done.count()) await done.click({ timeout: 5000 }).catch(() => undefined);
    else await this.page.keyboard.press("Escape").catch(() => undefined);
    await this.page.waitForTimeout(400);
  }

  private async closeInstructionSheet(): Promise<void> {
    const opened = (await this.page.getByRole("button", { name: /^(Done|Save)$/i }).first().count()) > 0;
    if (!opened) return;
    await this.page.keyboard.press("Escape").catch(() => undefined);
    await this.page.waitForTimeout(400);
  }
}

// Open the agent-instructions sheet (live-verified: prompt-bar button with
// aria-label "Agent instructions" opens an in-page sheet titled the same).
async function openAgentInstructions(page: Page): Promise<void> {
  const button = flowLocators(page).agentInstructionsButton;
  if ((await button.count()) === 0) {
    throw new UiContractError("Flow does not show an agent instructions control.");
  }
  await button.click({ timeout: 8000 }).catch(() => undefined);
  const opened = await page
    .getByRole("heading", { name: /Agent instructions/i })
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) throw new UiContractError("The Flow agent instructions sheet did not open.");
}
