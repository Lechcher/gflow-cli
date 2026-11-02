# Proposal: add-agent-chat-media

## Why

`gflow agent` can send the Flow Agent a text prompt, but it cannot give the agent photos or
videos to work from. Flow's redesigned chat has an ingredient row for exactly this, so today a
user must attach media by hand before running gflow — which defeats unattended runs, and leaves
the most useful agent workflows (edit this photo, extend that clip, match this style) out of
reach from the CLI and from batch pipelines.

## What Changes

- `gflow agent --prompt "<text>"` gains media flags: `--photo <path...>` and `--video <path...>`
  for local files, and `--from-project <name...>` for media already in the project. Media is
  attached to the chat turn through the prompt-bar ingredient picker **before** the prompt is
  submitted.
- Attachment is **verified**, not assumed: each requested photo/video must be visible in the
  chat's ingredient row before submit. A media item that cannot be found or uploaded fails the
  run with a clear error before any generation starts.
- Batch pipelines gain `type: agent` jobs carrying `prompt`, `photos`, `videos`, and
  `fromProject`, so agent runs with media can be scripted alongside image/video jobs.
- Artifact metadata records which media was attached to the run, so outputs stay traceable to
  their references.
- Reuses the ingredient-picker contract established by the `fix-flow-ui-contract-drift` change
  (prompt-bar "+" control, tab panel, "Upload media"); no new Flow UI surface is required.

**Out of scope:** continuing an existing chat thread (multi-turn "reply to that result") — gflow
has no chat-identity concept today; the persistent agent-instruction `--ref` path (separate
surface, never verified live); and any change to how agent settings or results are detected.

## Capabilities

- **New Capabilities**
  - `agent-chat-media`: attaching photos and videos to a Flow agent chat turn — selecting local
    files and existing project media through the ingredient picker, verifying they are attached
    to the chat, and recording them on the resulting artifacts.
- **Modified Capabilities**
  - None. No existing main-spec capability changes; the ingredient-picker contract this builds
    on is defined by the `fix-flow-ui-contract-drift` change delta, which stays authoritative.

## Impact

- **Code**: `src/flow/agent.ts` (attachment + verification in `runAgent`), `src/flow/types.ts`
  (`RunAgentInput`), `src/flow/ui.ts` (shared attach helpers over the existing picker helpers),
  `src/cli.ts` (agent flags), `src/jobs/schema.ts` + `src/jobs/runner.ts` (batch `type: agent`).
- **Tests**: fixture-based tests for attachment and verification, plus the fail-loud paths
  (missing asset, upload that never appears); live smoke against the redesigned Flow.
- **Runtime risk**: whether Flow's picker accepts **video** uploads and shows them in the chat
  ingredient row is unverified live — the picker exposes Images/Videos/Uploads tabs and its
  upload control advertises image/video, but only images have been exercised. A live
  verification task comes before any "video works" acceptance is claimed.
- **Docs**: README (agent command flags, batch example), CLI help text.
