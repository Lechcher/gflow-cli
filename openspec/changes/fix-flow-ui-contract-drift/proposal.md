# Proposal

## Why

Google Flow shipped a redesigned UI (`flow.google.com`, Angular Material controls) that
broke gflow's text-based Playwright locators. Every `gflow image` and `gflow video` run
now dies at the submit step:

```
locator.waitFor: Timeout 15000ms exceeded.
  - waiting for locator('button').filter({ hasText: 'Create' })
      .filter({ hasText: /arrow_forward/ }).first() to be visible
```

The submit button is no longer a `arrow_forwardCreate` button — it is now an icon-only
button with `aria-label="Start generation"`. The same redesign left the rest of the
shared locator surface stale (settings pill, character/`add_2` pickers, agent controls,
tool submission), so all commands that share `src/flow/locators.ts` are affected.

## What Changes

- Update the Flow UI contract in `src/flow/locators.ts` to the redesigned controls:
  - **BREAKING (against the old UI only):** the generation submit button is identified by
    its accessible name (`Start generation`), not by the text `Create` plus the
    `arrow_forward` icon.
  - Per-prompt generation settings (mode Image/Video, aspect ratio, output count, model,
    video duration) no longer exist as prompt-bar pills. Applied per project instead, in
    the **Agent settings** dialog opened from the prompt-bar `tune` (aria-label
    `Settings`) button: *Image generation default* (ratio, x1–x4, model), *Video
    generation default* (ratio, x1–x4, model), and *Confirm before generating*.
- Update the Flow base URL/domain from `labs.google/fx/tools/flow` to `flow.google.com`
  (keep tolerating the legacy redirect).
- Fix the other commands that share the locator module: `gflow edit`, `gflow extend /
  scene list`, `gflow tool`, `gflow character`, `gflow agent` selection and submission.
- Video `--duration`: verify the duration surface during implementation (model menus and
  any per-prompt control). If Flow exposes no duration control, accept the model default
  and document the gap in the change artifacts and CLI help.
- Set *Confirm before generating* to **Never** (failure-safe: also tolerate a confirm
  dialog if it appears) so unattended runs are not blocked by the default *Always*.

## Capabilities

### New Capabilities

- `flow-ui-contract`: How gflow discovers and drives Google Flow's UI — the generation
  submit control, the Agent-settings dialog (image/video defaults, confirm-before-
  generating), project navigation on the Flow dashboard, media/character pickers, and
  the command surfaces that share them. Owns the requirements every automation command
  depends on, and is updated whenever Flow's UI changes.

### Modified Capabilities

- (none — this project has no existing specs under `openspec/specs/`)

## Impact

- Code: `src/flow/locators.ts` (rewritten contract), `src/flow/page.ts` (settings +
  submit), `src/flow/ui.ts` (settings/dialog helpers), `src/flow/edit.ts`,
  `src/flow/scene.ts`, `src/flow/tools.ts`, `src/flow/characters.ts`,
  `src/flow/agent.ts` (command surfaces), `src/browser/session.ts` (Flow URL), plus the
  fixtures/tests that encode the old contract.
- Behavior: `--duration` for video may no longer be settable per prompt (documented
  gap); per-project generation defaults are written once per project instead of per
  prompt; the automation sets *Confirm before generating* to Never.
- Users must reinstall/rebuild the CLI (the installed `gflow` binary is a published
  package); verification runs against the live signed-in profile in
  `/Users/liberian/Desktop/Projects/video_clone/.gflow/profiles/default`.
