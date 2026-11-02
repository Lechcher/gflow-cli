<div align="center">

<img src="https://raw.githubusercontent.com/Lechcher/gflow-cli/main/assets/logo.svg" alt="gflow" width="460">

# gflow-cli

**Generate images and videos with [Google Flow](https://flow.google.com) from your terminal.**

`gflow` drives Flow inside your own logged-in Google Chrome, so it works as a normal, human
browser session — no private APIs, no login bypass.

[![CI](https://github.com/Lechcher/gflow-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Lechcher/gflow-cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@lechcher/gflow-cli)](https://www.npmjs.com/package/@lechcher/gflow-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

<br>

<img src="https://raw.githubusercontent.com/Lechcher/gflow-cli/main/assets/demo.gif" alt="gflow demo: auth login, doctor, image and video generation" width="760">

</div>

---

## Features

- 🖼️ **Image generation** — Nano Banana 2 / 2.1, Nano Banana Pro
- 🎬 **Video generation** — Omni 1.1 Flash, Veo 3.1 (Lite / Fast / Quality)
- 🎛️ **Per-project defaults** — model, aspect ratio, output count, applied to Flow's Agent
  settings before submit and verified in place
- 📦 **Batch pipelines** — run many jobs from one YAML file
- ⬆️ **Full-quality downloads** — pulls Flow's native asset via the in-app Download menu;
  add `--upscale 2k` or `--upscale 4k` for upscaled tiers
- 🎬➕ **Scene extend** — chain prompts to grow a video ~7s at a time (up to 148s) and append
  other clips, building long videos with a real story
- 🧑‍🎨 **Characters** — create and reuse saved character references across generations
- 🛠️ **Tools** — build and open custom Flow tools (image-filter, style-morph, etc.)
- 🤖 **Agent** — drive the Flow Agent with a prompt, configure its defaults, and manage
  persistent instructions
- 🔒 **Your session** — attaches to the Chrome you log into; nothing is stored beyond the
  browser profile on your disk

## What changed in Flow (and how gflow handles it)

Flow's redesign moved the app to **flow.google.com** and rebuilt the prompt around the
Agent. Controls that gflow used to set per prompt are now **per-project settings**:

| Old Flow (per prompt) | Redesigned Flow (per project) |
| --------------------- | ----------------------------- |
| Mode switch (Image / Video / Frames) | No mode switch — Flow's agent routes; gflow passes your job type and sets the matching **Agent settings** section |
| Duration picker (4s / 6s / 8s / 10s) | No duration control — length follows the chosen **video model** |
| Frames mode (Start / End slots) | No frame slots — frame images attach as **references** via the ingredient picker |
| Ratio / outputs / model pills | The **Agent settings** dialog (`tune` button): separate *Image* and *Video* default sections |
| "Confirm before generating: Always" gate after submit | gflow sets **Never** when it applies your job's settings, and tolerates a confirmation prompt if a project still has one enabled |

What this means for you:

- `--model`, `--ratio`, `--outputs` still work exactly as before — gflow opens Agent settings,
  picks your values in the section matching the job type, verifies each pick took effect, and
  saves before submitting. If a value isn't offered, the job **fails before spending credits**
  instead of generating with the wrong settings.
- `--duration` is **accepted and recorded in the output metadata**, but no longer enforced —
  Flow sets video length by model.
- `--start-frame` / `--end-frame` attach the images as generic references; Flow no longer lets
  gflow assign them to first/last-frame positions.
- Project-level defaults persist across runs, so the second run in the same project starts
  from your last-applied settings — gflow re-applies the job's values each time.

## How it works

`gflow` never spawns a hidden automation browser (Google challenges those with repeated 2FA).
Instead:

1. `gflow auth login` opens a **plain Google Chrome** (no remote-debugging flags) so you can
   sign in normally — Google blocks sign-in in browsers with remote debugging enabled
   ("this browser or app may not be secure").
2. You sign in once (including any 2FA) in that window.
3. The first automation command (`doctor`, `image`, …) hands that window over to an
   **automation session**: it reopens the same, now signed-in, profile with a debugging port
   and attaches over the Chrome DevTools Protocol (`connectOverCDP`). It only ever loads Flow
   with valid cookies — never the accounts sign-in page — so the block never applies.
4. From then on, commands reuse that window, drive Flow's normal UI, and download results
   through Flow's own authenticated media URLs.

## Requirements

- **Node.js >= 20**
- **Google Chrome** (the real browser — not bundled Chromium)
- A Google account with access to Google Flow

## Install

### From npm (global)

```bash
npm install -g @lechcher/gflow-cli
```

This puts a `gflow` command on your `PATH`.

### From source

```bash
git clone https://github.com/Lechcher/gflow-cli.git
cd gflow-cli
npm install
npm install -g .      # exposes `gflow` globally
```

If Chrome is installed in a non-standard location, point `gflow` at it:

```bash
export GFLOW_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

## Quickstart

```bash
# 1. Sign in (opens a plain Chrome — just complete the Google login)
gflow auth login

# 2. Verify the session (reopens Chrome as an automation session)
gflow doctor

# 3. Generate
gflow image --id hero --prompt "minimal editorial product still" --out ./out
gflow video --id reveal --prompt "slow dolly over a misty lake" --model "Veo 3.1 - Fast" --out ./out
```

> After `doctor`, keep the automation Chrome window open between commands — it's your live
> session. If you close it, the next command reopens it from your saved login. If you ever get
> signed out, run `gflow auth login` again.

## Commands

### Shared options

Every command that opens Flow accepts these session options:

| Option             | Default   | Description                                         |
| ------------------ | --------- | --------------------------------------------------- |
| `--project <name>` | —         | Flow project to work in                             |
| `--profile <name>` | `default` | Named browser profile (separate logged-in sessions) |
| `--browser <name>` | `chrome`  | Browser channel: `chrome` or `chromium`             |
| `--headed`         | on        | Show the browser window                             |
| `--no-headed`      | —         | Run the browser hidden                              |

---

### `gflow auth login`

Opens a **plain** Chrome (no remote-debugging flags) on the Flow page with an isolated profile
(`.gflow/profiles/<name>`). Complete the Google login here — signing in must happen in an
ordinary window, or Google rejects it as "not secure". The next command takes the session over
for automation.

```bash
gflow auth login
gflow auth login --profile work
```

### `gflow doctor`

Attaches to your Flow window (or launches one) and confirms you're signed in and ready.

```bash
gflow doctor
gflow doctor --no-headed        # session check without a visible window
```

### `gflow image`

Generate an image from a text prompt.

| Option                  | Default          | Description                                                                    |
| ----------------------- | ---------------- | ------------------------------------------------------------------------------ |
| `--id <id>`             | _required_       | Job id (used in output filenames)                                              |
| `--prompt <text>`       | _required_       | Generation prompt                                                              |
| `--model <name>`        | Flow default     | `Nano Banana 2.1`, `Nano Banana 2 Lite`, `Nano Banana Pro`                     |
| `--ratio <ratio>`       | Flow default     | `16:9`, `4:3`, `1:1`, `3:4`, `9:16`                                            |
| `--outputs <n>`         | `1`              | Number of images (1–4)                                                         |
| `--character <name...>` | —                | Reference one or more saved characters                                         |
| `--upscale <tier>`      | —                | Download upscaled output: `2k` or `4k` (4K requires a Flow plan that allows it) |
| `--timeout <seconds>`   | `900`            | Generation timeout                                                             |
| `--out <path>`          | `./gflow-output` | Output directory                                                               |

```bash
gflow image --id hero --prompt "minimal editorial product still" --ratio 16:9 --out ./out
gflow image --id cast --prompt "Merlin in the library" --character Merlin --outputs 2
```

### `gflow video`

Generate a video from a prompt. Accepts every `image` option, plus:

| Option                  | Default          | Description                                                                                                                           |
| ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--model <name>`        | Flow default     | `Omni 1.1 Flash`, `Veo 3.1 - Lite/Fast/Quality`                                                                                       |
| `--ratio <ratio>`       | Flow default     | `16:9`, `9:16` (the set Flow offers for the video defaults section)                                                                    |
| `--duration <seconds>`  | —                | Requested length; **recorded in the output metadata only** — the redesigned Flow has no per-prompt duration control, so length follows the chosen video model |
| `--start-frame <path>`  | —                | First-frame image, attached as a reference                                                                                            |
| `--end-frame <path>`    | —                | Last-frame image, attached as a reference                                                                                             |
| `--timeout <seconds>`   | `1800`           | Generation timeout                                                                                                                    |

Model names are matched loosely, so `--model veo-3.1-fast` and `--model "Veo 3.1 - Fast"` are
equivalent.

```bash
gflow video --id reveal --prompt "slow dolly over a misty lake" --model "Veo 3.1 - Fast" --out ./out

# reference frame images while generating
gflow video --id morph --prompt "smooth cinematic transition" \
  --start-frame ./first.png --end-frame ./last.png --out ./out
```

`--end-frame` is optional (provide only `--start-frame` to reference a single first frame).

### `gflow batch`

Run multiple jobs from a YAML pipeline.

```bash
gflow batch pipeline.yaml --out ./out
gflow batch pipeline.yaml --continue-on-failure   # keep going after ordinary failures
```

```yaml
# pipeline.yaml
jobs:
  - id: shot-1
    type: image
    prompt: "a neon-lit alley at night"
    ratio: "16:9"
    model: "Nano Banana 2.1"
  - id: clip-1
    type: video
    prompt: "rain falling on the alley"
    duration: 8          # recorded only; Flow sets length by model
    startFrame: ./first.png
  - id: hero-agent
    type: agent          # runs the Flow Agent; media is attached to the chat turn
    prompt: "turn the alley shot into a moody poster"
    photos:
      - ./alley-ref.png
    fromProject:
      - "Dolly over misty lake"
```

Agent jobs accept `prompt`, `photos`, `videos`, and `fromProject` (names from
`gflow media list`). Each requested item is attached and verified before the prompt is sent;
if any cannot be attached, that job fails without generating and the pipeline continues only
with `--continue-on-failure`, like every other job type.

Jobs run serially. `--continue-on-failure` keeps going after ordinary generation errors.

### `gflow edit`

Edit an existing image or video in a project by describing the change. Both subcommands need
the media id from `gflow media list`.

#### `gflow edit image`

| Option                  | Default          | Description                                       |
| ----------------------- | ---------------- | ------------------------------------------------- |
| `--media-id <id>`       | _required_       | Media to edit (find ids with `gflow media list`)  |
| `--prompt <text>`       | _required_       | Describe what to change                           |
| `--reference <path...>` | —                | Reference image(s) to upload                      |
| `--from-project <name...>` | —             | Reference asset name(s) from the project          |
| `--timeout <seconds>`   | `900`            | Generation timeout                                |
| `--out <path>`          | `./gflow-output` | Output directory                                  |

#### `gflow edit video`

Same options, tuned for video editing (`--reference` accepts reference media).

```bash
gflow media list

gflow edit image --media-id 9b14ed49-5534-4b2e-bcf6-345b539dddd3 \
  --prompt "change the sky to a dramatic sunset" --out ./out
```

### `gflow media list`

List all images and videos in the project with their unique ids (the ids you pass to
`gflow edit` and `gflow extend`).

```bash
gflow media list
gflow media list --project my-film
```

### `gflow character`

Create and manage saved character references that can be reused in `image` and `video`
generations via `--character <name>`.

#### `gflow character create`

| Option                     | Default          | Description                                         |
| -------------------------- | ---------------- | --------------------------------------------------- |
| `--prompt <text>`          | _required_       | Character description                               |
| `--name <name>`            | _required_       | Label for the character                             |
| `--description <text>`     | —                | Character info (how the character acts)             |
| `--voice <voice>`          | —                | Voice to assign to the character                    |
| `--model <model>`          | Flow default     | `nano-banana-2` or `nano-banana-pro`                |
| `--preset <preset>`        | —                | `familiar`, `eccentric`, `wicked`, or `fantastical`  |
| `--image <path...>`        | —                | One or more reference images to upload              |
| `--from-project <name...>` | —                | Reference asset name(s) from the current project    |
| `--out <path>`             | `./gflow-output` | Output directory (thumbnail saved here)             |

```bash
gflow character create --prompt "a cheerful red-haired wizard" --name Merlin --preset fantastical

# Reference an existing image as a starting point
gflow character create --prompt "heroic knight" --name Arthur --image ./knight-ref.png
```

#### `gflow character list`

Print the names of all saved characters (scoped to `--project` if provided).

```bash
gflow character list
gflow character list --project my-film
```

### `gflow tool`

Build, list, and open custom Flow tools.

#### `gflow tool create`

| Option            | Default    | Description                                                     |
| ----------------- | ---------- | --------------------------------------------------------------- |
| `--prompt <text>` | _required_ | Describe the tool to build                                      |
| `--name <name>`   | —          | Label for the created tool                                      |
| `--preset <preset>` | —       | `image-filter`, `style-morph`, `time-stretcher`, or `voice-over` |

#### `gflow tool list`

Print the names of all saved tools.

```bash
gflow tool list
```

#### `gflow tool open`

```bash
gflow tool open --name Watercolour
```

```bash
gflow tool create --prompt "turn any photo into a watercolour painting" --name Watercolour --preset image-filter
```

### `gflow agent`

Drive the Flow Agent from the command line. The redesigned prompt is agent-driven, so this
path sends a prompt — with optional photos, videos, and project media attached to the chat
turn — and downloads whatever results appear, images or video, at full quality.

#### `gflow agent --prompt "<text>"`

| Option                 | Default          | Description                                                        |
| ---------------------- | ---------------- | ------------------------------------------------------------------ |
| `--prompt <text>`      | _required_       | Prompt to send to the agent                                         |
| `--photo <path...>`    | —                | Local photo(s) to attach to the chat turn                           |
| `--video <path...>`    | —                | Local video(s) to attach to the chat turn                           |
| `--from-project <name...>` | —           | Project media asset name(s) to attach (find ids with `gflow media list`) |
| `--id <id>`            | `agent`          | Job id used in output filenames                                     |
| `--out <path>`         | `./gflow-output` | Output directory                                                    |

```bash
gflow agent --prompt "create a moody noir poster for a jazz club"
gflow agent --prompt "animate the poster as a short looping video" --id jazz-loop --out ./out

# give the agent media to work from (photos, or assets already in the project)
gflow agent --prompt "restyle this pack shot for a summer campaign" \
  --photo ./pack.png --from-project "Dolly over misty lake" --id summer-pack
```

Every requested item is attached to the chat turn and **verified before the prompt is sent** —
if a file upload or asset name can't be attached, the run fails with an error naming it instead
of generating without the reference. The attachments are recorded in each artifact's metadata.

> **Uploads vs project assets.** Local photos upload reliably. Flow currently ignores uploaded
> **video** files (it never surfaces them as assets), so `--video <path>` fails loudly with a
> clear error — reference videos that already exist in the project with
> `--from-project "<name>"` instead. Photos already in the project work the same way.

#### `gflow agent settings`

Set the agent's default generation behaviour — these map onto the same Agent settings dialog
the `image`/`video` commands use, so they apply to every future generation in the project.

| Option                 | Default | Description                                     |
| ---------------------- | ------- | ----------------------------------------------- |
| `--confirm <mode>`     | —       | Confirmation before generating: `always` or `never` |
| `--image-model <m>`    | —       | Default image model                             |
| `--image-ratio <r>`    | —       | Default image aspect ratio                      |
| `--image-quantity <n>` | —       | Default number of images (1–4)                  |
| `--video-model <m>`    | —       | Default video model                             |
| `--video-ratio <r>`    | —       | Default video aspect ratio                      |
| `--video-quantity <n>` | —       | Default number of videos (1–4)                  |

```bash
gflow agent settings --confirm never --image-quantity 2 --video-model "Veo 3.1 - Fast"
```

#### `gflow agent instruction add`

Add a persistent guideline the agent follows in every run.

| Option               | Default    | Description                                   |
| -------------------- | ---------- | --------------------------------------------- |
| `--text <guideline>` | _required_ | Instruction text                              |
| `--ref <name>`       | —          | Project image to attach as a visual reference |

```bash
gflow agent instruction add --text "always use a dark, cinematic colour palette"
gflow agent instruction add --text "match the brand colours" --ref brand-swatch.png
```

#### `gflow agent instruction list`

Print all active agent instructions.

```bash
gflow agent instruction list
```

#### `gflow agent instruction clear`

Remove all agent instructions.

```bash
gflow agent instruction clear
```

### `gflow extend`

Turn a generated video into a longer scene with Flow's scenebuilder. Every `--prompt`
describes what happens next and adds roughly 7–8 seconds (Flow caps a scene at 148 seconds,
about 20 extends); every `--add-clip` appends an existing project video to the timeline. When
all steps finish, the combined scene video is downloaded at full quality.

| Option                | Default          | Description                                                            |
| --------------------- | ---------------- | ---------------------------------------------------------------------- |
| `--media-id <id>`     | —                | Video to start a **new** scene from (find ids with `gflow media list`) |
| `--scene <id>`        | —                | Existing scene to **continue** (find ids with `gflow scene list`)      |
| `--prompt <text>`     | —                | What happens next; repeat the flag to chain extends in order           |
| `--add-clip <ref>`    | —                | Project video to append, by media id or visible name; repeatable       |
| `--id <id>`           | `scene`          | Job id used in output filenames                                        |
| `--no-download`       | —                | Skip downloading the combined scene video                              |
| `--timeout <seconds>` | `600`            | Timeout per extend step                                                |
| `--out <path>`        | `./gflow-output` | Output directory                                                       |

Exactly one of `--media-id` or `--scene` is required. The first run prints the scene id —
pass it back with `--scene` to keep extending the same timeline in later runs (re-using
`--media-id` would start a fresh scene from the original clip).

```bash
# find the video to extend
gflow media list

# build a story: base clip + two extends, then download the whole scene
gflow extend --media-id 9b14ed49-5534-4b2e-bcf6-345b539dddd3 \
  --prompt "the camera pulls back to reveal the whole garden in golden light" \
  --prompt "a hummingbird lands on the gardener's hand" \
  --id garden-story

# continue the same scene later, append another generated clip, works headless too
gflow extend --scene 818777c1-1be5-4030-9425-b54b6d9ddbd6 \
  --prompt "night falls and fireflies light up the garden" \
  --add-clip "Ocean wave rolling onto beach" \
  --no-headed

# just export an existing scene without changing it
gflow extend --scene 818777c1-1be5-4030-9425-b54b6d9ddbd6
```

### `gflow scene list`

Print the project's scenebuilder scenes with their ids.

```bash
gflow scene list
gflow scene list --project "Jun 05, 02:36 AM"
```

## Output

Files are written directly into `--out` (the job id keeps them unique):

```text
out/
  gflow-run.json          # batch run summary
  <job-id>-001.png        # or .mp4 for video
  <job-id>-001.json       # per-result metadata
```

Each `.json` records everything the job asked for and where the result came from:

```json
{
  "jobId": "reveal",
  "type": "video",
  "prompt": "slow dolly over a misty lake",
  "model": "Veo 3.1 - Fast",
  "duration": 8,
  "requestedOutputs": 1,
  "quality": "original",
  "downloadedAt": "2026-10-31T08:35:08.956Z",
  "source": "google-flow-browser",
  "flowUrl": "https://flow.google.com/project/…",
  "status": "downloaded"
}
```

(`duration` appears for video jobs as the requested length — it is recorded, not enforced,
because Flow no longer exposes a duration control.)

## Configuration

| Variable            | Purpose                              |
| ------------------- | ------------------------------------ |
| `GFLOW_CHROME_PATH` | Path to the Google Chrome executable |

Use `--profile <name>` across commands to keep separate logged-in sessions.

## Troubleshooting

- **"Couldn't sign you in — this browser or app may not be secure"** — make sure you sign in via
  `gflow auth login` (a plain window), not by reopening the automation window. Sign-in must
  happen in a browser without remote debugging. Update to the latest version if you still hit it.
- **"Google Flow login is required"** — run `gflow auth login`, finish signing in, then re-run.
- **"Google Flow UI contract changed or could not be detected…"** — Flow redesigned its UI and
  gflow's selectors no longer match. Update to the latest gflow; if it persists, open an issue
  with the command you ran (this error is deliberate: it fires *before* submitting instead of
  quietly spending credits on wrong settings).
- **"Flow does not offer the model …"** — the model name doesn't match what Flow currently
  lists. Names are matched loosely (punctuation and case ignored), so `veo-3.1-fast` finds
  `Veo 3.1 - Fast`; check the dropdown in Flow's Agent settings for the exact current names.
- **"… did not take effect …"** — a value was picked but Flow didn't select it. Re-run once
  (dialogs occasionally swallow a click); if it keeps failing, report it with the command.
- **Generation seems to stall** — Flow's agent asks nothing by default once gflow sets
  confirmation to Never; if a project still has "Confirm before generating: Always" on,
  gflow answers the confirmation for you. Check the browser window for a sign-in or CAPTCHA
  prompt and complete it.
- **Chrome won't start / wrong path** — set `GFLOW_CHROME_PATH`.
- **A generation step can't find a control** — open an issue with the command you ran.

## Development

```bash
npm install
npm run dev -- doctor   # run from source without a global install
npm run build
npm run lint
npm test
```

CI (lint + build + test on Node 20 & 22) runs on every push and pull request. Pushes to `main`
with a `fix:`/`feat:` commit subject auto-release: the Release workflow lints, tests, bumps the
version, publishes to npm, tags, and creates the GitHub release.

## Disclaimer

`gflow` is an **unofficial** tool and is not affiliated with, endorsed by, or sponsored by Google.
It automates _your own_ Google Flow session through a real browser; you are responsible for
complying with Google's Terms of Service and any usage limits. It does not bypass login, solve
CAPTCHAs, rotate accounts, strip watermarks, or evade rate limits.

## License

[MIT](LICENSE) © lechcher
