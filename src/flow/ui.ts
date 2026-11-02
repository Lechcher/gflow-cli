import { basename } from "node:path";
import type { Locator, Page } from "playwright";
import { UiContractError } from "../errors.js";
import { flowLocators, RATIO_ICON } from "./locators.js";

// How long an uploaded file may take to appear as an asset in the ingredient
// picker. Small images land in ~5s (observed live); the budget is generous
// because slow uploads exist, and a file Flow ignores fails here rather than
// silently generating without the reference.
const CHAT_UPLOAD_TIMEOUT_MS = 120_000;

// Click the element marked with data-gflow-pick. The marking evaluate already proved the
// element is attached, visible and sized, so when the normal click cannot pass Playwright's
// actionability wait (rAF-based; throttled to a crawl in minimized/occluded windows even
// with the anti-throttling launch flags), fall back to a forced — still trusted — click
// rather than burning the 20s session default and silently giving up.
async function clickMarked(page: Page): Promise<void> {
  const marked = page.locator('[data-gflow-pick="1"]').first();
  await marked.click({ timeout: 4000 }).catch(() => marked.click({ force: true, timeout: 2000 }).catch(() => undefined));
  await page.evaluate(() => document.querySelector('[data-gflow-pick="1"]')?.removeAttribute("data-gflow-pick"));
}

// Mark the visible control whose trimmed text matches `pattern`, then real-click it.
// Flow's controls live in React/Radix portals and ignore synthetic DOM .click(); a
// trusted Playwright click on the marked element is honored.
export async function pickOption(page: Page, pattern: RegExp): Promise<boolean> {
  const marked = await page.evaluate(
    ({ source, flags }) => {
      const re = new RegExp(source, flags);
      const el = [...document.querySelectorAll("button,[role=button],[role=radio],[role=menuitemradio],[role=option]")]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .find((b) => re.test((b.textContent || "").trim()));
      if (!el) return false;
      el.setAttribute("data-gflow-pick", "1");
      return true;
    },
    { source: pattern.source, flags: pattern.flags }
  );
  if (!marked) return false;
  await clickMarked(page);
  await page.waitForTimeout(250);
  return true;
}

// Open a model dropdown (arrow_drop_down) and pick the option whose name matches
// `model` with punctuation/spacing stripped, so "nano-banana-pro" matches "Nano Banana Pro".
// Verified: after selecting, the dropdown trigger must show the requested model. A pick can
// fail silently (the option click swallows errors), and continuing would generate with the
// previous model and waste credits — so retry once, then fail loudly. `reopen` restores the
// container holding the dropdown (e.g. the settings popover, which the inter-attempt
// dismissOpenLayers closes); callers whose dropdown sits directly on the page omit it.
export async function pickModel(page: Page, model: string, reopen?: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await dismissOpenLayers(page);
      await reopen?.();
    }
    if (!(await pickOption(page, /arrow_drop_down/))) {
      if (attempt === 0) return; // no model dropdown here (e.g. the fixture) — keep current settings
      break;
    }
    // Wait for the menu's options to mount instead of a fixed pause (the settings popover is
    // itself role=menu, but only the model menu has menuitem children). Fall through on
    // timeout so a markup change degrades to the old fixed-wait behavior.
    await page
      .locator("[role=menu][data-state=open] [role=menuitem]")
      .first()
      .waitFor({ state: "visible", timeout: 3000 })
      .catch(() => page.waitForTimeout(700));
    await selectModelOption(page, model);
    if (await modelTriggerShows(page, model)) return;
  }
  // Leave no half-open layers behind: a popover left over the prompt box would silently
  // poison the next command's applySettings.
  await dismissOpenLayers(page);
  throw new UiContractError(`Could not select model "${model}" in Flow. Check the model name against the models Flow currently offers.`);
}

// True when a visible model-dropdown trigger (the arrow_drop_down button) displays `model`,
// i.e. the selection actually took effect.
async function modelTriggerShows(page: Page, model: string): Promise<boolean> {
  const target = model.toLowerCase().replace(/[^a-z0-9]/g, "");
  return page.evaluate((t) => {
    const norm = (s: string | null) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return [...document.querySelectorAll("button")]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && /arrow_drop_down/.test(b.textContent || "");
      })
      .some((b) => norm(b.textContent).includes(t));
  }, target);
}

// Choose a model from an ALREADY-OPEN model menu (matches the option whose name equals
// `model` with punctuation/spacing stripped). Split out from pickModel so callers that
// open the dropdown themselves (e.g. a section-scoped Agent Settings dropdown) don't
// re-open and accidentally close it.
export async function selectModelOption(page: Page, model: string): Promise<void> {
  const target = model.toLowerCase().replace(/[^a-z0-9]/g, "");
  const marked = await page.evaluate((t) => {
    const norm = (s: string | null) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const el = [...document.querySelectorAll("[role=option],[role=menuitem],[role=menuitemradio],button,li")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .find((e) => t.length > 2 && norm(e.textContent).includes(t));
    if (!el) return false;
    el.setAttribute("data-gflow-pick", "1");
    return true;
  }, target);
  if (marked) {
    await clickMarked(page);
  } else {
    await page.keyboard.press("Escape").catch(() => undefined);
  }
  await page.waitForTimeout(300);
}

// Close every lingering Radix layer (settings popover, model dropdown, tooltips). Escape
// dismisses one layer at a time, and a leftover layer swallows pointer events aimed at the
// prompt box underneath — the cause of "gflow video sticks until I click the page myself".
// Loop until no popper wrapper is visible (bounded, in case a layer ignores Escape).
export async function dismissOpenLayers(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // :visible matters: Radix leaves stale hidden wrappers in the DOM, and .first() locking
    // onto one of those would report "nothing open" while a later visible layer still blocks.
    const open = await page
      .locator("[data-radix-popper-content-wrapper]:visible, [data-radix-menu-content][data-state=open]:visible")
      .first()
      .isVisible()
      .catch(() => false);
    if (!open) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(250);
  }
}

// The redesigned Flow app lives at flow.google.com (the labs.google path still
// resolves but redirects here), so all deep links use the new origin. Project
// matching stays domain-agnostic so the redirect keeps working.
export const FLOW_BASE = "https://flow.google.com";
export type ProjectSub = "" | "characters" | "tools" | "create-tool";

export function projectIdFromUrl(url: string): string | undefined {
  const m = url.match(/\/project\/([0-9a-f-]+)/i);
  return m ? m[1] : undefined;
}

export function projectSubUrl(projectId: string, sub: ProjectSub): string {
  return `${FLOW_BASE}/project/${projectId}${sub ? `/${sub}` : ""}`;
}

// Ensure the page is inside a project and return its id. When `projectName` is given,
// open that named project from the dashboard; otherwise use the project already open
// (or open/create one, matching FlowPage.ensureProject's older behavior).
export async function navigateToProject(page: Page, projectName?: string): Promise<string> {
  const current = projectIdFromUrl(page.url());
  if (!projectName && current) return current;

  if (projectName) {
    // The dashboard renders each project as a thumbnail <a href="…/project/<id>"> with the
    // name/timestamp in a sibling label (projects are named by timestamp unless renamed),
    // so match the card whose surrounding label contains the name and open it by href.
    await page.goto(FLOW_BASE, { waitUntil: "domcontentloaded" });
    await page.locator('a[href*="/project/"]').first().waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
    const href = await page.evaluate((name) => {
      const linkSel = 'a[href*="/project/"]';
      for (const a of [...document.querySelectorAll(linkSel)]) {
        // Climb to the largest ancestor that still wraps exactly this one card (its label
        // sibling lives there), without reaching the grid that holds every card.
        let card: Element = a;
        while (card.parentElement && card.parentElement.querySelectorAll(linkSel).length === 1) {
          card = card.parentElement;
        }
        if ((card.textContent || "").includes(name)) return a.getAttribute("href");
      }
      return null;
    }, projectName);
    if (!href) throw new Error(`Could not find a Flow project matching "${projectName}".`);
    await page.goto(new URL(href, FLOW_BASE).toString(), { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/project\/[0-9a-f-]+/i, { timeout: 20000 }).catch(() => undefined);
    const opened = projectIdFromUrl(page.url());
    if (!opened) throw new Error(`Could not open project "${projectName}".`);
    return opened;
  }

  // No name, not in a project: open/create the first project.
  const newProject = page.getByRole("button", { name: /new project/i }).first();
  if (await newProject.count()) {
    await newProject.click().catch(() => undefined);
    await page.waitForURL(/\/project\/[0-9a-f-]+/i, { timeout: 20000 }).catch(() => undefined);
  }
  const id = projectIdFromUrl(page.url());
  if (!id) throw new Error("No Flow project is open and one could not be created.");
  return id;
}

// Like navigateToProject, but for commands that inspect or modify EXISTING content
// (media list, edit, scenes, extend): never create a project — a brand-new empty project
// cannot contain what the user asked for. With no name and no open project, fall back to
// the most recent project card on the dashboard.
export async function resolveExistingProject(page: Page, projectName?: string): Promise<string> {
  if (projectName) return navigateToProject(page, projectName);
  const current = projectIdFromUrl(page.url());
  if (current) return current;

  await page.goto(FLOW_BASE, { waitUntil: "domcontentloaded" });
  const firstCard = page.locator('a[href*="/project/"]').first();
  await firstCard.waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
  const href = await firstCard.getAttribute("href").catch(() => null);
  const id = href ? projectIdFromUrl(href) : undefined;
  if (!id) throw new Error("No Flow project found. Pass --project or create one in Flow first.");
  return id;
}

// Pick an option inside the block whose heading matches `sectionLabel` (Agent Settings
// renders identical Image/Video blocks, so global text matching is ambiguous).
export async function pickOptionInSection(page: Page, sectionLabel: RegExp, pattern: RegExp): Promise<boolean> {
  const marked = await page.evaluate(
    ({ sLabel, sFlags, pSource, pFlags }) => {
      const labelRe = new RegExp(sLabel, sFlags);
      const re = new RegExp(pSource, pFlags);
      const heading = [...document.querySelectorAll("*")].find(
        (e) => e.children.length === 0 && labelRe.test((e.textContent || "").trim())
      );
      if (!heading) return false;
      const container = heading.closest("section,div,[role=group]");
      const section = (container && container.querySelectorAll("button,[role=button],[role=radio],[role=menuitemradio],[role=option]").length > 0)
        ? container
        : container?.parentElement ?? document.body;
      const el = [...section.querySelectorAll("button,[role=button],[role=radio],[role=menuitemradio],[role=option]")]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .find((b) => re.test((b.textContent || "").trim()));
      if (!el) return false;
      el.setAttribute("data-gflow-pick", "1");
      return true;
    },
    { sLabel: sectionLabel.source, sFlags: sectionLabel.flags, pSource: pattern.source, pFlags: pattern.flags }
  );
  if (!marked) return false;
  await clickMarked(page);
  await page.waitForTimeout(250);
  return true;
}

// Open the media picker via a trigger button (its text matches `triggerText`),
// upload a local file, wait for it to auto-select, then confirm with "Add to Prompt".
export async function uploadMedia(page: Page, triggerText: RegExp, filePath: string): Promise<void> {
  const trigger = page.locator("button").filter({ hasText: triggerText }).first();
  await trigger.click().catch(() => undefined);
  const dialog = page.locator("[role=dialog],[aria-modal=true]").first();
  await dialog.waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);

  const uploadButton = dialog.locator("button").filter({ hasText: /upload/i }).first();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 15000 }),
    uploadButton.click()
  ]);
  await chooser.setFiles(filePath);

  const selected = dialog.locator('[role=option][aria-selected="true"]').first();
  await selected.waitFor({ state: "visible", timeout: 30000 }).catch(async () => {
    await dialog.locator("[role=option]").first().click().catch(() => undefined);
  });
  await confirmPicker(page, dialog);
}

// Open the media picker and pick an existing project asset whose label matches `name`.
// VERIFY LIVE (later): the picker's tab + asset tiles.
export async function addFromProject(page: Page, triggerText: RegExp, name: string): Promise<void> {
  const trigger = page.locator("button").filter({ hasText: triggerText }).first();
  await trigger.click().catch(() => undefined);
  const dialog = page.locator("[role=dialog],[aria-modal=true]").first();
  await dialog.waitFor({ state: "visible", timeout: 10000 });

  const tile = dialog.getByText(name, { exact: true }).first();
  await tile.waitFor({ state: "visible", timeout: 15000 });
  await tile.click();
  await confirmPicker(page, dialog);
}

export async function confirmPicker(page: Page, dialog: Locator): Promise<void> {
  const confirm = dialog.locator("button").filter({ hasText: /add to (prompt|scene|character)/i }).first();
  await confirm.click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Agent settings dialog (the redesigned generation defaults panel).
//
// Live-verified contract: the prompt-bar `tune` button opens a dialog headed
// "Agent settings" holding per-type sections ("Image generation default" /
// "Video generation default") with ratio/output radios (role=radio,
// aria-checked), a model dropdown per section, and a "Confirm before
// generating" Always/Never radio pair; "Save" closes it. Flow renders this as a
// modal CDK sheet: Escape does NOT dismiss it, the Close and Save buttons do.
// ---------------------------------------------------------------------------

// True once the Agent settings dialog is open and visible.
export async function agentSettingsOpen(page: Page): Promise<boolean> {
  return flowLocators(page).agentSettingsHeading.first().isVisible().catch(() => false);
}

// Open the dialog from the prompt-bar tune control. Fails loudly when the
// dialog does not open — continuing silently would generate with unknown
// defaults. Retries once after dismissing stray layers (a leftover viewer or
// popover can swallow the first click).
export async function openAgentSettings(page: Page): Promise<void> {
  const locators = flowLocators(page);
  const tune = locators.settingsButton;
  if ((await tune.count()) === 0) {
    throw new UiContractError("Flow does not show a generation-settings control (expected the prompt-bar Settings/tune button).");
  }
  const heading = page.locator("h2", { hasText: "Agent settings" }).first();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await dismissOpenLayers(page);
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.waitForTimeout(400);
    }
    await tune.click({ timeout: 8000 }).catch(() => undefined);
    const opened = await heading.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
    if (opened) return;
  }
  throw new UiContractError("The Flow Agent settings dialog did not open.");
}

// Close the dialog without saving via its Close control (Escape does not work
// on this modal). Tolerates an already-closed dialog.
export async function closeAgentSettings(page: Page): Promise<void> {
  if (!(await agentSettingsOpen(page))) return;
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button[aria-label='Close']")].find((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    btn?.setAttribute("data-gflow-pick", "1");
  });
  const marked = page.locator('[data-gflow-pick="1"]');
  if (await marked.count()) {
    await marked.first().click({ timeout: 6000 }).catch(() => undefined);
    await page.evaluate(() => document.querySelector('[data-gflow-pick="1"]')?.removeAttribute("data-gflow-pick"));
  }
  await page.waitForTimeout(400);
}

// Save the dialog and wait until it is closed. Fails loudly if the dialog stays
// open — a run that submits while settings are shown would spend credits on
// stale defaults.
export async function saveAgentSettings(page: Page): Promise<void> {
  const locators = flowLocators(page);
  const save = locators.settingsSaveButton.first();
  if ((await save.count()) === 0) throw new UiContractError("The Agent settings dialog is not showing its Save control.");
  await save.click({ timeout: 8000 }).catch(() => undefined);
  const closed = await page
    .waitForFunction(
      () => ![...document.querySelectorAll("h2")].some((h) => /Agent settings/.test(h.textContent || "") && h.getBoundingClientRect().width > 0),
      undefined,
      { timeout: 8000 }
    )
    .then(() => true)
    .catch(() => false);
  if (!closed) throw new UiContractError("The Flow Agent settings dialog did not close after Save.");
}

// Serialized scoper passed to page.evaluate: locates the Agent-settings section
// by its label and returns the first visible control whose trimmed text matches
// `pSource`/`pFlags`, or null. Two layouts are supported: the live dialog wraps
// each section in `div.settings-section > span.settings-section-label` (label
// inside the container), while flatter layouts put the label beside the controls
// — then scoping falls back to document order between section labels.
// When `mark` is set, the control is marked for a trusted click.
const AGENT_SECTION_SCOPER = ({ sSource, sFlags, pSource, pFlags, mark }: { sSource: string; sFlags: string; pSource: string; pFlags: string; mark?: boolean }) => {
  const sRe = new RegExp(sSource, sFlags);
  const pRe = new RegExp(pSource, pFlags);
  const isVisible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const matchesPattern = (el: Element) => isVisible(el) && pRe.test((el.textContent || "").trim());
  const controlIn = (root: Element) =>
    [...root.querySelectorAll("button,[role=radio],input[type=radio],label,[role=option],[role=menuitem]")].filter(matchesPattern);

  const labels = [...document.querySelectorAll(".settings-section-label, h1, h2, h3, [class*=section-title], [class*=section-header]")]
    .filter((el) => {
      const t = (el.textContent || "").trim();
      return isVisible(el) && t.length > 0 && t.length < 60;
    });
  const idx = labels.findIndex((el) => sRe.test((el.textContent || "").trim()));
  if (idx === -1) return null;
  const label = labels[idx];

  let controls = controlIn(label.closest(".settings-section, [data-section], section, [role=group]") ?? document.createElement("div"));
  if (controls.length === 0) {
    // Flat layout: controls follow this label and precede the next label.
    const end = labels[idx + 1];
    const all = [...document.querySelectorAll("button,[role=radio],input[type=radio],label,[role=option],[role=menuitem]")];
    controls = all.filter((el) => {
      const after = label.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
      const before = end ? end.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING : true;
      return after && before && matchesPattern(el);
    });
  }
  const el = controls[0];
  if (!el) return null;
  if (mark) el.setAttribute("data-gflow-pick", "1");
  return { tag: el.tagName, checked: el.getAttribute("aria-checked"), text: (el.textContent || "").trim().slice(0, 40) };
};

// Pick a control inside the dialog section whose label matches `sectionLabel`.
// `pattern` matches the control's trimmed text (ratio radios render as e.g.
// "crop_16_916:9", outputs as "x1".."x4"). Returns whether a control was picked.
export async function pickInAgentSection(page: Page, sectionLabel: RegExp, pattern: RegExp): Promise<boolean> {
  const marked = await page.evaluate(AGENT_SECTION_SCOPER, {
    sSource: sectionLabel.source, sFlags: sectionLabel.flags, pSource: pattern.source, pFlags: pattern.flags, mark: true
  });
  if (!marked) return false;
  await clickMarkedHelper(page);
  return true;
}

async function clickMarkedHelper(page: Page): Promise<void> {
  const marked = page.locator('[data-gflow-pick="1"]').first();
  await marked.click({ timeout: 6000 }).catch(() => marked.click({ force: true, timeout: 2000 }).catch(() => undefined));
  await page.evaluate(() => document.querySelector('[data-gflow-pick="1"]')?.removeAttribute("data-gflow-pick"));
  await page.waitForTimeout(300);
}

// Pick the model for a section: open that section's model dropdown (matched by
// aria-label) and choose the option whose name equals `model` with punctuation
// and spacing stripped, then verify the trigger displays it. Fails loudly —
// generating with the wrong model would waste credits.
export async function pickModelInAgentSection(page: Page, sectionLabel: RegExp, model: string): Promise<void> {
  const target = model.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Section "Image generation default" → dropdown aria-label "Image generation default model".
  const dropdownName = new RegExp(`^${sectionLabel.source.replace(/default$/i, "default model")}$`, "i");
  const dropdown = page.getByRole("button", { name: dropdownName }).first();
  if ((await dropdown.count()) === 0) {
    throw new UiContractError(`Flow does not offer a model dropdown for the ${sectionLabel.source} defaults section.`);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await closeAgentSettings(page);
    await dropdown.click({ timeout: 8000 }).catch(() => undefined);
    const menu = page.locator("[role=menuitem]:visible").first();
    const opened = await menu.waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false);
    if (!opened) continue;

    const picked = await page.evaluate(
      (t) => {
        const norm = (s: string | null) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const options = [...document.querySelectorAll("[role=menuitem],[role=option]")].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        const el = options.find((o) => norm(o.textContent).includes(t));
        if (!el) return false;
        el.setAttribute("data-gflow-pick", "1");
        return true;
      },
      target
    );
    if (picked) {
      await clickMarkedHelper(page);
      const shown = await dropdown.evaluate((b) => (b.textContent || "")).catch(() => "");
      if (target.length > 2 && !normForCheck(shown).includes(target)) continue;
      return;
    }
    // The requested model is not offered: leave no menu behind and fail loudly.
    await page.keyboard.press("Escape").catch(() => undefined);
    throw new UiContractError(
      `Flow does not offer the model "${model}" for the ${sectionLabel.source} defaults section. Check the model name against the models Flow currently offers.`
    );
  }
  await closeAgentSettings(page);
  throw new UiContractError(`Could not select model "${model}" in the ${sectionLabel.source} defaults section.`);
}

function normForCheck(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Set "Confirm before generating" in the Agent settings dialog. Clicks the
// option's label (the native radio input is visually hidden). Tolerates the
// option already being set. "never" keeps unattended runs unblocked.
export async function setConfirmBeforeGenerating(page: Page, mode: "always" | "never"): Promise<void> {
  const caption = mode === "never" ? /generate media and spend credits automatically/i : /ask for confirmation before generating/i;
  const picked = await page.evaluate((source) => {
    const re = new RegExp(source);
    const radio = [...document.querySelectorAll("input[type=radio]")].find((r) => {
      const label = r.closest("label");
      return re.test(label?.textContent || "");
    }) as HTMLInputElement | undefined;
    if (!radio) return "missing";
    if (radio.checked) return "already";
    const clickable = radio.closest("label") as HTMLElement | null;
    (clickable ?? radio).setAttribute("data-gflow-pick", "1");
    return "picked";
  }, caption.source);
  if (picked === "missing") {
    throw new UiContractError(`Flow does not offer the "${mode}" confirm-before-generating option.`);
  }
  if (picked === "picked") await clickMarkedHelper(page);
}

// Set "Confirm before generating" to the automatic option so unattended runs
// are not blocked by a confirmation prompt.
export async function setConfirmAutomatic(page: Page): Promise<void> {
  await setConfirmBeforeGenerating(page, "never");
}

// Flow's Material icon ligature prefix for each aspect ratio, so the right ratio
// radio ("crop_16_916:9" = ligature + label) can be targeted in a section.
export async function pickAgentRatio(page: Page, sectionLabel: RegExp, ratio: string): Promise<boolean> {
  const ligature = RATIO_ICON[ratio];
  if (!ligature) return false;
  return pickInAgentSection(page, sectionLabel, new RegExp(`^${ligature}`));
}

// Collect result media currently on the project page. The redesigned grid renders
// results as flow-image-tile / flow-video-tile elements whose media loads from
// flow.google.com/asb/… URLs; image tiles carry the stable id in the img's
// data-media-id, while video tiles (and the agent chat's video options) show a
// thumbnail with no id — their asb src is the stable key. The legacy
// media.getMediaUrlRedirect scheme no longer appears.
export async function collectResultMedia(page: Page, type: "image" | "video"): Promise<Array<{ id: string; src: string }>> {
  return page.evaluate((t) => {
    const out: Array<{ id: string; src: string }> = [];
    const seen = new Set<string>();
    const push = (id: string, src: string) => {
      if (!id || !src || seen.has(id)) return;
      seen.add(id);
      out.push({ id, src });
    };

    if (t === "video") {
      for (const tile of [...document.querySelectorAll("flow-video-tile, flow-a2ui-video-option")]) {
        const img = tile.querySelector("img[src]") as HTMLImageElement | null;
        if (!img) continue;
        const src = img.currentSrc || img.getAttribute("src") || "";
        const id = tile.getAttribute("data-media-id") ?? img.getAttribute("data-media-id") ?? src;
        push(id, src);
      }
    } else {
      for (const img of [...document.querySelectorAll("flow-image-tile img[data-media-id]")] as HTMLImageElement[]) {
        const id = img.getAttribute("data-media-id");
        const src = img.currentSrc || img.getAttribute("src") || "";
        push(id ?? "", src);
      }
    }

    if (out.length === 0) {
      // Legacy/fixture sources: authenticated media URLs or data: URLs.
      const selector = t === "video" ? "video[data-media-id], video[src]" : "img[data-media-id], img[src]";
      for (const el of [...document.querySelectorAll(selector)] as Array<HTMLImageElement | HTMLVideoElement>) {
        const src = el.currentSrc || el.src || "";
        if (/media\.getMediaUrlRedirect/.test(src) || src.startsWith("data:")) {
          push(el.getAttribute("data-media-id") ?? src, src);
        }
      }
    }
    return out;
  }, type);
}

export async function pickAgentOutputs(page: Page, sectionLabel: RegExp, outputs: number): Promise<boolean> {
  return pickInAgentSection(page, sectionLabel, new RegExp(`^x${outputs}$`, "i"));
}

// ---------------------------------------------------------------------------
// Ingredient picker (the prompt-bar "+" control).
//
// Live-verified contract: a tab panel with tabs All/Images/Videos/Voices/
// Characters/Avatars/Uploads ([role=tab]) plus an "Upload media" button; it is
// selection-based (no explicit confirm button observed) and Escape dismisses it.
// ---------------------------------------------------------------------------

// Open the ingredient picker from the prompt-bar "+" control.
export async function openIngredientPicker(page: Page): Promise<void> {
  const locators = flowLocators(page);
  const plus = locators.addIngredientButton;
  if ((await plus.count()) === 0) {
    throw new UiContractError("Flow does not show the ingredient picker control (prompt-bar add button).");
  }
  await plus.click({ timeout: 8000 }).catch(() => undefined);
  const opened = await page
    .locator("[role=tab]:visible")
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) throw new UiContractError("The Flow ingredient picker did not open.");
}

// Switch the picker to a tab (e.g. Characters, Images, Uploads).
export async function pickIngredientTab(page: Page, name: RegExp): Promise<boolean> {
  const marked = await page.evaluate(
    ({ source, flags }) => {
      const re = new RegExp(source, flags);
      const el = [...document.querySelectorAll('[role=tab]')]
        .filter((t) => {
          const r = t.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .find((t) => re.test((t.textContent || "").trim()));
      if (!el) return false;
      el.setAttribute("data-gflow-pick", "1");
      return true;
    },
    { source: name.source, flags: name.flags }
  );
  if (!marked) return false;
  await clickMarkedHelper(page);
  return true;
}

// Pick an asset tile by its visible label (character name or media name), scoped to
// the open picker's container so page chrome (e.g. the submit button) is never hit.
export async function pickIngredientAsset(page: Page, name: string): Promise<boolean> {
  const target = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const marked = await page.evaluate(
    (t) => {
      const norm = (s: string | null) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const tab = document.querySelector('[role=tab]');
      if (!tab) return false;
      const picker = tab.closest(".cdk-overlay-pane, [role=tablist], [role=dialog]") ?? document.body;
      const tiles = [...picker.querySelectorAll("[role=option],[role=listitem],[data-tile-id]")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && norm(el.textContent).includes(t);
      });
      const el = tiles[0];
      if (!el) return false;
      el.setAttribute("data-gflow-pick", "1");
      return true;
    },
    target
  );
  if (!marked) return false;
  await clickMarkedHelper(page);
  return true;
}

// Upload a local file through the picker's "Upload media" button and wait for the
// uploaded asset to become selectable, then select it. Selection-based picker:
// no confirm button is required.
export async function uploadIngredientMedia(page: Page, filePath: string): Promise<void> {
  await openIngredientPicker(page);
  const upload = page.getByRole("button", { name: /upload media/i }).first();
  if ((await upload.count()) === 0) {
    throw new UiContractError("The Flow ingredient picker does not offer an upload control.");
  }
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 20000 }),
    upload.click({ timeout: 8000 }).catch(() => undefined)
  ]);
  await chooser.setFiles(filePath);

  // Wait for the uploaded asset to appear as a selectable tile (matching the
  // file's name, falling back to the newest tile), then select it.
  const fileName = filePath.split(/[\\/]/).pop() ?? "";
  const selected = await page.evaluate(async (name) => {
    const deadline = Date.now() + 30000;
    const norm = (s: string | null) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    while (Date.now() < deadline) {
      const tab = document.querySelector('[role=tab]');
      const picker = tab?.closest(".cdk-overlay-pane, [role=tablist], [role=dialog]") ?? document.body;
      const tiles = [...picker.querySelectorAll("[role=option],[role=listitem],[data-tile-id]")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const tile = tiles.find((t) => norm(t.textContent).includes(norm(name))) ?? tiles[tiles.length - 1];
      if (tile) {
        (tile as HTMLElement).setAttribute("data-flow-add", "1");
        return "tile";
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return "missing";
  }, fileName);
  if (selected === "tile") {
    await page.locator("[data-flow-add='1']").first().click({ timeout: 6000 }).catch(() => undefined);
    await page.evaluate(() => document.querySelector("[data-flow-add='1']")?.removeAttribute("data-flow-add"));
  }
  await page.waitForTimeout(300);
  // Selection keeps the picker open in Flow; close it so it cannot sit over the
  // prompt box on the way to submit.
  await closeIngredientPicker(page);
}

// Close the picker (Escape).
export async function closeIngredientPicker(page: Page): Promise<void> {
  const pickerOpen = await page
    .locator("[role=tab]:visible")
    .first()
    .isVisible()
    .catch(() => false);
  if (!pickerOpen) return;
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(400);
}

// Pick an existing project asset from the picker by its visible label (the
// picker is the project's media browser in the redesigned Flow).
export async function addIngredientFromProject(page: Page, name: string): Promise<boolean> {
  await openIngredientPicker(page);
  return pickIngredientAsset(page, name);
}

// ---------------------------------------------------------------------------
// Chat media attachment (the agent chat's ingredient bar).
//
// Live-verified contract (Nov 2026): the picker lists project media as tiles
// (`.asset-title` = name; uploads are titled by filename) each with an
// "Add to prompt" button; the picker stays open after an attach, so several
// items attach in one session. Attached media renders in the composer as
// `flow-ingredient-bar > flow-ingredient-chip` — one chip per attachment, with
// no filename text on the chip (hence count-based verification).
// ---------------------------------------------------------------------------

// Find an asset tile by its visible label inside the open picker and click its
// "Add to prompt" button. Assets may live under any tab, so `tabs` lists the
// tabs to try in order (matched against the ligature-prefixed tab text, e.g.
// "imageImages" via /Images$/); `null` searches the current tab.
// Count picker tiles whose title matches `label` (used to skip re-uploading a
// file that is already in the project).
async function countAssetTiles(page: Page, label: string): Promise<number> {
  return page.evaluate((raw) => {
    const re = new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const layer = document.querySelector(".cdk-overlay-pane");
    if (!layer) return 0;
    return [...layer.querySelectorAll(".asset-title")].filter((t) =>
      re.test((t.textContent || "").trim())
    ).length;
  }, label);
}

// Attach one asset by its visible label. Live-verified interaction: Flow's
// picker lists assets as tiles and exposes a single "Add to prompt" control for
// the *selected* asset, so the flow is select-tile → Add to prompt.
async function attachAssetByLabel(page: Page, label: string, tabs: Array<RegExp | null>): Promise<boolean> {
  for (const tab of tabs) {
    if (tab) {
      await pickIngredientTab(page, tab);
      await page.waitForTimeout(600);
    }
    // 1. Select the matching tile (clicking the tile names the detail pane).
    const selected = await page.evaluate(
      ({ source }) => {
        const re = new RegExp(source, "i");
        const layer = document.querySelector(".cdk-overlay-pane");
        if (!layer) return false;
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const titles = [...layer.querySelectorAll(".asset-title")].filter(
          (t) => visible(t) && re.test((t.textContent || "").trim())
        );
        if (titles.length === 0) return false;
        const title = titles[titles.length - 1];
        // The tile is the container holding exactly this title and a control.
        let tile: Element | null = title;
        for (let depth = 0; depth < 8 && tile?.parentElement; depth += 1) {
          tile = tile.parentElement;
          const buttons = [...(tile as Element).querySelectorAll("button")].filter(visible);
          if ((tile as Element).querySelectorAll(".asset-title").length === 1 && buttons.length > 0) {
            (buttons.find((b) => re.test(b.textContent || "")) ?? buttons[buttons.length - 1]).setAttribute("data-gflow-pick", "1");
            return true;
          }
        }
        const fallback = title.closest(".asset-item-container, [role=option], [data-tile-id]") ?? title.parentElement;
        if (!fallback) return false;
        fallback.setAttribute("data-gflow-pick", "1");
        return true;
      },
      { source: label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }
    );
    if (!selected) continue;
    await clickMarkedHelper(page);
    await page.waitForTimeout(600);

    // 2. Activate the picker's "Add to prompt" control for the selection.
    const addable = await page.evaluate(() => {
      const layer = document.querySelector(".cdk-overlay-pane");
      if (!layer) return false;
      const button = [...layer.querySelectorAll("button")].find((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && /add to prompt/i.test(b.textContent || "");
      });
      if (!button) return false;
      button.setAttribute("data-gflow-pick", "1");
      return true;
    });
    if (!addable) return true; // layouts that attach on selection alone
    await clickMarkedHelper(page);
    await page.waitForTimeout(700);
    return true;
  }
  return false;
}

// Upload a local file through the picker and attach the asset it creates.
// Flow titles uploaded assets by filename and finishes small images in seconds
// (observed ~5s for a JPEG), but the wait is generous because some uploads land
// much later — and a file Flow silently ignores (video uploads, observed live)
// must surface as the "did not appear" failure rather than a silent no-op.
async function uploadAndAttachLocalFile(page: Page, filePath: string, timeoutMs: number = CHAT_UPLOAD_TIMEOUT_MS): Promise<void> {
  const fileName = basename(filePath);
  // A file already in the project need not be uploaded again — Flow would just
  // add a duplicate asset, and repeated runs would pile them up.
  if ((await countAssetTiles(page, fileName)) > 0) {
    const attached = await attachAssetByLabel(page, fileName, [null, /Uploads$/, /Images$/, /All$/]);
    if (!attached) throw new UiContractError(`Could not attach the project asset "${fileName}" in the Flow ingredient picker.`);
    return;
  }

  const upload = page.getByRole("button", { name: /upload media/i }).first();
  if ((await upload.count()) === 0) {
    throw new UiContractError("The Flow ingredient picker does not offer an upload control.");
  }
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 20000 }),
    upload.click({ timeout: 8000 }).catch(() => undefined)
  ]);
  await chooser.setFiles(filePath);

  const appeared = await page
    .waitForFunction(
      (name) => {
        const layer = document.querySelector(".cdk-overlay-pane");
        if (!layer) return false;
        return [...layer.querySelectorAll(".asset-title")].some((t) =>
          (t.textContent || "").trim().toLowerCase().includes(name.toLowerCase())
        );
      },
      fileName,
      { timeout: timeoutMs }
    )
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    throw new UiContractError(
      `Flow did not accept the uploaded file "${fileName}" — no matching asset appeared in the ingredient picker. ` +
      `Flow currently ignores uploaded video files; project videos can be attached by name.`
    );
  }
  const attached = await attachAssetByLabel(page, fileName, [null, /Uploads$/, /All$/]);
  if (!attached) throw new UiContractError(`Could not attach the uploaded file "${fileName}" in the Flow ingredient picker.`);
}

// Open the picker if it is not already open (Flow closes it after each attach,
// and an open picker toggles shut on another "+" click).
async function ensurePickerOpen(page: Page): Promise<void> {
  const open = await page.evaluate(() => {
    const layer = document.querySelector(".cdk-overlay-pane");
    if (!layer) return false;
    const tab = layer.querySelector("[role=tab]");
    if (!tab) return false;
    const r = tab.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (!open) await openIngredientPicker(page);
}

// Attach every requested photo, video, and project media item to the chat turn.
// Each item is attached independently — Flow closes the picker after an attach,
// so the picker is reopened per item; a failure names the item and leaves the
// picker closed so a later run is not blocked by a hanging overlay.
// `uploadTimeoutMs` bounds how long an uploaded file may take to surface as an
// asset (default CHAT_UPLOAD_TIMEOUT_MS); tests shorten it.
export async function attachChatMedia(
  page: Page,
  media: { photos?: string[]; videos?: string[]; fromProject?: string[] },
  options: { uploadTimeoutMs?: number } = {}
): Promise<void> {
  const photos = media.photos ?? [];
  const videos = media.videos ?? [];
  const fromProject = media.fromProject ?? [];
  if (photos.length + videos.length + fromProject.length === 0) return;

  try {
    for (const file of [...photos, ...videos]) {
      await ensurePickerOpen(page);
      await uploadAndAttachLocalFile(page, file, options.uploadTimeoutMs);
      await closeIngredientPicker(page);
    }
    for (const name of fromProject) {
      await ensurePickerOpen(page);
      const attached = await attachAssetByLabel(page, name, [null, /All$/, /Images$/, /Videos$/]);
      await closeIngredientPicker(page);
      if (!attached) {
        throw new UiContractError(
          `Could not find "${name}" in the Flow ingredient picker. Check the name with \`gflow media list\`.`
        );
      }
    }
  } catch (error) {
    await closeIngredientPicker(page).catch(() => undefined);
    throw error;
  }
}

// Verify that `expected` media items are attached to the chat turn. The chips
// carry no filename text, so this is a count check — but a count is enough:
// each attach above either produced a chip or the run already failed.
export async function verifyChatAttachments(page: Page, expected: number): Promise<void> {
  if (expected <= 0) return;
  const chips = await page.evaluate(
    () => document.querySelectorAll("flow-ingredient-bar flow-ingredient-chip").length
  );
  if (chips < expected) {
    throw new UiContractError(
      `Expected ${expected} media attachment(s) in the Flow chat, but only ${chips} are attached. ` +
      `The attachment did not take effect, so no generation was started.`
    );
  }
}

// ---------------------------------------------------------------------------
// Shared submission control.
// ---------------------------------------------------------------------------

// Activate Flow's submit control ("Start generation"): wait for it, wait for it
// to enable, click it, and tolerate a confirmation prompt afterwards (projects
// left on "Confirm before generating: Always" raise one after submit).
export async function activateGenerationSubmit(page: Page): Promise<void> {
  const submit = flowLocators(page).submitButton.first();
  await submit.waitFor({ state: "visible", timeout: 15000 });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const enabled = await submit
      .evaluate((b) => !((b as HTMLButtonElement).disabled || b.getAttribute("aria-disabled") === "true"))
      .catch(() => false);
    if (enabled) break;
    await page.waitForTimeout(300);
  }
  await submit.click({ timeout: 2000 }).catch(async () => {
    await dismissOpenLayers(page);
    await submit.click();
  });
  await confirmIfAsked(page);
}

// Best-effort: dismiss a post-submit confirmation dialog if Flow shows one.
// Short waits only — when no confirmation appears (the configured automatic
// case) this costs a fraction of a second and the run continues.
export async function confirmIfAsked(page: Page): Promise<void> {
  const dialog = page.locator("[role=dialog],[aria-modal=true]").first();
  const appeared = await dialog
    .waitFor({ state: "visible", timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  const confirm = dialog.locator("button").filter({ hasText: /confirm|generate|create|continue|yes/i }).first();
  await confirm.click({ timeout: 4000 }).catch(() => undefined);
}
// True when the control matching `pattern` inside `sectionLabel` is the checked
// radio of its group (aria-checked="true"). Returns false while the pick has not
// taken effect and null when the control cannot be found at all.
export async function agentSettingChecked(page: Page, sectionLabel: RegExp, pattern: RegExp): Promise<boolean | null> {
  const found = await page.evaluate(AGENT_SECTION_SCOPER, {
    sSource: sectionLabel.source, sFlags: sectionLabel.flags, pSource: pattern.source, pFlags: pattern.flags
  });
  if (!found) return null;
  return found.checked === "true";
}

