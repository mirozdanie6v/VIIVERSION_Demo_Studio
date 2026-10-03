# Voice Casting — 2026-10-03

## Purpose

Validate the new multilingual Voice Engine with real premium TTS samples before rendering another full MAX TOUR video.

## GitHub casting environment

The dedicated `Voice Casting` GitHub Actions workflow is working, but the repository currently has no premium TTS credentials configured:

- `OPENAI_API_KEY`: absent
- `ELEVENLABS_API_KEY`: absent
- ElevenLabs locale/global voice IDs: absent

The workflow correctly skipped all 9 GitHub-provider combinations instead of silently falling back to Piper.

## Live casting path used

The connected Runway speech tool was used for actual listening samples without changing the production provider architecture.

### Russian

- Niki / eleven_v3 / speed 1.06 — 13.20s
  - task: `33426b93-9f3b-484d-aa7e-27b5f6ae1e69`
  - direction: bright, warm, confident
- Leslie / eleven_v3 / speed 1.02 — 13.20s
  - task: `5e3ca4e5-9792-4e82-b2e7-e20059d517f2`
  - direction: warm, confident
- Eleanor / eleven_v3 / speed 1.02 — 12.64s
  - task: `652ca82a-fbdb-4802-8aac-83d44ee7bfd0`
  - direction: warm, confident
- Leslie / eleven_multilingual_v2 / speed 1.02 — 13.61s
  - task: `2ab7ab64-d943-4291-a6b5-fa6a2b80466b`
  - steady control sample

### English

- Niki / eleven_v3 / speed 1.06 — 13.20s
  - task: `b4df7b03-d0cd-44b5-952f-cae199b14409`
- Leslie / eleven_v3 / speed 1.02 — 13.44s
  - task: `03741ec5-fdc5-4d03-8f0a-891d8a779e3d`
- Eleanor / eleven_v3 / speed 1.02 — 14.56s
  - task: `837670b3-c8c5-4407-88dc-e6b595f3e557`

### Vietnamese

- Niki / eleven_v3 / speed 1.06 — 12.24s
  - task: `819f7781-d5a2-40a0-81ea-da36f0f4427f`
- Leslie / eleven_v3 / speed 1.02 — 12.96s
  - task: `bea2caee-c9e3-4026-877a-335487065365`

## Observed provider constraint

The attempted Vietnamese sample with `eleven_multilingual_v2` was rejected by the provider because that model does not support `vi`. The same casting flow succeeded with `eleven_v3`.

This validates a core Voice Router requirement: model/provider capability must be evaluated per locale, and unsupported combinations must route elsewhere instead of degrading to a low-quality fallback.

## Current candidate set

For human review, the priority comparison is:

1. Niki v3 — brighter/friendlier product presenter, tested at 1.06 speed
2. Leslie v3 — professional narrator, tested at 1.02 speed
3. Eleanor v3 — classier/more restrained narrator
4. Leslie multilingual v2 — steady baseline where supported

No voice is locked as the global VIIVERSION persona yet. Human listening approval is required before the next full video render.

## Production rule

- Do not render a full presentation to test voices.
- First run short multilingual voice casting.
- Select voice/persona/model/pace.
- Configure provider credentials and locale-specific voice IDs in the production environment.
- Then generate the long narration and use native timing metadata where available.
