# Spec Delta

## Purpose

Covers authenticating and verifying the Flow Music surface (flowmusic.app) in the gflow
browser session, so one login covers both Google Flow and Flow Music and every music run
starts from a proven-ready session.

## ADDED Requirements

### Requirement: One login covers Flow and Flow Music
The system SHALL open the Flow Music surface alongside Google Flow in the plain sign-in
browser, so a single `gflow auth login` establishes sessions for both surfaces.

#### Scenario: Login opens both surfaces
- **WHEN** the user runs `gflow auth login`
- **THEN** the sign-in window opens Flow Music (flowmusic.app) in addition to Google Flow

#### Scenario: Music run needs no second login
- **WHEN** the user completes the login and later runs a `gflow music` command
- **THEN** the command uses the same signed-in profile without asking for a separate sign-in

### Requirement: Doctor verifies both surfaces
The system SHALL verify that both Google Flow and Flow Music are signed in and ready, and
SHALL report readiness per surface.

#### Scenario: Both surfaces ready
- **WHEN** both Google Flow and Flow Music show their signed-in state
- **THEN** `gflow doctor` exits successfully and reports both surfaces as ready

#### Scenario: Flow Music not signed in
- **WHEN** Flow Music shows its login wall while Flow itself is signed in
- **THEN** `gflow doctor` fails with the login-required error naming Flow Music

#### Scenario: Flow Music needs manual action
- **WHEN** Flow Music shows a consent or identity-verification prompt
- **THEN** `gflow doctor` fails with the manual-action-required error mentioning Flow Music

### Requirement: Music commands require a ready Flow Music session
The system SHALL verify the Flow Music session is signed in before submitting a song
request, and SHALL fail with the login-required error rather than sending an
unauthenticated request.

#### Scenario: Session missing at generation time
- **WHEN** the user runs `gflow music` while the Flow Music session is signed out
- **THEN** the command fails with the login-required error before any request is submitted
