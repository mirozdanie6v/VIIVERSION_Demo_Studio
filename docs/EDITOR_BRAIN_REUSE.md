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

The Russian premium pipeline defines reusable hard rules for product-demo editing:

- subtitles belong to a dedicated presentation band outside customer-facing UI;
- narration is synthesized per semantic step, never as one monolithic track when precise sync matters;
- actual TTS segment duration is the timing source for both voice placement and subtitle cues;
- pronunciation overrides live in TTS-only voiceText so display copy remains clean;
- target-focused zoom/scroll beats replace long static holds;
- AI features require visible functional proof (question → submitted state → response);
- branded intro and CTA outro are part of the narrative structure;
- runtime follows explanatory clarity instead of an arbitrary two-minute ceiling;
- if voice exceeds its visual hold, extend/re-edit the visual segment rather than letting voice, subtitles and content drift apart.

Reference implementation: docs/MAX_TOUR_RU_PREMIUM_VIDEO_SPEC.md, examples/max-tour-russian-premium.json, and src/narration-sync-cli.ts.


## Attention Director

Product-demo motion must follow human visual attention rather than decorative movement.

Use the rules in `docs/ATTENTION_DIRECTOR.md`:
- establish the complete UI before narrowing focus;
- move toward the semantic block described by narration;
- preserve all required text/images/controls inside the crop;
- treat interaction geometry as evidence, not an automatic center;
- release back to context before the next state;
- keep subtitles in a separate, large, readable rail;
- present mobile UI inside a designed smartphone frame.

A static scene is not, by itself, a reason to zoom.


## Framing and Pacing Directors

The Editor Brain now treats framing and pacing as separate editorial decisions.

See:
- `docs/FRAMING_CROP_DIRECTOR.md`
- `docs/PACING_RETENTION_DIRECTOR.md`

Hard principles:
- crop for semantic completeness, not for click-coordinate centering;
- never cut required words, prices, button labels or supporting context;
- use the smallest zoom that clearly changes attention;
- a continuous narration block may contain several visual beats;
- “preserve the spoken thought” means preserve the audio idea, **not** preserve one static framing for the entire sentence;
- target meaningful visual change roughly every 1.5–3.5 seconds;
- benefit/problem/solution language should recur throughout a sales-oriented demo;
- eliminate browser wait time that does not add proof;
- end with a direct conversion proposition rather than a passive logo hold.
