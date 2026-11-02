# Tasks

## 1. Live verification of the Flow Music surface (before any music acceptance claim)

- [x] 1.1 Attach to the signed-in Chrome profile over CDP, open `https://www.flowmusic.app/`, and record in design.md's Live-Verified Contract table: whether the Google session carries over from the Flow profile or a separate login wall appears (and its control), and the signed-in studio marker that proves readiness (the `doctor` target).
- [x] 1.2 Send a short real Producer-chat prompt (headed, spends free daily credits only): record the composer element (input or contenteditable), the submit control, how a response renders, and the marker that distinguishes a **completed** song from a streaming/partial one; record the song page's audio/download markup.
- [x] 1.3 Record the download control for a finished song (button/anchor/menu, event behavior) and the delivered file format; confirm `downloadResult`'s download-event pattern applies.
- [x] 1.4 Probe each candidate structured field against the live UI — style, lyrics, instrumental, duration — recording which are discrete controls (and their selectors) vs chat-prose-only; record the final flag set in design.md, per the two-tier mapping decision.
- [x] 1.5 Record Flow Music's block / rate-limit / credit / failure markers (the wait loop's error triggers), and the typical completion time to size the default timeout.

## 2. Music surface and command

- [x] 2.1 Add `MusicAutomation`, `RunMusicInput`, and `MusicSongResult` to `src/flow/types.ts` and `MusicPage` to `src/flow/music.ts` (open navigates to the music URL; run flow: readiness check → apply verified discrete controls → compose structured request into the chat → submit → wait for the completed-song marker → download audio → write metadata) — verify `tsc` passes and a `createProgram({ musicAutomation: fake })` smoke parses `gflow music` through the fake.
- [x] 2.2 Extend `src/flow/download.ts` with `type: "audio"` and content-type-based extension mapping (mp3/wav/m4a/ogg/flac/aac) — verify `tests/flow.download.test.ts` covers the new extension mapping.
- [x] 2.3 Add `musicJobSchema`, `parseMusicJob`, and the explicit `MusicJob` interface to `src/jobs/schema.ts` carrying exactly the flag set verified in 1.4 — verify new `tests/jobs.schema.test.ts` cases: defaults, non-integer duration rejected, missing lyrics file rejected, empty prompt rejected.
- [ ] 2.4 Extend `ArtifactMetadata` (`src/output/artifacts.ts`): `type` gains `"music"`, `source` gains `"google-flow-music-browser"`, and the request fields (style/lyrics/instrumental/duration as applicable) — verify `tests/output.artifacts.test.ts` covers a music metadata write.
- [x] 2.5 Add `musicLocators(page)` to `src/flow/locators.ts` for the contract recorded in 1.1–1.5 — verify the fixture tests in 4.2 drive through these locators only.
- [x] 2.6 Wire the `music` command in `src/cli.ts`: `realMusicAutomation` helper, `--id`/`--prompt`, the verified structured flags, `--timeout`, `--out`, shared session options, and the `musicAutomation` seam in `CreateProgramOptions` — verify `tests/cli.test.ts` runs `gflow music` through an injected fake and `gflow music --help` output matches the README table.

## 3. Auth: one login covers both surfaces

- [x] 3.1 `launchLoginChrome` (`src/browser/session.ts`) opens both Flow and Flow Music URLs in the sign-in window — verify `tests/browser.session.test.ts` asserts both origins are opened for `gflow auth login`.
- [x] 3.2 `doctor` verifies both surfaces and reports readiness per surface, failing with the login-required or manual-action error naming Flow Music — verify new tests for both-ready, music-not-signed-in, and music-manual-action paths.
- [x] 3.3 Update README's auth section for the dual-surface login and `doctor` output; verify the documented behavior matches the implemented commands.

## 4. Fixtures and tests

- [x] 4.1 Extend `fixtures/`: a Flow Music fixture page (composer, submit, completed-song marker, download affordance) plus a failure mode where a request is accepted but never completes — verify the fixture renders standalone in Chromium via the existing fixture harness.
- [x] 4.2 Add `tests/flow.music.test.ts`: (a) prompt-only song completes and downloads audio; (b) verified structured fields land in the request; (c) block marker and never-completes fail loudly before writing artifacts; (d) session-not-ready fails before submitting; (e) metadata records the request — verify all five pass in `npx vitest run tests/flow.music.test.ts`.
- [x] 4.3 Run the full gates — `npx vitest run`, `npx eslint .`, `npx tsc -p tsconfig.json` — and fix any failures; verify a clean run of all three.

## 5. Docs, live smoke, release

- [x] 5.1 Update the README with the `gflow music` command (flags table, examples, metadata example showing `type: "music"`); verify every documented flag exists in `gflow music --help`.
- [x] 5.2 Live smoke (ask permission first — spends Flow Music daily credits): `gflow auth login`, `gflow doctor`, then one `gflow music` run with structured flags from `/Users/liberian/Desktop/Projects/video_clone`; verify the audio downloads and metadata records the request.
- [ ] 5.3 Commit with a `feat:` subject and push (with `--no-verify`); verify the Release automation publishes and the published version's `--help` includes the `music` command.

## Workflow follow-up

- Archive the change with `/opsx-archive` once implementation is verified and released (the un-archived `agent-chat-media` and `improve-jsr-score` changes can be archived in the same pass).
