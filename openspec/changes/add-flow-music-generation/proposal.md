# Proposal: add-flow-music-generation

## Why

gflow automates Google Flow images and videos from the terminal, but Google's music studio —
[Flow Music](https://www.flowmusic.app/), the chat-driven Lyria songwriter — is only reachable
by hand. Users who already drive Flow through their logged-in Chrome session have no way to
create a song from a script or batch-style workflow, and Flow Music is a separate signed-in
surface (its own login and readiness state), so even opening it by hand is a step the CLI
should own. The same "no private APIs, drive the real browser" model that works for Flow
applies directly to songs.

## What Changes

- `gflow auth login` opens **both** surfaces in the plain sign-in Chrome — Flow and Flow
  Music — so one login covers both. `gflow doctor` verifies **both** sessions and reports
  per-surface readiness, failing with the existing login/manual-action errors when either
  surface needs attention.
- New `gflow music` command generates a song from a prompt through Flow Music's Producer
  chat in the signed-in session:
  - Structured request flags let the caller describe the song beyond one line of prose.
    Candidates: `--lyrics` (text or file), `--style`, `--instrumental`, `--duration`.
    Which of these Flow Music actually exposes is decided by **live verification**
    (task 1) before any flag is claimed; unverified flags are not shipped.
  - Generation is **verified, not assumed**: the run waits for a completed song result
    (not just a response bubble) and fails loudly on block/rate/credit/fail markers,
    matching the existing generation-wait contract.
  - The finished song's audio is downloaded through the session, with per-result metadata
    recording the request (prompt, style/lyrics as applicable), source, and URL.
- The Flow Music surface follows the established pattern: a `MusicPage` automation class
  behind a `MusicAutomation` interface with an injectable fake (`musicAutomation` in
  `CreateProgramOptions`), so `gflow music` is testable without a browser — same seam as
  `automation`, `agentAutomation`, etc.
- Structured song fields are validated and parsed in `src/jobs/schema.ts`
  (`musicJobSchema` + `parseMusicJob`), keeping CLI and future batch pipelines on one
  schema, consistent with every other command.

**Out of scope:** batch `type: music` jobs (schema groundwork only), Flow Music's library /
playlists / remix / stem-split / music-video surfaces, publishing, and any change to Flow
image/video behavior.

## Capabilities

### New Capabilities

- `flow-music-auth`: signing in to and verifying the Flow Music surface — one login covers
  Flow and Flow Music; `doctor` proves each surface is ready; music commands fail with the
  standard login/manual-action errors when the session is not ready.
- `flow-music-generation`: generating a song from a structured request through the Flow
  Music Producer chat — waiting for a completed song, downloading its audio artifact, and
  recording per-result metadata.

### Modified Capabilities

- None. No existing main-spec capability changes — `openspec/specs/` holds no published
  capability specs yet, so the Flow auth/doctor behavior this touches is also introduced
  here as the `flow-music-auth` delta.

## Impact

- **Code**: `src/cli.ts` (`auth login` opens both surfaces, `doctor` verifies both, new
  `music` command + `musicAutomation` seam), `src/browser/session.ts`
  (`launchLoginChrome` opens flowmusic.app alongside Flow), `src/flow/music.ts` (new
  `MusicPage`), `src/flow/types.ts` (`MusicAutomation`, `RunMusicInput`, `MusicJobResult`),
  `src/jobs/schema.ts` (`musicJobSchema`, `parseMusicJob`), `src/output/artifacts.ts`
  (`type: "music"` and the structured request fields in `ArtifactMetadata`), new locators
  in `src/flow/locators.ts` for the music studio contract.
- **Tests**: fixture-driven tests for the new command, prompt parsing/validation, the
  fail-loud generation paths, and auth/doctor dual-surface readiness; full-suite,
  lint, and tsc gates.
- **Runtime risk**: the entire Flow Music UI contract (login surface, composer, submit,
  result/audio element, download control) is **unverified** — Flow Music is a Next.js app
  whose DOM has never been inspected by this project. Task 1 records the contract live
  against the signed-in profile before implementation claims anything; flags are accepted
  only where the live UI supports them.
- **Docs**: README (music command, auth behavior, metadata example), CLI help text.
- **Release**: follows the existing automation (`feat:` commit → npm + JSR publish).
