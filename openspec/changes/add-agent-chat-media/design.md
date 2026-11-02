## Context

`gflow agent` fills the prompt box and submits — no media path exists. The ingredient-picker
contract from `fix-flow-ui-contract-drift` is already proven for the create surfaces
(`--character`, frames, `edit` references) and is fixture-tested: the prompt-bar "+" opens a
tab panel (All/Images/Videos/Voices/Characters/Avatars/Uploads) with an "Upload media" control,
selection-based, Escape to close.

Live inspection of the redesigned project page recorded the agent chat's DOM:
`flow-agent-panel > flow-chat-view > flow-chat-scroller > flow-chat-bubble`,
`flow-chat-ingredient-row`, and `flow-structured-prompt-text`. The draft turn and the prompt
box are the same composer, which is why the prompt-bar picker is the attach surface.

In `page.ts` the proven order is: apply settings → attach media (characters, frames) → type the
prompt → submit.

## Goals / Non-Goals

**Goals**

- Attach photos, videos, and project media to an agent chat turn before submitting.
- Verify attachments are present in the chat's ingredient row before submit; fail loudly
  otherwise (same contract as settings picks).
- Record attachments on artifact metadata; script agent-with-media jobs in batch.

**Non-Goals**

- Multi-turn chat continuation (no chat identity exists; separate future change).
- Changing how agent settings, prompts, or result detection work.
- Fixing the never-verified `agent instruction add --ref` path (separate surface).
- Any claim that a specific attached video affects the output in a specific way — Flow's agent
  decides what to do with references.

## Decisions

**1. Reuse the existing picker helpers; no new Flow UI surface.**
`openIngredientPicker` / `pickIngredientTab` / `uploadIngredientMedia` / `pickIngredientAsset` /
`closeIngredientPicker` in `src/flow/ui.ts` already drive the shared picker, and the "Upload
media" path is proven for images. The chat draft and the prompt bar are the same composer, so
the prompt-bar "+" is the chat's attach control.
*Alternative:* a chat-panel-specific attach path — rejected: no evidence the chat has its own
attach control, and a second path would double the contract drift surface.

**2. Attach media before typing the prompt.**
Mirrors `page.ts`'s proven order (characters/frames attach, then `fillPrompt`, then submit) and
keeps attachments on the *draft* turn — attaching after typing risks the attachment landing on
a submitted message or the draft being reset.
*Alternative:* type-then-attach — rejected on the draft-turn risk.

**3. Verify each attachment in the chat ingredient row before submit.**
After picking, the automation requires the requested media to be present in
`flow-chat-ingredient-row` (matched by normalized name where Flow exposes one, else by count of
media entries in the row). Missing/failed uploads fail with `UiContractError` naming the media.
*Alternative:* trust the picker click — rejected: a silent miss generates without references,
exactly the failure class the redesign work removed (settings picks are verified in place for
the same reason).

**4. Video support is mechanically identical but acceptance-gated on live verification.**
Only images have been exercised through the picker (characters, frames). The picker's Videos
tab and its upload control (advertises image/video) suggest videos work, but this is unproven.
Task 1 verifies it live. If Flow cannot take videos into the chat, the video flags fail loudly
with a documented limitation rather than silently ignoring the flag.
*Alternative:* ship video flags on a best-effort basis — rejected (silent no-op on `--video`
would spend credits generating without the reference).

**5. Batch gains an agent job type.**
`jobSchema` becomes a union of image / video / agent; `RunAgentInput` gains
`photos: string[]`, `videos: string[]`, `fromProject: string[]`; `runner.ts` dispatches agent
jobs to `AgentPage.runAgent` the way it dispatches image/video to `FlowPage`. Field names are
snake-free camelCase like the rest of the YAML schema (`startFrame`, `fromProject`).
*Alternative:* keep agent out of batch — rejected; the chosen scope includes scripting.
Failure isolation is unchanged and identical to other job types: an attach failure is a
`UiContractError` (the UI could not be verified), which the runner treats as a hard stop even
with continue-on-failure — the same way an unappliable ratio/model stops an image job.

**6. Metadata records the requested attachments.**
`ArtifactMetadata` gains an optional `attachments` object (photos, videos, fromProject as
requested — paths and names), matching the existing flat, explicit style.

## Risks / Trade-offs

- **[Video upload/attachment unverified live]** → live verification task precedes any "video
  works" claim; on failure the flags fail loudly with the limitation documented.
- **[Ingredient-row entry DOM unknown in detail (does Flow show the file name?)] **→ the
  verifier matches loosely (media element present + normalized name when available), and the
  task tightens the selector against live markup before the spec scenarios are claimed done.
- **[Flow may cap attachments per turn]** → not assumed; the fail-loud path reports what is
  missing, which also surfaces a cap. No cap handling is designed in.
- **[Agent runs still don't apply Agent settings (unchanged behavior)] → out of scope; the chat
  turn uses the project's existing defaults, as today.
- **[Uploads are slow for large videos]** → reuse the existing upload wait budget
  (`uploadIngredientMedia` already polls for the asset tile); timeout failures surface as the
  "upload never appeared" error.

## Migration Plan

Purely additive: no flags set = today's exact behavior. Rollback is a revert. Release follows
the existing automation (`ci:`/`feat:` commit → npm + JSR publish). No data or profile
migration: attachments never touch the browser profile beyond normal upload behavior.

## Live-Verified Contract (recorded Nov 1–2 2026 over CDP; re-verified with real files)

| Surface | Verified structure / behavior |
| --- | --- |
| Picker | Prompt-bar "+" (`aria-label="Add ingredients to the prompt box"`) opens a CDK overlay with a **side-nav project selector** (`mat-select[aria-label="Select project"]`, value = project name — NOT an asset; do not mistake it for a tile) and tab list `[role=tab]`: All / Images / Videos / Voices / Characters / Avatars / Uploads (each rendered with an icon-ligature prefix, e.g. `imageImages`, `drive_folder_uploadUploads`, so match with `/Images$/`) |
| Asset tiles | `.asset-text > .asset-title` (the media name) + `.type-subtitle` (e.g. `Video`), inside `.asset-item-container`. **Uploaded assets are titled by their filename** (e.g. `dffgh.jpg`), not a timestamp |
| Attach mechanism | **Select the tile, then click the picker's single "Add to prompt" control** (the detail pane's button applies to the selected asset; tiles are not per-tile buttons). The picker **closes after each attach**, so it is reopened per item. A file already in the project is not re-uploaded (avoids duplicate assets on re-runs) |
| Verification target | `flow-ingredient-bar flow-ingredient-chip` — one chip per attachment. Chip internals: `flow-image-ingredient-chip` / `flow-video-ingredient-chip > button.chip-container[aria-label="Ingredient"] > img[alt="Ingredient image" \| "Video ingredient image"]`. Chips carry **no filename/name text**, so verification is count-based |
| Photo upload | **Works**: real 584KB JPEG appeared in ~5s under the Uploads tab; an 8KB PNG eventually appeared (>90s). Attach via its tile's "Add to prompt" → `flow-image-ingredient-chip` |
| Video upload | **Inert (verified, silent)**: a 6.7MB HEVC clip and a 2.3KB H.264 clip both never produced an asset (10min / 2min watches; no toast, no error). Not automatable through any surface: picker "Upload media" (chooser fires, file delivered, nothing), Add-media menu → Upload (tooltip only), or drag-and-drop |
| Project-asset attach | Works for images **and** videos (chip within ~2s) |
| Multiple attachments | Verified: chips accumulate 1 → 2 → 3 in one draft |

## Open Questions

- ~~The stable selector for an ingredient-row entry~~ — **Answered**: `flow-ingredient-bar flow-ingredient-chip` (see table above).
- ~~Whether Flow accepts multiple attachments~~ — **Answered**: N chips for N attachments, verified 1→2→3, and verified end-to-end through the CLI smoke.
- ~~What uploaded assets are titled~~ — **Answered**: by filename (not timestamp).
- ~~How an asset is attached~~ — **Answered**: select the tile, then the picker's single "Add to prompt"; the picker then closes. (An earlier per-tile-button assumption was wrong and was corrected against live testing.)
- **Known limitation (not a blocker): video file upload.** Flow silently ignores uploaded video
  files (both HEVC and H.264 tested live). `--video <path>` therefore fails at the runtime
  verification with the spec's "attachment did not appear" error — verified in the live smoke,
  which aborted before submitting with the documented message. Photos upload fine;
  project videos attach fine. Revisit if Flow's upload starts accepting video.
