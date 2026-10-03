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
    ├── ElevenLabs
    ├── OpenAI
    └── Piper offline fallback
    ↓
Audio + provider metadata + timings when available
    ↓
Subtitle / edit synchronization
```

## Default VIIVERSION presenter voices

For Demo Video Presenter, the approved default voice pair is:

1. **Niki v3** — primary presenter voice.
2. **Leslie v3** — fallback/alternate presenter voice.

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

1. ElevenLabs
2. OpenAI
3. Piper

Override with:

```bash
VOICE_PROVIDER_ORDER=openai,elevenlabs,piper
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
