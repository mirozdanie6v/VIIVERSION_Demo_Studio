# Free Voice Casting Decision — 2026-10-04

## Approved primary voice

**Chatterbox Multilingual V3** is the approved primary free presenter voice for VIIVERSION Demo Studio.

The decision was made after listening to matched Russian MAX TOUR samples generated through the real Demo Studio Voice Engine. The Chatterbox sample was judged closer to the desired presenter sound.

## Fallback

**Supertonic 3** remains the free lightweight fallback:

- when Chatterbox is not installed;
- when the target locale is unsupported by Chatterbox;
- for CPU-oriented render workers where the heavier Chatterbox runtime is undesirable.

## Routing rule

`HF_TTS_ENGINE=auto` means:

1. prefer Chatterbox V3 for supported locales when available;
2. otherwise use Supertonic 3.

Explicit `HF_TTS_ENGINE=chatterbox` or `HF_TTS_ENGINE=supertonic` still forces a specific engine for QA.
