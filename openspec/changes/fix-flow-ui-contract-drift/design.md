# Design

## Context

Motivation is in proposal.md; the behavioral contract is in
`specs/flow-ui-contract/spec.md`. The current `src/flow/locators.ts` was written against
the pre-redesign Flow (Material icon ligature text such as `arrow_forward`, a
`Create`-text submit button, prompt-bar pills labeled e.g. `🍌 Nano Banana 2 /
crop_16_9 / x2`, and `labs.google/fx/tools/flow` URLs).

Verified against the live signed-in profile in
`/Users/liberian/Desktop/Projects/video_clone/.gflow/profiles/default` (Google Chrome
156, driven over CDP, Oct 31 2026):

- App domain is now `https://flow.google.com`; a project embeds at
  `https://flow.google.com/project/<uuid>`. The legacy
  `labs.google/fx/tools/flow` URL still resolves (redirect) but is not the canonical
  surface. Deep links under the old base redirect to the new app.
- The project prompt bar contains: the prompt box
  (`[role=textbox][contenteditable=true]`, aria-label "What do you want to create?"),
  an icon-only ingredient button (`add` icon, aria-label "Add ingredients to the prompt
  box"), an icon-only agent button (`article_spark`, aria-label "Agent instructions"), an
  icon-only settings button (`tune`, aria-label "Settings"), and the submit button —
  icon-only `arrow_forward`, **aria-label "Start generation"**, enabled only once the
  prompt has content. There is no text "Create" on it.
- The `tune` button opens an "Agent settings" panel: "Confirm before generating"
  (Always/Never radio labels with explanatory captions), an "Image generation default"
  section (ratio buttons with `crop_*` icon prefixes + labels, output buttons
  `x1..x4` with `aria-checked`, model dropdown aria-label "Image generation default
  model"), a "Video generation default" section (ratios `crop_16_9`/`crop_9_16` only,
  `x1..x4`, model dropdown aria-label "Video generation default model"), and a `Save`
  button. Per-prompt mode/ratio/outputs pills no longer exist, and no per-prompt video
  duration control was found anywhere (model menus still to be checked — see tasks).
- The dashboard (`flow.google.com/`) shows project cards with "Edit project title" /
  "Delete project", and a new-project control whose accessible name is "New project"
  (rendered "addNew project").
- New projects default to "Confirm before generating: Always", which would stall
  unattended runs after submit.

### Verified UI contract (re-verified live over CDP, Oct 31 2026)

| Surface | Verified selector / structure |
| --- | --- |
| Prompt box | `[role=textbox][contenteditable=true]`, aria-label "What do you want to create?" |
| Submit | `button[aria-label="Start generation"]` (icon-only `arrow_forward`; `disabled` until prompt has text) |
| Prompt bar | `button[aria-label="Add ingredients to the prompt box"]` (`add`), `button[aria-label="Agent instructions"]` (`article_spark`), `button[aria-label="Settings"]` with icon `tune`, submit |
| Agent settings dialog | opened by the `tune` button; `<h2>Agent settings`; ratios `button[role=radio]` text `crop_16_9`+"16:9" etc. with `aria-checked`; outputs `x1..x4` `button[role=radio]` with `aria-checked`; model dropdowns `button[aria-label="Image generation default model"]` / `…Video…` (`aria-haspopup=menu`), options are `[role=menuitem]`; confirm radios are `input[type=radio]` inside the "Always…"/"Never…" `label`s; `Save` button closes the dialog — **Escape does NOT close it**, the `Close` button does |
| Model options | Image: Nano Banana Pro / Nano Banana 2 Lite / Nano Banana 2.1; Video: Omni 1.1 Flash, Veo 3.1 - Lite, Veo 3.1 - Fast, Veo 3.1 - Quality; **no duration/length option anywhere** |
| Ingredient picker | tab panel (`[role=tab]` mat-list-items: All/Images/Videos/Voices/Characters/Avatars/Uploads) + "Upload media" button; Escape closes |
| Left rail | links `a[href*="/project/"]` → Tools `/tools`, Create tool `/create-tool`, Bin `/trash`; `button` for Home/All media/Characters/Scenes |
| Dashboard cards | `flow-project-card` → `.project-card` → `a[href*="/project/"]` (aria-label "Open project") + footer `.project-title-text` span (project name); new-project button text "addNew project" |
| Agent instructions | in-page side sheet titled "Agent instructions" (not a cdk overlay); Escape closes |
| Result media | images: `flow-image-tile > img.class="image"[data-media-id]` (src `flow.google.com/asb/…=s1600-rw`); videos: `flow-video-tile` / the agent chat's `flow-a2ui-video-option`, each showing a thumbnail `img` with no `data-media-id` — the asb src is the stable key; the legacy `media.getMediaUrlRedirect` scheme is gone |
| Agent-first generation | the redesigned prompt is chat-driven (`flow-agent-panel` / `flow-chat-view`): Flow itself decides image vs video and results also appear as chat options; the generation defaults set in Agent settings still steer the result (verified: ratio 16:9 + Veo 3.1 - Fast respected) |

## Goals / Non-Goals

**Goals:**

- One centralized, verified UI contract in `src/flow/locators.ts` covering every
  command surface (create, edit, extend/scene, tools, characters, agent).
- Unattended runs: settings applied per project, confirmation set to automatic, and any
  stray confirmation prompt tolerated.
- Credited safety: a requested setting (ratio/outputs/model) either lands (verified) or
  the run fails loudly — never silently generates with the wrong settings.
- Fixtures/tests updated to the new contract so regressions are caught offline.

**Non-Goals:**

- Redesigning the CLI's flags or adding new features (e.g. prompt templates).
- Supporting both the legacy and redesigned UI simultaneously beyond tolerating the
  redirect.
- Emulating the new Angular-based UI in fixtures beyond what the commands exercise.

## Decisions

1. **Locate controls by accessible name/role first, icon/text second.**
  Submit becomes `getByRole("button", { name: "Start generation" })`. Rationale: the
  redesigned shell is Angular Material with `aria-label` on every icon-only button;
  ligature text (`arrow_forward`) alone now matches buttons we don't want (e.g. the top
  nav's `settings_2` button also carries aria-label "Settings"). Alternatives: keep
  `hasText` filters (already proven stale; brittle against icon-only rendering).
  Legacy text matches are not kept as fallbacks except where harmless (the dashboard's
  "New project" name matches both renderings).
2. **Disambiguate same-named controls by icon/position.** Two buttons are named
  "Settings" (top-nav gear, prompt-bar tune). The prompt-bar settings button is the one
  whose Material icon ligature is `tune`. The helper marks candidates in-page (a
  `data-gflow-*` hook) and performs a trusted click, reusing the existing `pickOption`
  pattern rather than adding a DOM-click dependency.
3. **Settings application becomes "open Agent settings → apply per type → Save",
   section-scoped.** Image jobs write the image-default section, video jobs the
  video-default section; only requested fields change (plus confirmation set to
  automatic). Each applied value is verified in place (e.g. the ratio button's
  `aria-checked="true"`, the model trigger's label, the output button's checked state)
  before Save; a mismatch raises `UiContractError` instead of silently spending credits.
  The dialog is opened once per project per run, not per prompt.
4. **Model selection keeps the dropdown-verify-retry loop** from `pickModel`, retargeted
  at the section's model trigger (aria-label "… default model") and verified by reading
  the trigger's own label after selection.
5. **Domain constants move to `flow.google.com`, matching stays domain-agnostic.**
   `FLOW_BASE`/`FLOW_URL` become the new origin; project/dashboard matching uses
   `/project/<uuid>` on any host so the redirect still works; waits allow for the
   redirect chain (domcontentloaded + URL wait). `navigateToProject`'s new-project flow
   is re-verified against the dashboard button.
6. **Duration: verify-then-accept.** During implementation, every plausible duration
   surface is checked (model menus, prompt parsing, agent settings). If none exists, the
   video job proceeds on the model default, artifact metadata still records the
   requested duration, and CLI help documents the limitation (per the answered decision).
   No partial-select-timeout stalls: absence must be concluded quickly with an explicit
   check, not a long blind wait.
7. **Fixtures move to the new contract.** The local fixture
   (`fixtures/flow/index.html`) renders the icon-only `Start generation` submit (with
   `aria-label`, disabled until the prompt has text) and a minimal "Agent settings"
   panel so offline tests cover submit + settings application. Live-UI-only concerns
   (real model menus, confirm dialog) are covered by a manual smoke script and the
   verification task, not unit fixtures.
8. **Character references go through the ingredient picker.** The picker trigger is the
   `Add ingredients to the prompt box` button (replacing the old `add_2 Create`
   matcher); inside the dialog, the existing tab → tile → confirm sequence is re-verified
   live (labels may have shifted) and then encoded in the fixtures.

## Risks / Trade-offs

- **UI is freshly shipped and may A/B.** → Mitigations: locators are centralized in
  `locators.ts`, every interaction verifies the intended post-state, and the smoke task
  re-checks the same selectors on the live profile before implementation is declared
  done.
- **"Agent settings" mutates user project defaults.** → Accepted (per the answered
  decision): only requested fields + automatic confirmation are written; the task list
  includes documenting this in CLI help/README.
- **Duration silently differs from request.** → Accepted gap: documented in
  help/README and artifact metadata records the request.
- **Redirect/SPA timing.** → CDP-attach flow already tolerates reuse; URL waits use
  domain-agnostic regexes and generous-but-bounded timeouts.
- **Spending credits during verification.** → The live smoke run uses one minimal image
  generation; the user approves it before it runs.

## Migration Plan

- No user-side data migration; the change updates the CLI's UI contract and fixtures.
- Users update the installed package (the globally installed `gflow` is a published
  build, not this working tree); the video_clone profile keeps its signed-in session.
- Rollback: revert the commit; the previous UI contract remains recoverable for any
  environment still served the old UI.

## Open Questions

- ~~Whether the video model menu exposes duration/length options~~ — **Answered
  (live-verified): no duration control exists anywhere.** Both model menus only list
  models (video: Omni 1.1 Flash, Veo 3.1 - Lite, Veo 3.1 - Fast, Veo 3.1 - Quality;
  image: 🍌 Nano Banana Pro, 🍌 Nano Banana 2 Lite, 🍌 Nano Banana 2.1) and a scan of
  the project page for duration-like labels returned nothing. `--duration` is accepted
  and recorded but not enforceable; the CLI help documents this.
- ~~Exact confirm-button label inside the ingredient picker and "Create tool" page URL
  shape~~ — **Answered (live-verified): the tool deep links still work unchanged**
  (`/project/<id>/tools`, `/project/<id>/create-tool`); the ingredient picker is a tab
  panel (All/Images/Videos/Voices/Characters/Avatars/Uploads) with an "Upload media"
  button and no explicit confirm button — selection-based, confirmed by the picker tests.
- ~~Result detection on the redesigned grid~~ — **Answered (live smoke, Oct 31 2026):**
  images download as `flow-image-tile img[data-media-id]`; videos as
  `flow-video-tile`/`flow-a2ui-video-option` thumbnails. Both live smoke runs
  (image 1376x768 JPEG, video Veo-3.1-Fast MP4 ~2.3MB) succeeded end-to-end with the
  rebuilt CLI, so the recorded contract is exercised, not assumed.
- Remaining unverified-live surfaces (no assets in the smoke projects, deferred to a
  follow-up): `gflow edit` media-open path, `gflow extend` scenebuilder internals,
  `gflow character` creation/detail fields, `gflow tool` page internals, and the
  agent-instruction sheet's fields.
