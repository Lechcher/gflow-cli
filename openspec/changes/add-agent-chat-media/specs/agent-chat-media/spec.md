# Spec Delta

## Purpose

Defines how gflow attaches photos and videos to a Google Flow agent chat turn so unattended
agent runs can use reference media — selecting local files and existing project media through
the ingredient picker, verifying the attachments before submitting, and recording them on the
resulting artifacts.

## ADDED Requirements

### Requirement: Agent runs accept photo and video references
An agent run SHALL accept local photo files, local video files, and existing project media, and
SHALL attach them to the chat turn through the prompt-bar ingredient picker before submitting
the prompt. Local files SHALL be uploaded; project media SHALL be selected from the picker's
media tabs by name.

#### Scenario: Attach a local photo and a project video
- **WHEN** an agent run requests a local photo and a project media asset by name
- **THEN** the automation uploads the photo, selects the project asset in the picker, and both
  are attached to the chat turn before the prompt is submitted

#### Scenario: No media requested
- **WHEN** an agent run requests no photos, videos, or project media
- **THEN** the automation submits the prompt directly, exactly as an agent run without media

### Requirement: Attachments are verified before submitting
Before submitting, the automation SHALL confirm that every requested photo and video is present
in the chat's ingredient row, and SHALL fail the run with a clear error when a requested media
item cannot be attached. No generation SHALL be started with missing attachments.

#### Scenario: Every attachment confirmed
- **WHEN** the requested media has been attached
- **THEN** the automation submits the prompt and the agent run proceeds

#### Scenario: Requested media is not attachable
- **WHEN** a requested file cannot be uploaded, or a requested project asset cannot be found
- **THEN** the run fails before submitting, with an error naming the media that could not be
  attached, and no generation is started

#### Scenario: Upload never appears in the chat
- **WHEN** a file upload completes but the media does not appear in the chat's ingredient row
  within the automation's normal timeout
- **THEN** the run fails before submitting, with an error stating that the attachment did not
  appear

### Requirement: Attached media is recorded on artifacts
Each artifact produced by an agent run SHALL record the media that was attached to the chat
turn, so outputs remain traceable to their references.

#### Scenario: Metadata lists attachments
- **WHEN** an agent run with attached media produces artifacts
- **THEN** each artifact's metadata records the attached photos, videos, and project media

### Requirement: Agent runs with media are scriptable in batch pipelines
A batch pipeline job of agent type SHALL accept the same media inputs as the agent command —
prompt, photos, videos, and project media — and SHALL run with the same attachment and
verification behavior.

#### Scenario: Batch agent job with media
- **WHEN** a pipeline declares an agent job with photos, videos, or project media
- **THEN** the automation attaches and verifies that media, runs the job, and writes its
  artifacts with the attachment record

#### Scenario: Batch job missing media
- **WHEN** a batch agent job requests media that cannot be attached
- **THEN** that job fails without generating, and the pipeline behaves exactly as it does for
  other job types: a failure that means Flow's UI could not be verified stops the pipeline,
  while ordinary generation failures continue when continue-on-failure is set
