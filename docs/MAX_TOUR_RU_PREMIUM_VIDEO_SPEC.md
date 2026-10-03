# MAX TOUR — Russian Premium Video v2

## Goal

Create a polished Russian product-demo video that presents MAX TOUR as a premium customer experience and VIIVERSION as the technology partner behind it. Runtime is content-led and may exceed two minutes when necessary for clarity.

## Approved requirements

1. **Dedicated subtitle zone.** In vertical 1080×1920 output the captured mobile interface is scaled down and shifted lower. Russian subtitles live in the reserved dark header area and never cover customer-facing UI.
2. **AI consultant shown working.** The video must open the AI consultant, type a real question — “Ты AI-консультант? Что ты умеешь?” — submit it, and hold long enough to show the reply.
3. **No dead static holds.** Long explanation beats use purposeful scrolls, target-focused smart zooms and close visual emphasis. The spoken subject and the visual focus must match.
4. **Natural Russian voice.** The client render uses a local neural Russian TTS provider (Piper) instead of the previous English Edge voice. Voice is normalized and mixed with ducking.
5. **Strong final CTA.** The video ends on a dedicated branded VIIVERSION frame with a direct invitation to contact us and adapt the solution to the client’s business.
6. **Premium motion design.** Intro/outro use one visual system, restrained transitions, elegant click ripple/focus treatment, consistent motion timing, dark premium canvas and clean typography.
7. **Free background music.** Music is generated procedurally inside the pipeline; no paid stock subscription is required. It stays subtle under narration and rises slightly around the intro/outro.

## Visual system

- Master: 1080×1920, 30 fps, H.264 + AAC.
- App capture: 430×932, scaled to a smaller centered phone-area on a dark canvas.
- Subtitle area: top of frame, max two lines per cue, narration-only.
- Interaction: restrained white cursor, soft focus ring and click ripple.
- Motion: smart zoom around known targets plus short scrolls; avoid decorative effects that compete with the product.
- Intro: VIIVERSION + MAX TOUR customer-journey positioning.
- Outro: CTA headline, secondary action line, VIIVERSION.COM.

## Audio

- Russian neural voice: Piper ru_RU medium model, local/free.
- Voice post: loudness normalization, light EQ and compression.
- Music: deterministic ambient travel-tech bed generated from code, then encoded to AAC.
- Mix: sidechain ducking under speech, low background level, soft fade-in/fade-out.

## Acceptance checks

- AI question is visibly typed and submitted.
- AI response has enough screen time to read.
- Subtitles never obscure the app.
- No static screen remains visually unchanged for a long spoken explanation.
- Outro contains a clear CTA.
- Final MP4 passes ffprobe and is uploaded as a workflow artifact.
