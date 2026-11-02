import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import {
  CreditLimitError,
  GenerationBlockedError,
  GenerationFailedError,
  LoginRequiredError,
  ManualActionRequiredError,
  RateLimitedError,
  UiContractError
} from "../errors.js";
import { artifactBasename, writeArtifactMetadata } from "../output/artifacts.js";
import { captureDownloadEvent } from "./download.js";
import { FLOW_MUSIC_SESSION_URL, MUSIC_DOWNLOAD_FORMATS, musicLocators, type MusicDownloadFormat } from "./locators.js";
import type { MusicAutomation, MusicSongResult, RunMusicInput } from "./types.js";

// Flow Music's default song timeout: the Producer takes ~1 minute for a short prompt
// and full songs run ~3 minutes (live-verified), so the default matches the image
// command's budget.
const DEFAULT_SONG_TIMEOUT_SECONDS = 900;

/**
 * Drives the Google Flow Music studio (flowmusic.app) Producer chat in the signed-in
 * profile: applies the structured request (lyrics/style/instrumental), submits it,
 * waits for a completed song (its `/song/<id>` link), and downloads the audio through
 * the song's options menu.
 */
export class MusicPage implements MusicAutomation {
  constructor(
    private readonly page: Page,
    private readonly sessionUrl: string = FLOW_MUSIC_SESSION_URL
  ) {}

  async open(): Promise<void> {
    // Reuse the page when it is already in the studio (mode/state preserved); a fresh
    // tab or the marketing landing navigates to the song-session route.
    if (!/flowmusic\.app\/session/.test(this.page.url())) {
      await this.page.goto(this.sessionUrl, { waitUntil: "domcontentloaded" });
    }
    // First-run privacy notice (country select + Agree) can cover the studio; clear it
    // best-effort so the composer is reachable. The dialog does not reappear once agreed.
    const locators = musicLocators(this.page);
    await locators.composer
      .first()
      .waitFor({ state: "visible", timeout: 20000 })
      .catch(() => undefined);
    await this.clearFirstRunDialogs();
  }

  // The signed-out state renders a header "Log in" button; a pending Google One access
  // prompt is the manual-action surface. Everything else means the studio is ready.
  async assertReady(): Promise<void> {
    const locators = musicLocators(this.page);
    if (await locators.loginButton.first().isVisible().catch(() => false)) {
      throw new LoginRequiredError(
        "Google Flow Music login is required. Run `gflow auth login` and complete the Flow Music login in the browser."
      );
    }
    if (await locators.manualActionMarker.first().isVisible().catch(() => false)) {
      throw new ManualActionRequiredError(
        "Flow Music shows a consent or verification prompt. Complete it in the Flow Music tab, then run again."
      );
    }
    if ((await locators.composer.count()) === 0) {
      throw new UiContractError("The Flow Music studio did not show the Producer composer.");
    }
  }

  async runSong(input: RunMusicInput): Promise<MusicSongResult> {
    await this.open();
    await this.assertReady();
    await this.applyStructuredFields(input);

    // Record which songs already exist so the wait loop can spot this run's song.
    const songsBefore = await this.songCount();
    await this.fillComposer(input.prompt);
    await this.submit();
    const songTitle = await this.waitForSong(songsBefore, (input.timeout ?? DEFAULT_SONG_TIMEOUT_SECONDS) * 1000);

    const basename = artifactBasename(input.id, 1);
    const { assetPath } = await this.downloadSong(input, basename, songTitle);
    const metadataPath = join(input.outDir, `${basename}.json`);
    await writeArtifactMetadata(metadataPath, {
      jobId: input.id,
      type: "music",
      prompt: input.prompt,
      style: input.style,
      lyrics: input.lyrics,
      instrumental: input.instrumental,
      duration: input.duration,
      requestedOutputs: 1,
      downloadedAt: new Date().toISOString(),
      source: "google-flow-music-browser",
      flowUrl: this.page.url(),
      status: "downloaded"
    });
    return {
      jobId: input.id,
      artifacts: [{ path: assetPath, metadataPath }],
      flowUrl: this.page.url()
    };
  }

  // Structured fields are discrete controls (live-verified): each is applied before the
  // prompt is typed and verified in place, so a field that cannot be applied aborts the
  // run instead of producing a song without it.
  private async applyStructuredFields(input: RunMusicInput): Promise<void> {
    const locators = musicLocators(this.page);
    if (input.instrumental === true) await this.applyInstrumental(locators.instrumentalToggle);
    if (input.style) {
      await this.fillPanelText(input.style, locators.soundField, locators.soundToggle, "Sound description");
    }
    const lyrics = input.lyrics ?? (input.lyricsFile ? await readFile(input.lyricsFile, "utf8") : undefined);
    if (lyrics) {
      await this.fillPanelText(lyrics, locators.lyricsField, locators.lyricsToggle, "Lyrics");
    }
  }

  // Instrumental mode is a DOM-level toggle: live Flow Music renders it outside the
  // accessibility tree (getByRole finds nothing), so it is driven and verified through
  // the element itself. Live state lives in data-state; the fixture models aria-pressed.
  private async applyInstrumental(toggle: Locator): Promise<void> {
    if ((await toggle.count()) === 0) {
      throw new UiContractError("Flow Music does not show the instrumental-mode control.");
    }
    const isOn = async (): Promise<boolean> => {
      const attrs = await toggle
        .evaluate((el) => ({
          pressed: el.getAttribute("aria-pressed"),
          state: el.getAttribute("data-state")
        }))
        .catch(() => ({ pressed: null, state: null }));
      return attrs.pressed === "true" || attrs.state === "checked";
    };
    if (await isOn()) return;
    await toggle.evaluate((el) => (el as HTMLElement).click()).catch(() => undefined);
    await this.page.waitForTimeout(600);
    if (!(await isOn())) {
      throw new UiContractError("Instrumental mode did not take effect in Flow Music.");
    }
  }

  // Live Flow Music renders the Sound/Lyrics panel textareas at zero width — present
  // and enabled, but not Playwright-actionable — with the sections expanded by default.
  // Typing therefore goes through focus + real key events, and the field's value is
  // read back: a value that does not land aborts the run before generation.
  private async fillPanelText(text: string, field: Locator, toggle: Locator, fieldLabel: string): Promise<void> {
    if (await this.focusAndType(field, text)) return;

    // The section may be collapsed (other layouts): open it and retry once.
    if ((await toggle.count()) === 0) {
      throw new UiContractError(`Flow Music does not show the ${fieldLabel} section control.`);
    }
    await toggle.click({ timeout: 10000 }).catch(() => undefined);
    await this.page.waitForTimeout(500);
    if (await this.focusAndType(field, text)) return;
    throw new UiContractError(`The Flow Music ${fieldLabel} field did not take the text.`);
  }

  // Focus the field (works even at zero width) and type with real key events, then read
  // the value back. Returns false when the element could not take focus (collapsed).
  private async focusAndType(field: Locator, text: string): Promise<boolean> {
    const focused = await field
      .evaluate((el) => {
        (el as HTMLTextAreaElement).focus();
        return document.activeElement === el;
      })
      .catch(() => false);
    if (!focused) return false;
    await this.page.keyboard.press("ControlOrMeta+a").catch(() => undefined);
    await this.page.keyboard.press("Backspace").catch(() => undefined);
    await this.page.keyboard.type(text, { delay: 4 });
    await this.page.waitForTimeout(300);
    const value = await field.evaluate((el) => (el as HTMLTextAreaElement).value).catch(() => "");
    return value === text;
  }

  private async fillComposer(prompt: string): Promise<void> {
    const composer = musicLocators(this.page).composer.first();
    await composer.click({ timeout: 15000 });
    await composer.press("ControlOrMeta+a").catch(() => undefined);
    await composer.press("Backspace").catch(() => undefined);
    await composer.pressSequentially(prompt, { delay: 8 });
  }

  private async submit(): Promise<void> {
    const button = musicLocators(this.page).submitButton.first();
    // The submit enables once the typed prompt registers in React state (~1s).
    await button.waitFor({ state: "visible", timeout: 20000 });
    const enabled = await this.waitFor(() =>
      button.isEnabled().catch(() => false)
    , 15000);
    if (!enabled) {
      throw new UiContractError("The Flow Music composer did not accept the prompt (submit stayed disabled).");
    }
    await button.click({ timeout: 15000 });
  }

  // Wait for a completed song: a new /song/<id> link in the session. A chat response
  // alone (or the greeting placeholder) is not completion.
  private async waitForSong(songsBefore: number, timeoutMs: number): Promise<string> {
    const locators = musicLocators(this.page);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await locators.rateLimitMarker.first().isVisible().catch(() => false)) {
        throw new RateLimitedError("Flow Music displayed a rate limit or unusual activity message.");
      }
      if (await locators.creditMarker.first().isVisible().catch(() => false)) {
        throw new CreditLimitError("Flow Music displayed a credit or quota message.");
      }
      if (await locators.blockedMarker.first().isVisible().catch(() => false)) {
        throw new GenerationBlockedError("Flow Music displayed a policy block message.");
      }
      if (await locators.failedMarker.first().isVisible().catch(() => false)) {
        throw new GenerationFailedError("Flow Music displayed a generation failed message.");
      }
      const songs = await locators.songLink.count();
      if (songs > songsBefore) {
        // The newest song is the last entry in the session list.
        const link = locators.songLink.last();
        return (await link.textContent().catch(() => ""))?.trim() || "song";
      }
      await this.page.waitForTimeout(3000);
    }
    throw new GenerationFailedError(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for a completed song.`);
  }

  // Download through the song's "More options for <title>" menu → Download → format.
  private async downloadSong(input: RunMusicInput, basename: string, songTitle: string): Promise<{ assetPath: string }> {
    const moreButton = songTitle && songTitle !== "song"
      ? this.page.getByRole("button", { name: new RegExp(`^more options for ${escapeRegExp(songTitle)}`, "i") }).first()
      : this.page.getByRole("button", { name: /^more options for/i }).last();
    if ((await moreButton.count()) === 0) {
      throw new UiContractError(
        `The Flow Music session did not show the options control${songTitle ? ` for "${songTitle}"` : ""}.`
      );
    }
    await moreButton.click({ timeout: 15000 });
    const downloadItem = this.page.getByRole("menuitem", { name: /^download$/i }).first();
    if (!(await downloadItem.count())) {
      throw new UiContractError("The Flow Music song menu did not offer a Download action.");
    }
    await downloadItem.click({ timeout: 15000 });
    await this.page.waitForTimeout(800);
    const format = (input.format ?? "mp3") as MusicDownloadFormat;
    if (!MUSIC_DOWNLOAD_FORMATS.includes(format)) {
      throw new UiContractError(`Unknown Flow Music download format: ${String(format)}`);
    }
    const formatItem = this.page.getByRole("menuitem", { name: new RegExp(`^${format}$`, "i") }).first();
    if (!(await formatItem.count())) {
      throw new UiContractError(`Flow Music did not offer the ${format} download format.`);
    }
    const { assetPath } = await captureDownloadEvent(
      { page: this.page, context: this.page.context(), src: "", type: "audio", quality: "original", outDir: input.outDir, basename },
      () => formatItem.click({ timeout: 15000 })
    );
    return { assetPath };
  }

  private async clearFirstRunDialogs(): Promise<void> {
    const agree = this.page.getByRole("button", { name: /^agree$/i }).first();
    if (await agree.count()) {
      await agree.click({ timeout: 15000 }).catch(() => undefined);
      await this.page.waitForTimeout(1500);
    }
  }

  private async songCount(): Promise<number> {
    return musicLocators(this.page).songLink.count();
  }

  private async waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return true;
      await this.page.waitForTimeout(500);
    }
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
