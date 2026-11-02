# Tasks

## 1. Live verification (before any acceptance claim)

- [x] 1.1 Attach to the signed-in Chrome profile over CDP, open a project, open the prompt-bar ingredient picker, and attach a local **photo** to an agent chat turn; record the chat ingredient row's markup (`flow-chat-ingredient-row` contents: whether entries expose the file name, thumbnail, or only a count) and the exact attach sequence (open picker → upload → select → row entry appears).
- [x] 1.2 Repeat 1.1 with a local **video** file; record whether Flow accepts video uploads into the chat ingredient row, and conclude the video question in design.md's Open Questions.
- [x] 1.3 Attach an existing **project media asset** by name via the picker's Images and Videos tabs; record the tab labels, tile matching by name, and how the selected asset appears in the ingredient row.
- [x] 1.4 Record how multiple attachments render (order, count) and whether Flow caps attachments per turn; record findings for the verifier design.

## 2. Core implementation

- [x] 2.1 Add shared helpers in `src/flow/ui.ts`: `attachChatMedia(page, { photos, videos, fromProject })` that opens the picker, uploads local files (switching to Images/Videos tabs as recorded in 1.3), selects project assets by name, closes the picker, and `verifyChatAttachments(page, expected)` that requires each requested media item in the chat ingredient row; both fail loudly (`UiContractError`) naming the media at fault.
- [x] 2.2 Extend `RunAgentInput` (`src/flow/types.ts`) with `photos: string[]`, `videos: string[]`, `fromProject: string[]` (default `[]`), and wire `AgentPage.runAgent` to attach media **before** typing the prompt, verify attachments, then submit — mirroring `page.ts`'s attach → fillPrompt → submit order.
- [x] 2.3 Add `--photo <path...>`, `--video <path...>`, and `--from-project <name...>` flags to the `agent` command in `src/cli.ts` (repeatable, resolved relative to cwd), and update the command description/help text.
- [x] 2.4 Add `attachments` (photos/videos/fromProject as requested) to `ArtifactMetadata` (`src/output/artifacts.ts`) and record it from `runAgent`'s metadata write.

## 3. Batch pipelines

- [x] 3.1 Add an `agent` job type to `jobSchema` (`prompt`, `photos`, `videos`, `fromProject`) plus `parseAgentJob`, keeping the discriminated union exhaustive; dispatch agent jobs in `src/jobs/runner.ts` to `AgentPage.runJob`-equivalent (`runAgent`) with the same failure isolation as other job types.
- [x] 3.2 Document the agent batch job (README example) and verify the runner's `--continue-on-failure` behavior for a batch agent job whose media cannot be attached.

## 4. Tests

- [x] 4.1 Extend `fixtures/flow/index.html`: render a chat ingredient row (`[data-chat-ingredients]`) that gains an entry per attached/selected asset, make the picker's Videos tab and upload path work for videos (the fixture's upload input already accepts `image/*,video/*`), and make project-asset tiles selectable from Images/Videos tabs.
- [x] 4.2 Add `tests/flow.agent-chat.test.ts`: (a) an agent run attaches a photo and a project asset and both appear in the ingredient row before submit; (b) a requested project asset that does not exist fails before submit; (c) an upload that never appears in the row fails before submit (fixture mode that accepts the file but renders no row entry); (d) a batch agent job with media runs and records attachments in metadata.
- [x] 4.3 Run the full suite (`npx vitest run`), `npx eslint .`, and `npx tsc -p tsconfig.json` and fix any failures.

## 5. Docs, live smoke, release

- [x] 5.1 Update the README (agent flags, batch agent-job example) and verify the CLI help text reads correctly (`gflow agent --help`).
- [x] 5.2 Live smoke (ask permission first — spends Flow credits): one agent run with a local photo and one with a local video from `/Users/liberian/Desktop/Projects/video_clone`; verify artifacts download and metadata records the attachments.
- [x] 5.3 Bump nothing manually — commit with a Conventional Commit subject and push; the Release automation publishes npm and JSR. Verify the published version's CLI help includes the new flags.

## Workflow follow-up

- Archive the change with `/opsx-archive` once implementation is verified and released.
