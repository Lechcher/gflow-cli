import type { Page } from "playwright";

// The verified UI contract for Google Flow Music (flowmusic.app), recorded against the
// live signed-in profile (see the add-flow-music-generation change's design.md). The
// studio is a Next.js app with a chat-driven Producer composer: the prompt box is a
// plain textarea, the submit is the chat row's "Send message" icon button, a finished
// song appears as a link to /song/<id> in the session, and the download lives in the
// song's "More options" menu behind a format picker (M4A/MP3/WAV).
export const FLOW_MUSIC_URL = "https://www.flowmusic.app";
export const FLOW_MUSIC_SESSION_URL = "https://www.flowmusic.app/session?t=true";

// Download formats Flow Music's song menu offers, in menu order.
export const MUSIC_DOWNLOAD_FORMATS = ["m4a", "mp3", "wav"] as const;
export type MusicDownloadFormat = (typeof MUSIC_DOWNLOAD_FORMATS)[number];

// The verified UI contract for the redesigned Flow app (flow.google.com), recorded
// against the live signed-in profile (see the change's design.md). Icon-only buttons
// carry an aria-label and no matchable text; ratio/output controls inside the Agent
// settings dialog are role=radio with aria-checked; the two "Settings" buttons are
// disambiguated by their Material icon ligature (settings_2 = app settings, tune =
// generation defaults).
export function flowLocators(page: Page) {
  return {
    // The Flow prompt is a contenteditable div (role=textbox, aria-label
    // "What do you want to create?"), not a labeled <textarea>.
    promptBox: page.locator('[role="textbox"][contenteditable="true"]'),
    // Signed-in Flow dashboard (projects view). Proves an authenticated session for
    // `doctor`; the prompt box only exists once a project is open.
    dashboardMarker: page.getByRole("button", { name: /new project/i }),
    newProjectButton: page.getByRole("button", { name: /new project/i }),
    // Submit control: icon-only arrow_forward button (aria-label "Start generation"),
    // disabled until the prompt has text. It carries NO "Create" text anymore.
    submitButton: page.getByRole("button", { name: "Start generation" }),
    // The prompt-bar generation-settings control (tune icon) opens the Agent settings
    // dialog. The top-nav gear (settings_2 icon) repeats aria-label="Settings", so
    // match the tune icon to disambiguate.
    settingsButton: page.locator('button[aria-label="Settings"]').filter({ hasText: "tune" }).first(),
    // Prompt-bar icon buttons, matched by aria-label only.
    agentInstructionsButton: page.getByRole("button", { name: "Agent instructions" }).first(),
    addIngredientButton: page.getByRole("button", { name: "Add ingredients to the prompt box" }).first(),
    // Agent settings dialog controls (first match is the open dialog's).
    agentSettingsHeading: page.getByRole("heading", { name: "Agent settings" }),
    settingsSaveButton: page.getByRole("button", { name: "Save" }),
    settingsCloseButton: page.locator('button[aria-label="Close"]'),
    // Model dropdowns inside Agent settings, matched by their aria-labels.
    imageModelDropdown: page.getByRole("button", { name: "Image generation default model" }).first(),
    videoModelDropdown: page.getByRole("button", { name: "Video generation default model" }).first(),
    rateLimitMarker: page.getByText(/unusual activity|trying again too|rate limit/i),
    creditMarker: page.getByText(/run out of credits|insufficient credits|no credits left/i),
    blockedMarker: page.getByText(/can.?t help with|violates|content policy/i),
    failedMarker: page.getByText(/generation failed|couldn.?t generate|something went wrong/i),
    manualActionMarker: page.getByText(/verify your identity|sign in to continue|consent required/i),
    // Result tiles in the redesigned grid are custom elements (`flow-image-tile`,
    // `flow-video-tile`) whose media carries the stable id in `data-media-id` and
    // loads from `flow.google.com/asb/…` (the old media.getMediaUrlRedirect scheme
    // is gone).
    resultImageTiles: page.locator("flow-image-tile img[data-media-id]"),
    resultVideoTiles: page.locator("flow-video-tile video[data-media-id], flow-video-tile img[data-media-id]"),
    // The character prompt is the same contenteditable; character creation ends with
    // the shared submit control.
    characterPrompt: page.locator('[role="textbox"][contenteditable="true"]'),
    characterCreateButton: page.getByRole("button", { name: "Start generation" }),
    characterUploadButton: page.locator("button").filter({ hasText: /^upload/i }),
    characterAddFromProject: page.locator("button").filter({ hasText: /add from project/i })
  };
}

// Flow's Material icon ligature prefix for each aspect ratio, so settings picks can
// target the right ratio radio in the Agent settings dialog.
export const RATIO_ICON: Record<string, string> = {
  "16:9": "crop_16_9",
  "9:16": "crop_9_16",
  "4:3": "crop_landscape",
  "1:1": "crop_square",
  "3:4": "crop_portrait"
};

// The Agent settings dialog exposes per-type sections; jobs map to a section label.
export const AGENT_SETTINGS_SECTION = {
  image: /Image generation default/i,
  video: /Video generation default/i
} as const;

// Flow Music studio locators. Readiness is the inverse of Flow's dashboard marker:
// the signed-out state renders a header "Log in" button, so its absence (plus the
// composer) proves the session is signed in.
export function musicLocators(page: Page) {
  return {
    // The Producer composer: a plain textarea, present in both signed-in and
    // signed-out states; the submit stays disabled until text registers.
    composer: page.locator('textarea[aria-label="Chat message"]'),
    // Chat-row submit (icon button). This is the song-request submit — the separate
    // "Generate" button stays disabled in the session chat (live-verified).
    submitButton: page.getByRole("button", { name: "Send message" }),
    // Discrete structured-field controls (live-verified). The Sound/Lyrics sections
    // are expanded by default and their textareas render at zero width — present and
    // enabled, but not Playwright-actionable — so the section buttons are the fallback
    // openers (live labels: "Collapse Sound section"/"Collapse Lyrics section").
    lyricsToggle: page.getByRole("button", { name: /collapse lyrics section|^lyrics$/i }).first(),
    lyricsField: page.locator('textarea[aria-label="Lyrics"]'),
    soundToggle: page.getByRole("button", { name: /collapse sound section|^sound$/i }).first(),
    soundField: page.locator('textarea[aria-label="Sound description"]'),
    // Instrumental mode is outside the accessibility tree live (getByRole matches
    // nothing), so it is located as a DOM element; state: data-state (live) or
    // aria-pressed (fixture).
    instrumentalToggle: page.locator('button[aria-label="Toggle instrumental mode"]'),
    // Signed-out marker (login wall): the header "Log in" button.
    loginButton: page.getByRole("button", { name: "Log in" }),
    manualActionMarker: page.getByText(/verify your identity|sign in to continue|grant access to your google one/i),
    rateLimitMarker: page.getByText(/unusual activity|trying again too|rate limit/i),
    creditMarker: page.getByText(/run out of credits|insufficient credits|no credits left|out of credits/i),
    blockedMarker: page.getByText(/can.?t help with|violates|content policy/i),
    failedMarker: page.getByText(/generation failed|couldn.?t generate|something went wrong/i),
    // A finished song appears as a VISIBLE session link to its /song/<id> page (a
    // hidden entry does not count as completed); the player's "Play <title>" and
    // per-song "More options for <title>" button follow it.
    songLink: page.locator('a[href^="/song/"]:visible'),
    // The Producer chat's greeting before any song exists.
    greetingMarker: page.getByText(/your producer is here/i)
  };
}
