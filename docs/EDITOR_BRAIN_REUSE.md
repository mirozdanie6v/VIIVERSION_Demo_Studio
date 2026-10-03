# Editor Brain reuse map

Demo Studio v0.11 reuses editorial entities from the existing VIIVERSION video work instead of treating browser capture as a simple screen recorder.

## Verified source code reused

Source repository:

- `mirozdanie6v/EventVideoHumanEditor`
- semantic pipeline: `semantic-v5-quality-20260819`

The following Human Editor concepts are ported into the TypeScript Editor Brain:

- `scene_type` → typed product-demo scene classification
- `shot_intent` → the same editorial intent vocabulary:
  - `broll_music`
  - `continuity_speech`
  - `continuity_action`
  - `reaction`
  - `ritual`
  - `atmosphere`
  - `montage`
- `importance` → editorial importance score
- `continuity` → preserve action/result relationships
- `story_note` → why a step exists for the viewer
- `edit_strategy` → how the material should be cut
- semantic quality-gate model → weighted coverage and final-step checks

The Human Editor rule that file/technical boundaries are not necessarily scene boundaries is adapted to browser steps: a click plus its loading/result/assertion steps can become one editorial unit.

The Human Editor rule that continuous action should preserve causality is adapted to product flows: action and visible consequence stay together.

## v0.11 pipeline

```
Capture
  ↓
Semantic Timeline
  ↓
Editor Brain
  ↓
Editor Critic
  ↓
Music Brain (optional beat alignment)
  ↓
Subtitle Brain
  ↓
FFmpeg Render
```

Generated artifacts:

- `editor_brain.json`
- `editor_critic.json`
- `music_brain.json`
- `captions.json`
- `captions.srt`
- `scenes.json`
- final MP4

## Historical entities

Earlier VIIVERSION work also defined:

- Event Video Automation Pack
- event-story-editor
- music-sync-sound-design
- video-titles-subtitles
- event-highlight-selector
- Premiere project automation / UXP executor

Those historical source packages are not present in the currently connected GitHub repositories. v0.11 reuses their documented architectural ideas where they match the current product, while direct code reuse is limited to the verified EventVideoHumanEditor repository above.

Premiere automation remains outside the Demo Studio production render path. Demo Studio continues to render through FFmpeg so the MCP/cloud product stays self-contained.


## MAX TOUR premium-demo rules

The MAX TOUR Russian Premium Video v2 adds reusable product-demo rules to the Editor Brain pipeline:

- reserve a subtitle-safe presentation zone instead of burning captions over customer UI;
- use target-focused smart zoom/scroll beats to avoid long static holds;
- require a visible functional proof beat for AI features (question → response);
- treat branded intro and CTA outro as part of the narrative structure;
- keep narration captions separate from technical step labels;
- allow runtime to follow explanatory clarity instead of forcing a two-minute ceiling.

Reference implementation: `docs/MAX_TOUR_RU_PREMIUM_VIDEO_SPEC.md` and `examples/max-tour-russian-premium.json`.
