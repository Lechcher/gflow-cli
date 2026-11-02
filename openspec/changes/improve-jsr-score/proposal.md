# Proposal

## Why

`@lechcher/gflow-cli` scores only 58% on JSR (verified 2026-11-02 at
https://jsr.io/@lechcher/gflow-cli/score). Seven points are missing: symbol
documentation (0/5 — "Currently 0% of exported symbols are documented"), a
package description (0/1), and runtime compatibility flags (0/2). A low score
makes the package harder to find and signals low quality to anyone evaluating
it on JSR. Five of the seven points are entirely repo-side and currently absent
for one simple reason: the package's four exported symbols have no doc comments.

## What Changes

- Add symbol documentation (JSDoc) to every symbol exported from the single JSR
  entrypoint (`src/cli.ts`): `createProgram`, `resolveVersion`, `runCli`, and
  the `CreateProgramOptions` interface including its six properties. Each public
  function gets a summary, parameter descriptions, and a usage `@example` block
  rendered on the jsr.io docs page.
- No API changes: exports, signatures, and runtime behavior are untouched — only
  comments are added.
- Ship the docs as a patch release (1.2.1) through the existing release
  workflow (docs-only commits do not trigger a release, and the JSR score only
  reflects published versions), then publish to JSR via the established manual
  `workflow_dispatch` of `jsr.yml` (the release bot's commit is pushed with
  `GITHUB_TOKEN`, which never re-triggers workflows).
- End with exact manual steps for the two settings-only items that no
  repository file or CLI command can set: the package description and the
  Node/Bun runtime compatibility flags on the jsr.io package settings page.
  Together these take the score from 58% to 100%.

## Capabilities

### New Capabilities
<!-- none: this change adds comments and ships a release; no runtime behavior changes -->
- `<none>`: this is a pure documentation change — `skip_specs: true` is set in
  `.openspec.yaml` because no system behavior changes (JSDoc comments do not
  alter the CLI's observable behavior).

### Modified Capabilities
<!-- none -->

## Impact

- `src/cli.ts` — JSDoc comments on `CreateProgramOptions` (+properties),
  `resolveVersion`, `createProgram`, `runCli`. The file's module-doc status is
  already complete and must be preserved.
- Published artifacts — npm `@lechcher/gflow-cli@1.2.1`, JSR
  `@lechcher/gflow-cli@1.2.1`, GitHub release `v1.2.1`.
- Verification — `npx tsc -p tsconfig.json`, `npx vitest run`, `npx eslint .`
  must stay green (comments only), and `npx jsr publish --dry-run --allow-dirty`
  must pass.
- Out of scope — jsr.io package *settings* (description, runtime compatibility):
  these live on the jsr.io website, cannot be set by the `jsr` CLI (verified:
  it exposes only `publish`, `add`, `info`), and are handed to the user as
  manual steps.
