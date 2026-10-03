# MAX TOUR — Russian Premium Video v3

## Goal

Create a polished Russian product-demo video that presents MAX TOUR as a premium customer experience and VIIVERSION as the technology partner behind it. Runtime is content-led and may exceed two minutes when necessary for clarity.

## Non-negotiable requirements

1. **Subtitles must never sit over the app UI.**
   - Vertical master is 1080×1920.
   - The app capture is scaled down and begins below the subtitle band.
   - A fixed dark subtitle band occupies the top of the frame.
   - Subtitle rendering is constrained to that band only.
   - Customer-facing interface content must remain fully unobstructed.

2. **Voice, subtitles and visuals share one timing source.**
   - Never synthesize the full narration as one continuous file and time captions independently.
   - Synthesize narration per semantic step.
   - Measure the real duration of every generated voice segment.
   - Build the final voice track by placing each segment on the edited video timeline.
   - Generate subtitle cue timings from the same measured segment durations.
   - If narration exceeds the available visual hold, extend/rework the visual hold; never allow silent timing drift.

3. **Russian pronunciation is prepared separately from display text.**
   - narration remains clean reader-facing Russian used for subtitles.
   - voiceText may contain stress marks and phonetic substitutions for TTS.
   - Brand names and ambiguous words must be normalized for pronunciation.
   - Known stress-sensitive words must use explicit stress guidance before synthesis.

4. **Use a different Russian voice from the previous render.**
   - Current default for this version: Piper ru_RU-irina-medium.
   - Voice is synthesized per segment and normalized after synthesis.
   - Avoid aggressive compression or speed-up that makes speech robotic.

5. **AI consultant must be demonstrated as working functionality.**
   - Open the AI consultant.
   - Type: “Ты AI-консультант? Что ты умеешь?”
   - Submit the question.
   - Hold long enough to show and read the reply.

6. **No dead static holds.**
   - Long spoken explanations require a matching visual focus, scroll, target zoom or state change.
   - The object being discussed should be the object receiving visual emphasis.

7. **Premium design language.**
   - Reserved dark canvas.
   - Branded intro and CTA outro.
   - Elegant click treatment and restrained focus ring.
   - Consistent easing and motion timing.
   - No cheap transition effects.

8. **Strong CTA ending.**
   - Dedicated VIIVERSION outro.
   - Clear invitation to contact us and adapt the solution to the client’s business.

9. **Free background music.**
   - Procedurally generated travel-tech ambient bed.
   - Sidechain ducking under speech.
   - Music must stay secondary to narration.

## Vertical frame layout

- Master: 1080×1920, 30 fps.
- Top brand line: ~0–70 px.
- Subtitle band: ~72–310 px, fixed dark fill.
- Product capture begins below ~340 px.
- Product capture is centered horizontally with clear breathing room.
- Bottom area is left clean except for the product frame and final branded transition.

## Voice and subtitle synchronization pipeline

1. Capture browser interaction.
2. Build Editor Brain scene plan.
3. Generate one TTS clip for every narrated step.
4. Measure each clip with ffprobe.
5. Map each narration step to the edited scene timeline.
6. Build one synchronized voice mix using those mapped starts.
7. Build SRT cues from the exact same clip start/duration data.
8. Render app + subtitle band + synchronized SRT + voice + music.
9. QA screenshots must verify subtitle band, AI consultant scene, and outro CTA.

## Pronunciation policy

Use voiceText for TTS-only pronunciation overrides. Examples:

- MAX TOUR → Макс Тур
- Далат → Дала́т
- каталог / каталоге → катало́г / катало́ге
- бронирование → брони́рование
- AI-консультант may be voiced as эй-ай консультант

Display subtitles keep normal spelling.

## Acceptance checks

- Subtitle pixels never cover the app capture.
- Voice and subtitle cue boundaries come from real TTS segment duration.
- No overlapping narration segments.
- Final narration finishes inside the edited visual timeline.
- AI question is visibly typed and submitted.
- AI reply has readable hold time.
- Outro contains a clear CTA.
- Final MP4 passes ffprobe.
- QA screenshots and final MP4 are uploaded as workflow artifacts.
