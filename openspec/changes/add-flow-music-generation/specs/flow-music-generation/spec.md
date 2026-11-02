# Spec Delta

## Purpose

Covers creating a song from the command line through Flow Music's Producer chat: a
structured request becomes a chat turn, the run waits for a completed song, and the
finished audio lands in the output directory with standard artifact metadata.

## ADDED Requirements

### Requirement: Song generation from a structured request
The system SHALL accept a `gflow music` command whose request combines a prompt with the
structured song fields the Flow Music surface supports (for example style, lyrics, or
instrumental), and SHALL map those fields into the Flow Music Producer chat request. The
supported field set is fixed by live verification of the Flow Music surface; fields the
surface cannot apply are not offered as flags.

#### Scenario: Prompt-only song
- **WHEN** the user runs `gflow music --id lofi --prompt "a rainy lo-fi beat for studying"`
- **THEN** a song is generated from that request and its audio is downloaded

#### Scenario: Structured fields included
- **WHEN** the user passes a supported structured field (for example lyrics or style) along with `--prompt`
- **THEN** the request sent to Flow Music includes the field's content

#### Scenario: Parse failures happen before a browser opens
- **WHEN** the request is malformed (for example a non-integer duration or a lyrics file that does not exist)
- **THEN** the command fails at parse time with a clear error and no browser session is started

### Requirement: A completed song is required before download
The system SHALL wait for a completed song result rather than a mere chat response, and
SHALL map Flow Music's block, rate-limit, credit, and failure markers to the
corresponding errors.

#### Scenario: Completed song downloads
- **WHEN** the finished song appears in Flow Music
- **THEN** its audio file is downloaded into the `--out` directory

#### Scenario: Generation blocked by Flow Music
- **WHEN** Flow Music shows a content-policy block message
- **THEN** the run fails with the generation-blocked error and no artifact is written

#### Scenario: Song never completes
- **WHEN** no completed song appears within the requested timeout
- **THEN** the run fails with the generation-failed error naming the timeout

### Requirement: Each song records artifact metadata
The system SHALL write per-song metadata beside the audio file recording the request
(job id, prompt, and any structured fields), the source surface, the page URL, the
download time, and the download status.

#### Scenario: Metadata accompanies the audio
- **WHEN** a song downloads successfully
- **THEN** a sibling JSON file records the full request and provenance for that song
