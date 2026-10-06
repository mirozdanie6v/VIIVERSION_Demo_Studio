# Multilingual Voice Engine

Demo Studio treats voice as a provider-agnostic product capability, not as a language-specific implementation.

## Product contract

A presentation requests:

- a BCP-47 locale such as `en-US`, `ru-RU`, `vi-VN`, `zh-CN`, `ko-KR`;
- a voice persona, normally `viiversion-presenter`;
- optional pronunciation substitutions;
- optional native timing metadata for subtitle/edit synchronization.

The presentation does **not** need to know which TTS vendor will synthesize the audio.

## Pipeline

```text
Scenario locale
    ↓
Voice Director
    ↓
Pronunciation layer
    ↓
TTS Router
    ├── Hugging Face local (Supertonic 3 / Chatterbox V3)
    ├── ElevenLabs
    ├── OpenAI
    └── Piper offline fallback
    ↓
Audio + provider metadata + timings when available
    ↓
Subtitle / edit synchronization
```

## Pronunciation architecture

Pronunciation is split into two independent concerns:

1. **Russian lexical stress**
   - handled inside the provider bridge, never in the generic Voice Director;
   - RUAccent performs context-aware Russian accentuation;
   - `config/pronunciation-registry.json` supplies hard overrides for approved business/product vocabulary;
   - Chatterbox's own Russian stress pass is disabled after preprocessing, so text is stressed exactly once.

2. **Brand pronunciation**
   - brands are defined centrally in `config/pronunciation-registry.json`;
   - each brand has canonical display spelling, accepted aliases, spoken locale, phonetic text and optional IPA;
   - captions/UI keep the canonical spelling;
   - Chatterbox splits mixed-language narration into language spans. A Russian sentence containing `VIIVERSION` is synthesized as Russian → English `Vee Version` → Russian using the same approved reference voice;
   - ElevenLabs synchronizes the same registry into a pronunciation dictionary and uses IPA where supported.

Scenario-level `pronunciation` remains available for non-brand one-off substitutions such as acronyms or units. Brand names must not be redefined inside individual scenarios.

The production invariant is:

```text
clean narration
→ scenario one-off substitutions
→ brand span detection
→ provider-specific pronunciation
   ├── Russian span: RUAccent + approved overrides
   └── Brand span: registered spoken locale / IPA
→ TTS
```
## Default VIIVERSION presenter voices

For Russian Demo Video Presenter output, the approved premium voice policy is:

1. **Niki / eleven_v3 / speed 1.06** — primary Russian female presenter and the MAX TOUR benchmark.
2. **Leslie / eleven_v3 / speed 1.02** — approved Russian female fallback.
3. When direct ElevenLabs/Runway synthesis is unavailable inside the render worker, the worker may synthesize from the **approved Niki reference audio** captured from MAX TOUR.
4. **Generic/default Chatterbox Russian output is rejected and must not be auto-selected for Russian premium presentations.**
5. Piper remains an emergency/offline fallback and is not considered premium.

For English and other locales, provider routing remains locale-specific.

When a scenario omits the locale, narration text is classified automatically: Cyrillic-dominant narration defaults to `ru-RU`; otherwise it defaults to `en-US`.

Default casting direction: bright, warm, confident, natural human rhythm, medium energetic pace, short organic pauses. Avoid grave/dark delivery, trailer voice, radio-announcer cadence and synthetic monotone pacing.

The pair is a presentation default, not a language lock. The router may choose a locale-native equivalent when a target language needs a different physical speaker to preserve native pronunciation and prosody.

## VIIVERSION Presenter persona

The default persona is a cross-language editorial direction:

- skilled human product presenter;
- confident and warm;
- natural conversational phrasing;
- semantic emphasis instead of radio-ad cadence;
- short human pauses;
- varied intonation;
- native pronunciation and prosody for the requested locale;
- no trailer voice, theatrical overacting, monotone cadence or synthetic sing-song rhythm.

The physical speaker can differ by locale. The persona is the stable product identity.

## Scenario configuration

```json
{
  "voice": {
    "locale": "vi-VN",
    "provider": "auto",
    "persona": "viiversion-presenter",
    "requireNativeTimings": true,
    "pronunciation": {
      "VND": "донгов"
    }
  }
}
```

Each narrated step may optionally use `voiceText` for TTS-only pronunciation while `narration` remains clean subtitle/display copy.

## Routing

Default order:

1. Hugging Face local, when explicitly enabled
2. ElevenLabs
3. OpenAI
4. Piper

Override with:

```bash
VOICE_PROVIDER_ORDER=huggingface,openai,elevenlabs,piper
```

With `provider: "auto"`, the router:

1. checks configuration;
2. checks locale eligibility;
3. prefers providers with native timing metadata when required;
4. attempts the highest-ranked provider;
5. falls back to the next configured provider if synthesis fails.

An explicit provider disables runtime fallback so failures remain visible during QA.

## Provider configuration

### ElevenLabs

```bash
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
```

Voice IDs can be configured globally, per language, or per locale:

```bash
ELEVENLABS_VOICE_ID_VI=...
ELEVENLABS_VOICE_ID_VI_VN=...
ELEVENLABS_VOICE_ID_JA_JP=...
```

Optional:

```bash
ELEVENLABS_MODEL=eleven_multilingual_v2
ELEVENLABS_STABILITY=0.43
ELEVENLABS_SIMILARITY_BOOST=0.78
ELEVENLABS_STYLE=0.28
```

The adapter uses the speech-with-timestamps API, so it can return character-level alignment for precise subtitle synchronization.

### OpenAI

```bash
OPENAI_API_KEY=...
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=marin
```

The Voice Director passes natural-language performance direction through the TTS instructions field. The current OpenAI speech adapter does not return native character timing metadata, so it is not selected when `requireNativeTimings` is mandatory and a timing-capable provider is available.

### Hugging Face local / free

The local Hugging Face provider avoids per-character or per-request TTS API charges. Production containers may auto-enable it for the English presenter. Russian premium presentations are intentionally excluded from generic local auto-selection; Russian local synthesis requires an explicitly approved reference voice such as the Niki MAX TOUR reference.

Install the default CPU-friendly engine:

```bash
python3 -m pip install -r requirements-tts.txt
```

Install Chatterbox only on workers that need multilingual voice cloning or the heavier premium-local path:

```bash
python3 -m pip install -r requirements-tts-chatterbox.txt
```

Enable local TTS:

```bash
HF_TTS_ENABLED=1
HF_TTS_ENGINE=auto
```

Chatterbox Multilingual V3 remains available as a synthesis engine, but its **generic Russian voice is not an approved VIIVERSION premium presenter**. For Russian, it may be used only with an explicitly approved reference voice, currently the Niki MAX TOUR reference. **Supertonic 3** remains the lightweight zero-API-cost fallback for explicitly enabled local workflows.

Available engines:

- `auto` — local engine selection; for Russian premium work this does not override the approved Niki policy.
- `chatterbox` — local synthesis engine; generic Russian output is rejected, Niki-reference synthesis is allowed.
- `supertonic` — CPU-friendly fallback, including Vietnamese and other supported locales.

Use Chatterbox:

```bash
HF_TTS_ENABLED=1
HF_TTS_ENGINE=chatterbox
HF_TTS_DEVICE=cuda
HF_TTS_REFERENCE_AUDIO=/models/presenter-reference.wav
```

Reference audio can also be configured by language or locale:

```bash
HF_TTS_REFERENCE_AUDIO_RU=/models/presenter-ru.wav
HF_TTS_REFERENCE_AUDIO_RU_RU=/models/presenter-ru-ru.wav
```

Other settings:

```bash
HF_TTS_PYTHON=python3
HF_TTS_VOICE=M1
HF_TTS_SCRIPT=/app/scripts/hf_tts.py
```

Explicit CLI use:

```bash
npm run voice -- \
  --locale ru-RU \
  --text "Добро пожаловать." \
  --out /tmp/presenter.mp3 \
  --provider huggingface
```

The first local synthesis downloads model assets into the normal Hugging Face cache. The provider returns audio without native character timings, so requests that strictly require provider-native timings continue to route to a timing-capable provider.

### Piper

Piper is an offline/free fallback, not the premium default.

```bash
PIPER_MODEL=/models/default.onnx
PIPER_MODEL_VI=/models/vi.onnx
PIPER_MODEL_RU_RU=/models/ru.onnx
```

Optional:

```bash
PIPER_BIN=piper
FFMPEG_PATH=ffmpeg
```

## Standalone voice command

```bash
npm run voice -- \
  --locale en-US \
  --text "Welcome to the product." \
  --out /tmp/presenter.mp3 \
  --provider auto
```

Add `--require-timings` when the downstream edit requires provider-native timing data.

The command writes a sidecar `.voice.json` containing the routing decision, selected provider, resolved voice/model and timing metadata.

## Architectural rule

Do not optimize Demo Studio around one language, one voice, or one vendor.

New providers implement the `VoiceProvider` interface and participate in routing. New languages should primarily require locale/voice configuration rather than new editing code.

Full product-video rendering should not be used for voice casting. First approve short voice samples, then render the full presentation with the selected voice profile.


## Casting lesson: model capability is locale-specific

The 2026-10-03 casting run confirmed that model support must be resolved per locale. In the tested Runway/Eleven speech surface, `eleven_multilingual_v2` rejected Vietnamese (`vi`), while `eleven_v3` successfully generated Vietnamese speech.

Therefore the router must treat provider + model + locale as one capability decision rather than assuming a provider supports every locale with every model.

See `docs/VOICE_CASTING_2026-10-03.md`.
