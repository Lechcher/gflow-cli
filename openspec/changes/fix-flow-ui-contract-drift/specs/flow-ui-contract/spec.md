# Spec Delta

## Purpose

Defines how gflow discovers and drives the Google Flow web UI — the generation submit
control, per-project generation defaults, project navigation, media pickers, and the
duration behavior — so that every gflow command depends on one verifiable contract that
can be updated when Flow's UI changes.

## ADDED Requirements

### Requirement: Submission control identified by accessible name
The automation SHALL start a generation with the Flow submit control identified by its
accessible name ("Start generation"), not by the icon-only button's text content, and
SHALL wait for the control to become enabled before activating it.

#### Scenario: Submit after entering a prompt
- **WHEN** a prompt has been typed into the Flow prompt box and the submit control is
  enabled
- **THEN** the automation activates the control whose accessible name is
  "Start generation" and the generation starts

#### Scenario: Disabled submit control
- **WHEN** the prompt box is empty or the submit control is disabled
- **THEN** the automation waits for the control to become enabled before activating it,
  up to its normal action timeout

### Requirement: Per-project generation defaults
Generation settings (aspect ratio, output count, model) SHALL be applied per project in
Flow's Agent settings dialog — image jobs use the image-default section, video jobs the
video-default section — before submitting the prompt. The settings dialog SHALL be
closed with its Save control after changes and left closed.

#### Scenario: Apply defaults for an image job
- **WHEN** an image job requests a ratio, output count, or model
- **THEN** the automation opens the prompt-bar settings control, applies the request in
  the image-default section, saves, and the dialog closes

#### Scenario: Apply defaults for a video job
- **WHEN** a video job requests a ratio, output count, or model
- **THEN** the automation applies the request in the video-default section and saves

#### Scenario: No settings requested
- **WHEN** a job requests no ratio, output count, or model
- **THEN** the automation skips the settings dialog and keeps the project's existing
  defaults

### Requirement: Unattended submission is not blocked
Before submitting, the automation SHALL set "Confirm before generating" to its
automatic option in the Agent settings dialog, and SHALL tolerate a confirmation prompt
if Flow still shows one.

#### Scenario: Automatic confirming configured
- **WHEN** the automation applies settings for a job
- **THEN** "Confirm before generating" ends set to the option that generates without
  confirmation

#### Scenario: Confirmation prompt still appears
- **WHEN** a confirmation prompt appears after activation of the submit control
- **THEN** the automation confirms it and the run continues instead of hanging

### Requirement: Project navigation on the Flow dashboard
The automation SHALL open an existing project by name from the Flow dashboard, SHALL
open or create a project when none is open, and SHALL keep project URLs on the current
Flow domain while tolerating the legacy domain redirect.

#### Scenario: Open a named project
- **WHEN** a project name is requested
- **THEN** the automation opens the matching project from the dashboard and the prompt
  box becomes available

#### Scenario: No project open
- **WHEN** a command runs without a project open or named
- **THEN** the automation opens or creates a project from the dashboard's new-project
  control

### Requirement: Video duration when Flow exposes no duration control
When Flow offers no per-prompt duration control for a video job, the automation SHALL
still complete the generation with Flow's default duration, SHALL record the requested
duration in the artifact metadata, and the CLI help SHALL state that duration is not
enforced when Flow does not expose it.

#### Scenario: Duration requested but not settable
- **WHEN** a video job passes a duration and no duration control exists in Flow's UI
- **THEN** the generation completes with Flow's default duration and the artifact
  metadata records the requested duration

### Requirement: Media and character references use the ingredient picker
The automation SHALL add reference media and saved characters to a prompt through the
prompt-bar ingredient control ("Add ingredients to the prompt box").

#### Scenario: Add a reference image
- **WHEN** a job supplies a reference image
- **THEN** the automation opens the ingredient picker, uploads or selects the media, and
  the reference is attached to the prompt

#### Scenario: Add a character reference
- **WHEN** a job references a saved character by name
- **THEN** the automation opens the ingredient picker, switches to the Characters tab,
  and picks the character tile

#### Scenario: Video start/end frame images
- **WHEN** a video job supplies start or end frame images and Flow exposes no frame slot
  assignment
- **THEN** the automation attaches the frame images as ingredient reference images and
  the run proceeds

### Requirement: Command surfaces share one contract
Every automation surface (`edit`, scene extend, tools, characters, agent) SHALL use the
same updated UI contract, including identifying its submit action by accessible name
where the control is the redesigned submit button.

#### Scenario: Submit from another command
- **WHEN** another gflow command starts a generation on the redesigned Flow UI
- **THEN** it activates the same submit control the image/video create path uses

### Requirement: Generated results are detected from the project grid
The automation SHALL detect a finished generation from Flow's redesigned result media —
image results as tiles carrying `data-media-id`, video results as video tiles or the
agent's video options — and SHALL download them through the viewer's Download control,
recording the artifact and its metadata.

#### Scenario: Image result completes
- **WHEN** an image generation finishes on the redesigned Flow UI
- **THEN** the automation detects the new result media, downloads it, and writes the
  artifact plus its metadata to the output directory

#### Scenario: Video result completes
- **WHEN** a video generation finishes on the redesigned Flow UI
- **THEN** the automation detects the new video result, downloads the video file, and
  writes the artifact plus its metadata
