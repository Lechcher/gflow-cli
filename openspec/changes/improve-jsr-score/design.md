# Design

## Context

See proposal.md for motivation. Current state, all verified 2026-11-02:

- **Score breakdown** (jsr.io/@lechcher/gflow-cli/score): complete = readme/module
  doc 2/2, examples 1/1, module docs in all entrypoints 1/1, no slow types 5/5,
  provenance 1/1. Missing = **symbol docs 0/5** ("0% of exported symbols are
  documented"), description 0/1, one compatible runtime 0/1, two compatible
  runtimes 0/1. Total 10/17 = 58%.
- **Export surface**: `jsr.json` declares exactly one entrypoint
  (`"exports": "./src/cli.ts"`). Its exported symbols are exactly four —
  `createProgram`, `resolveVersion`, `runCli`, `CreateProgramOptions` (six
  properties) — and the jsr.io docs page shows every one as "No documentation
  available". 3 of 4 symbols would be 75%, so the 80% threshold requires
  **all four** anyway.
- **Score is version-bound**: JSR scores the *latest published version*, so
  nothing below registers until a new version is published.
- **Release workflow** (release.yml): bump is derived from Conventional Commit
  subjects since the last `v*` tag — `feat!: …!` → major, `feat:` → minor,
  `fix:`/`perf:`/`refactor:` → patch, `docs:`/`ci:`/`chore:`/`test:`/`style:` →
  **no release**. The bump commit is pushed with `GITHUB_TOKEN`, which GitHub
  never re-triggers workflows from — so jsr.yml (which filters on
  package.json/jsr.json/jsr.yml changes and syncs jsr.json's version from
  package.json) must be manually dispatched after every npm release; this is
  the established 1.2.0 pattern.
- **The jsr CLI is publish-only** (verified `jsr@0.14.3 --help`: `publish`,
  `add`, `info`). Package description and runtime compatibility are jsr.io
  website settings with no CLI or API path.

## Goals / Non-Goals

**Goals:**

- All four exported symbols documented with JSDoc that renders usefully on the
  jsr.io docs page (summary, params/return, `@example` for the three functions,
  per-property docs on `CreateProgramOptions`) → symbol docs 5/5 → 15/17 ≈ 88%.
- Ship as 1.2.1 through the existing CI so the score actually moves, with the
  full test/lint/tsc/dry-run gate chain intact.
- Hand the user precise, closing instructions for the two website-only settings
  items → 17/17 = 100%.

**Non-Goals:**

- No API changes (signatures, exports, behavior, new flags).
- No README restructure — readme, examples, and module-doc items already score
  complete; touch nothing that can regress them.
- No changes to release.yml/jsr.yml semantics.
- No new CI guard for doc coverage (mentioned in Risks as a follow-up, not
  built here).

## Decisions

1. **Document 4/4 symbols, not "just enough".** The 80% threshold on four
   symbols requires all four anyway (3/4 = 75% fails), so a partial pass is
   worse in every way than a complete one. *Alternative: minimal one-line
   comments — rejected; the jsr.io doc page is the public face of the library
   API, and `@example` blocks cost nothing extra.*

2. **Docs live only in `src/cli.ts` JSDoc.** Single source of truth, picked up
   by `jsr publish`'s doc analysis; no parallel docs system to drift.
   *Alternative: separate docs site — out of scope.*

3. **Release with a `fix:` subject.** `docs:` yields bump=none in release.yml
   (verified), and the package is genuinely carrying a documentation defect on
   a published artifact — fixing it is honestly a fix. The commit subject stays
   conventional so CI computes the patch bump unprompted.
   *Alternative: teach release.yml to bump on `docs:` — rejected: global
   release-semantics change for a one-off; the 1.2.0 flow already releases
   patch-level fixes this way.*

4. **Website settings stay manual.** Verified no CLI/API path exists. The tasks
   end with exact click-level steps (jsr.io → package → Settings) and the
   post-check (score page 17/17, "Works with" badges). A suggested description
   string is included in the tasks for convenience; the user may word it
   differently.

5. **Verification is layered.** Locally: tsc/vitest/eslint must stay green
   (comments only) and `npx jsr publish --dry-run --allow-dirty` must pass
   (catches slow-type breakage; doc coverage is *not* checked locally). After
   publish: the jsr.io `/doc` page must show real descriptions for all four
   symbols and no "No documentation available", and the score page's symbol-docs
   item must read 5/5.

## Risks / Trade-offs

- **Score lags the publish** → JSR rescored within minutes for 1.2.0; re-check
  the score page a few minutes after the JSR dispatch and before reporting done.
- **Module-doc regresses** (currently 1/1) → only add comments; never remove or
  rewrite the file-top documentation of the entrypoint, and keep the README as
  the readme-side module doc it already satisfies.
- **Inaccurate `@example` code** → JSR does not typecheck examples, so keep them
  copy-pasteable and real: the injected-fakes pattern matches how tests drive
  `createProgram`, and the CLI examples use flags that exist in the published
  help output.
- **Settings drift back to "unknown"** if a future version is published without
  re-marking runtimes → settings persist per package, not per version; nothing
  to do, but note it when the next release ships.
- **Doc coverage can silently regress later** (a future contributor adds an
  export without JSDoc) → follow-up candidate: a tiny CI check that fails when
  `src/cli.ts` gains an export without a preceding doc comment. Not built here.

## Migration Plan

1. Land the JSDoc commit (`fix:` subject); CI runs lint/test → patch bump
   1.2.1 → npm publish + GitHub release.
2. Manually dispatch `jsr.yml` (push filters never fire for the bot's commit);
   it repins jsr.json to 1.2.1 and publishes.
3. Verify /doc page + score → expect 15/17 (88%).
4. User sets description + marks Node and Bun compatible in jsr.io package
   settings → verify 17/17 (100%).
Rollback: none needed — comments are inert; a bad publish can be followed by a
`fix:` commit.

## Open Questions

None. The exact wording of the package description is the user's call; the
tasks include a suggestion only.
