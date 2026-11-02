# Design

## Context

Every `gflow` command maps to an automation interface in `src/flow/types.ts` plus a
Playwright page class in `src/flow/*.ts`, launched by a `real*Automation(...)` helper in
`src/cli.ts` and swappable for a fake through `CreateProgramOptions`. The session pipeline
(`src/browser/session.ts`) attaches to the user's signed-in Chrome over CDP, and
`launchLoginChrome` currently opens a plain sign-in window on Flow's URL only. Results are
downloaded through `src/flow/download.ts` and described by `ArtifactMetadata`
(`src/output/artifacts.ts`), whose `type` union is `"image" | "video"`.

Flow Music (flowmusic.app) is a **separate signed-in surface** on a different origin with a
chat-driven "Producer" composer (Lyria 3.5). Its DOM has never been inspected by this
project — verified contracts exist only for flow.google.com — so every selector claim in
this design is a hypothesis that task 1 records live before implementation claims it.
Requirements live in the `flow-music-auth` and `flow-music-generation` spec deltas.

## Goals / Non-Goals

**Goals:**

- A `gflow music` command that turns a structured request into a Flow Music Producer chat
  turn, waits for a completed song, and downloads its audio with standard metadata.
- One login covering both surfaces; `doctor` proving each surface ready.
- Fail-loud everywhere: unreadable request, unready session, unappliable field, blocked or
  timed-out generation — all distinct errors before/around a generation, never a silent
  no-op that spends credits.
- Full testability without a browser (injected `musicAutomation` + offline fixture).

**Non-Goals:**

- Batch `type: music` jobs (schema is shared groundwork; pipeline wiring is a later change).
- Flow Music library, playlists, remix, stem-split, music-video, spaces, or publishing.
- Any change to Flow image/video behavior, settings, or downloads.

## Decisions

**1. Flow Music gets a first-class surface class, not a flag on `FlowPage`.**
`MusicPage implements MusicAutomation` (`src/flow/music.ts`), with `RunMusicInput` /
`MusicSongResult` in `src/flow/types.ts` and `musicAutomation` in `CreateProgramOptions`,
mirroring `CharacterPage`/`AgentPage` exactly. `MusicPage.open()` navigates the CDP session
page to the music URL the way `real*Automation` helpers navigate to Flow.
*Alternative:* extend `FlowPage` to cross origins — rejected: different origin, different
UI contract, and the per-surface automation seam is what keeps tests browser-free.

**2. Structured fields ride a two-tier mapping into the chat.**
Prose fields (style, lyrics, prompt) are **composed into the Producer chat request text**.
Where the live UI exposes a *discrete control* for a field (for example an instrumental
toggle), the control is driven and **verified in place** before submit, exactly like the
Agent-settings picks in `page.ts` — a field that cannot be applied aborts before
generation. Where no control exists, the field travels as prompt prose only and is still
recorded in metadata. The candidate set (`--style`, `--lyrics`, `--lyrics-file`,
`--instrumental`, `--duration`) ships only as far as live verification supports;
`--duration` falls back to the established "accepted and recorded, not enforced" pattern if
Flow Music exposes no length control.
*Alternative:* pass only a raw `--prompt` — rejected by the user's scope choice
(structured flags), and it would lose the record-in-metadata contract.

**3. Auth opens both surfaces in one login window; `doctor` proves both.**
`launchLoginChrome` passes both URLs to Chrome (multiple URL args = multiple tabs), so one
sign-in covers Flow and Flow Music. `openBrowserSession`/session plumbing is unchanged.
`doctor` adds a second readiness check: a new tab on the music URL, ready when the signed-in
studio marker is present, failing with `LoginRequiredError`/`ManualActionRequiredError`
naming Flow Music otherwise; the tab closes before the session disconnects.
`gflow music` re-checks music readiness via `MusicPage` before submitting.
*Alternative:* a separate `gflow auth login music` step — rejected: two logins for one
Google session is friction; `--profile` already separates sessions.

**4. Downloads reuse the proven viewer/event pipeline with an audio type.**
`downloadResult` gains `type: "audio"` with content-type-based extension mapping (mp3/wav/
m4a/ogg/flac/aac), same `waitForEvent("download")` and direct-button/menu handling, and the
data:/fetch fallback for fixtures. `ArtifactMetadata.type` gains `"music"`,
`source` gains `"google-flow-music-browser"`, and request fields (style/lyrics/instrumental/
duration) are recorded as requested.
*Alternative:* a bespoke music downloader — rejected: the download-event machinery
(viewer open, Escape cleanup, gated-tier detection) is proven and shared.

**5. Schema and parsing are shared with the future batch path.**
`musicJobSchema` + `parseMusicJob` in `src/jobs/schema.ts` (explicit TS interface like
`ImageJob`), validated before any browser opens — bad duration, missing lyrics file, empty
prompt all fail at parse with `ZodError` mapped through the CLI's error path.

## Risks / Trade-offs

- **[Entire Flow Music UI contract unknown]** → task 1 records login, composer, submit,
  completion marker, and download control live against the signed-in profile before any
  acceptance claim; unverifiable candidate flags are dropped, not shipped on faith.
- **[Song completion detection differs from a partial/streaming state]** → the wait loop
  requires the completed-song marker recorded in task 1 (e.g. a finished track element or
  an enabled download affordance), not merely a non-empty chat bubble.
- **[Audio download may be plan-gated despite "unlimited downloads"]** → gated control maps
  to `ManualActionRequiredError` like the existing upscale-tier gating.
- **[Song generation is slow (minutes are normal)]** → default timeout in the image-command
  range (900s), tunable via `--timeout`; progress stays observable in the headed window.
- **[A second tab changes `pickFlowPage` behavior]** → music runs open a dedicated tab and
  navigate it; the Flow-tab preference for other commands is untouched.

## Migration Plan

Purely additive: no flags set = today's exact behavior. `auth login`/`doctor` gain a second
surface without changing existing Flow checks. Rollback is a revert. Release follows the
existing automation (`feat:` commit → version bump → npm + JSR publish); no profile or data
migration.

## Live-Verified Contract (recorded Nov 2–3 2026 over CDP against the signed-in `default` profile)

| Surface | Verified structure / behavior |
| --- | --- |
| Signed-out marker | Landing header shows `button "Log in"` + `button "Sign up"` — `doctor` readiness is the **absence** of the header "Log in" button (verified present signed-out, absent after the OAuth walk) |
| Login walk | Landing "Log in" → modal **"Get free studio access"** (heading) → `button "Continue with Google"` → `accounts.google.com/v3/signin/accountchooser` → click the account (`[data-identifier]`) → consent "Sign in to Google Flow Music" (**Continue**) → consent "…wants access to your Google Account" (**Continue**) → `sb.flowmusic.app/auth/v1/authorize?provider=google…` → callback sets `sb-sb-auth-token.0` / `.1` cookies on `www.flowmusic.app` (Supabase session); the Google profile session alone does **not** sign Flow Music in — this walk is required once per profile |
| Auth endpoints | Google OAuth client_id `1032626174130-…apps.googleusercontent.com`, redirect_uri `https://sb.flowmusic.app/auth/v1/callback`; both Continue steps must land on the same tab (an early click before the second consent renders aborts the walk) |
| Studio route | `https://www.flowmusic.app/session?t=true` ("Create song") renders in **both** states; signed-in header drops Log in/Sign up. Signed-out studio shows the **"Create a song"** CTA and an empty player (Play previous track / volume / shuffle / repeat) |
| Composer | `textarea[aria-label="Chat message"]`, placeholder "Describe your song…" (the Producer chat box, present in both states); a second anonymous `textarea` exists on the landing |
| Composer row | Icon buttons in DOM order: `+` **Add audio or image**, **Chat settings** (sliders icon), **Voice mode** (waveform icon), **Send message** (up arrow — the submit) |
| Studio nav | Header links: Create song → `/session?t=true`, Create music video → `/library/videos`, Create playlist → `/library/playlists`, own music space → `/library/spaces`, Profile → `/profile` |
| Client state | `localStorage` keys include `producerChatState` (chat session state), `gtm_signup_…`, `navBarCollapsed` |
| **Submit (task 1.2)** | The composer's **`Send message`** button (aria-label "Send message") is the submit — disabled until the typed prompt registers (~4s), then enabled. "Generate" stays **disabled** in the session chat and is NOT the submit. `pressSequentially` typing registers in React state |
| Completion marker | The greeting "Your Producer is here" is replaced by a session song entry: **`a[href^="/song/<uuid>"]`** (e.g. "Rainy Study Session" → `/song/1da86e55-…`), plus player buttons "Play ", "Like ", "More options for ". No `<audio>` element exists until playback. The Producer may refine the title mid-production ("Rainy Lo-Fi Beat" → "Rainy Study Session") — without asking |
| Timing (task 1.5) | Song card appeared **~35–65s** after submit; a full song runs ~**3 minutes** (verified 179s, 3.1MB AAC-LC). Default timeout 900s covers it |
| Download (task 1.3) | **"More options for <title>"** → menu (Remix / Details / Download / Share… / Add to… / Split stems / Report) → **"Download"** opens a format submenu (Download video / Get stems / **M4A** / **MP3** / **WAV**) → clicking a format fires a native download event, suggestedFilename `"<title>.m4a"` (blob: URL). Verified: 179s, 3.1MB, AAC-LC |
| Error markers (task 1.5) | No block/rate/credit marker was observable in the happy path; the wait loop carries Flow's marker regexes over and fails loud on timeout; a live failing run was not attempted (documented limitation, same honesty convention as the ingredient-row notes) |
| First-run dialog | A **Privacy Notice** dialog (`role=dialog`, a country `<select>`, "Agree") can open over the studio on first load — an automation blocker until agreed |
| Google One grant | A banner "Grant access to your Google One subscription to use your benefits" (Dismiss / Grant access / Agree) — the consent from the OAuth scope; surfaces as a **manual-action** state for `doctor`/`music` if still pending |
| Structured fields (task 1.4) | **All three content candidates are discrete controls**: the Sound and Lyrics sections are **expanded by default** (section buttons carry `aria-label="Collapse <section> section"` + `aria-expanded`) with `textarea[aria-label="Sound description"]` / `textarea[aria-label="Lyrics"]` present; instrumental mode is a DOM-level `button[aria-label="Toggle instrumental mode"]` whose state lives in **`data-state` (unchecked/checked)** — it is outside the accessibility tree, so `getByRole` matches nothing. No duration/length control exists → `--duration` follows the accepted-and-recorded pattern. Studio guidance text: *"describe a style, instrument, or lyrics below"* |
| Panel mechanics (smoke-verified) | The panel textareas render at **zero width** (present, enabled, not Playwright-actionable; `fill`/`click` time out). Values land via **JS focus + real key events** (`page.keyboard.type`) and are read back for verification — verified live: both fields accepted their text and grew (h 24 → 864). Live smoke 1 (before this was known) failed loudly at this point with `UI_CONTRACT_CHANGED`; the fixture models the same contract |
| Composer submit | Studio buttons include both **"Send message"** (chat row) and **"Generate"** — the exact submit semantics for a song request are recorded in 1.2 |
| Media inputs | "+" exposes `input/Upload audio file`, `input/Upload image file`, `input/Capture photo` (the buttons query only matches after the first-run dialog is cleared) |
| Studio starters | "Brainstorm lyrics", "Create a song together", "Remix my music" (each "Save /… to my flows"); sidebar: Songs, Playlists, Spaces, Music videos, Projects, Turntable, Account, Invite, Upgrade |

## Open Questions

- Which candidate flags survive live verification — **Answered for 1.4**: `--lyrics`,
  `--style` (Sound description), and `--instrumental` are discrete controls and ship as
  flags; `--duration` has no control and follows the accepted-and-recorded pattern.
- Whether Flow Music later grows a project/playlist concept worth a `--project` flag —
  additive if it appears.
- The delivered audio format per generation (mp3/wav/…) — recorded from the actual
  download; nothing to decide in advance.
