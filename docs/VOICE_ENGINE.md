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

## Default VIIVERSION presenter voices

For Russian and English Demo Video Presenter output, the default is the premium presenter path:

1. **ElevenLabs v3 locale-specific voice** — preferred whenever the corresponding Russian or English voice is configured.
2. **Chatterbox Multilingual V3** — baked into the production container and automatically used as the premium local default for Russian and English when ElevenLabs is unavailable.
3. **Supertonic 3** — resilient local fallback if Chatterbox cannot synthesize on a worker.
4. **OpenAI** remains an additional configured-provider fallback when credentials are available.
5. **Niki v3 / Leslie v3** remain the approved presenter casting references.

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
      "VIIVERSION": "vee version"
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

The local Hugging Face provider avoids per-character or per-request TTS API charges. Production containers enable it automatically only for the default VIIVERSION presenter in Russian and English; other locales remain opt-in unless explicitly configured.

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

The approved VIIVERSION free presenter voice is **Chatterbox Multilingual V3**. In `auto` mode it is selected first when installed and when the locale is supported. **Supertonic 3** remains the lightweight zero-API-cost fallback for workers without Chatterbox and for locales such as Vietnamese that Chatterbox does not cover.

Available engines:

- `auto` — preferred mode: Chatterbox V3 first, Supertonic 3 fallback.
- `chatterbox` — approved primary free presenter voice for supported languages such as English, Russian and Chinese.
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
