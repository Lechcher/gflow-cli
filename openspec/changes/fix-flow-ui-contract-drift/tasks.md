# Tasks

## 1. Live verification of the redesigned Flow contract

- [x] 1.1 Attach to the signed-in Chrome profile in /Users/liberian/Desktop/Projects/video_clone/.gflow/profiles/default over CDP and verify the submit control (icon-only `arrow_forward`, accessible name "Start generation", disabled then enabled once the prompt has text); record findings.
- [x] 1.2 Verify the Agent settings dialog opened from the prompt-bar `tune` (aria-label "Settings") button: both type sections' ratio buttons, `x1..x4` output buttons, the two model dropdowns (aria-labels "Image/Video generation default model"), the "Confirm before generating" Always/Never labels, and the Save control.
- [x] 1.3 Open both model dropdowns and record whether any video duration/length option exists anywhere in Flow; conclude the duration question and update design.md's Open Questions with the answer.
- [x] 1.4 Verify the ingredient picker: open the prompt-bar `+` (aria-label "Add ingredients to the prompt box") control, record the dialog's tabs, upload path, character tiles, and the exact confirm button label.
- [x] 1.5 Verify the remaining command surfaces against the new UI and record selectors: the agent instructions control (aria-label "Agent instructions"), "Create tool" navigation from the left nav and its submit control, and whether `gflow scene`/extend controls are reachable in this project.
- [x] 1.6 Verify dashboard navigation on flow.google.com: open a project by name from a card, and the new-project control (accessible name "New project").

## 2. Centralize the new UI contract

- [x] 2.1 Rewrite `src/flow/locators.ts` to the verified contract (submit by accessible name, prompt-bar buttons by aria-label, prompt box, error/block markers) and verify `npx tsc -p tsconfig.json` compiles.
- [x] 2.2 Move `FLOW_BASE`/`FLOW_URL` to `https://flow.google.com` (browser/session.ts, flow/ui.ts, flow/page.ts) with domain-agnostic `/project/<uuid>` matching and verify navigation tests still pass (`npx vitest run tests/flow.ui.test.ts`).
- [x] 2.3 Update `fixtures/flow/index.html` to the new contract (icon-only submit button with `aria-label="Start generation"` that enables once the prompt has text) and verify the fixture render matches the spec scenarios with a fixture test run.

## 3. Submission and settings (image/video create)

- [x] 3.1 Rework `FlowPage.submit()` (src/flow/page.ts) to activate the "Start generation" control, wait for enabled, and tolerate a confirmation prompt if it appears; verify with the updated fixture test that a create job completes end-to-end.
- [x] 3.2 Add Agent-settings helpers in `src/flow/ui.ts`: open the settings dialog via the `tune` button, section-scoped picking of ratio/outputs/model, set confirmation to automatic, Save, and verify the dialog closed; verify the helpers fail loudly (UiContractError) when a requested value cannot be applied.
- [x] 3.3 Rework `FlowPage.applySettings()` (src/flow/page.ts) to map image/video jobs to the matching Agent-settings section and apply only requested fields; add a fixture-backed test that image and video requests land in the right section and survive a second run.
- [x] 3.4 Confirm the video-duration outcome from task 1.3, wire the behavior (proceed on Flow's default; keep recording the requested duration in metadata) and verify the metadata JSON for a fixture run still carries the requested duration.
- [x] 3.5 Add a test asserting a requested ratio/model that cannot be applied aborts before submit instead of generating with wrong settings.

## 4. Other command surfaces sharing the contract

- [x] 4.1 Update `src/flow/edit.ts` to the new contract (submit by accessible name, open-media and prompt interactions verified live) and verify the existing edit code paths still compile and cover the new locators.
- [x] 4.2 Update `src/flow/characters.ts` and the `referenceCharacter` path in `src/flow/page.ts` to the ingredient picker (aria-label "Add ingredients to the prompt box", recorded tabs/tiles/confirm from task 1.4) and verify with a fixture-backed selection test.
- [x] 4.3 Update `src/flow/agent.ts` to reach the agent controls via aria-labels (agent instructions; instruction add/list/clear fields verified in task 1.5) and verify the agent instruction helpers against a fixture or recorded live evidence.
- [x] 4.4 Update `src/flow/tools.ts` submission to the shared contract (and the create-tool navigation from task 1.5) and verify the tool-create run reaches its wait condition under the updated contract.
- [x] 4.5 Re-verify `src/flow/scene.ts` against the new UI (task 1.5 outcome) and update its submit/add-clip locators if the redesign changed them; verify scene list parsing still matches the project page structure.

## 5. Integration, docs, and archive follow-up

- [x] 5.1 Run the full test suite (`npx vitest run`) and `npx eslint .` and fix failures.
- [x] 5.2 Update README/CLI help: Flow is now flow.google.com; video duration is not enforced when Flow exposes no duration control; generation defaults are applied per project and confirmation is set to automatic; verify the documented commands run as written.
- [x] 5.3 Rebuild the CLI (`npm run build`) and reinstall/relink it so `gflow --version` reports the new build; verify the install.
- [x] 5.4 Live smoke — ask permission first, then run one minimal image generation from /Users/liberian/Desktop/Projects/video_clone to a temp out dir and verify the artifact + metadata download correctly.
- [x] 5.5 Live smoke — run one short video generation from /Users/liberian/Desktop/Projects/video_clone (same out dir rules as 5.4) and verify the video artifact downloads.

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
