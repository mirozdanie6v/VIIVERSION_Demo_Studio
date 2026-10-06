#!/usr/bin/env python3
"""Local Hugging Face TTS bridge for VIIVERSION Demo Studio.

Reads UTF-8 narration from stdin and writes a WAV file. The first invocation
downloads model assets into the normal Hugging Face cache.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import os
import sys
import traceback
import unicodedata


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=("auto", "supertonic", "chatterbox"), default="auto")
    parser.add_argument("--locale", required=True)
    parser.add_argument("--language", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--voice", default="M1")
    parser.add_argument("--model")
    parser.add_argument("--reference-audio")
    parser.add_argument("--device", default="auto")
    return parser.parse_args()


CHATTERBOX_LANGUAGES = {
    "ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja",
    "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh",
}


def module_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


REGISTRY_PATH = Path(__file__).resolve().parents[1] / "config" / "pronunciation-registry.json"


def load_pronunciation_registry() -> dict:
    with REGISTRY_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def strip_stress_marks(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    cleaned = "".join(ch for ch in decomposed if ch not in {"\u0301", "\u0300"})
    return unicodedata.normalize("NFC", cleaned)


def _whole_term_pattern(term: str) -> re.Pattern[str]:
    return re.compile(
        r"(?<![\w])" + re.escape(term) + r"(?![\w])",
        flags=re.IGNORECASE | re.UNICODE,
    )


_ruaccent_instance = None


def accented_to_ruaccent(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    converted = re.sub(
        r"([аеёиоуыэюяАЕЁИОУЫЭЮЯ])\u0301",
        r"+\1",
        decomposed,
    )
    return unicodedata.normalize("NFC", converted)


def ruaccent_to_combining_acute(value: str) -> str:
    converted = re.sub(
        r"\+([аеёиоуыэюяАЕЁИОУЫЭЮЯ])",
        lambda match: match.group(1) + "\u0301",
        value,
    )
    return unicodedata.normalize("NFC", converted)


def _get_ruaccent(registry: dict):
    global _ruaccent_instance
    if _ruaccent_instance is not None:
        return _ruaccent_instance

    try:
        from ruaccent import RUAccent
    except ImportError as exc:
        raise RuntimeError(
            "Russian premium TTS requires RUAccent. Install with: pip install ruaccent"
        ) from exc

    custom_dict = {
        source.lower(): accented_to_ruaccent(stressed)
        for source, stressed in registry.get("russianStressOverrides", {}).items()
    }

    accentizer = RUAccent()
    accentizer.load(
        omograph_model_size=os.getenv("RUACCENT_MODEL", "tiny2.1"),
        use_dictionary=True,
        custom_dict=custom_dict,
        device=os.getenv("RUACCENT_DEVICE", "CPU"),
        workdir=os.getenv("RUACCENT_WORKDIR") or None,
        tiny_mode=False,
    )
    _ruaccent_instance = accentizer
    return accentizer


def stress_russian_text(text: str, registry: dict) -> str:
    clean = strip_stress_marks(text)
    accentizer = _get_ruaccent(registry)
    stressed_plus = accentizer.process_all(clean)
    return ruaccent_to_combining_acute(stressed_plus)


def split_brand_segments(text: str, base_language: str, registry: dict) -> list[tuple[str, str]]:
    brands = registry.get("brands", [])
    aliases: list[tuple[str, dict]] = []
    for brand in brands:
        for alias in brand.get("aliases", []):
            aliases.append((alias, brand))
    aliases.sort(key=lambda item: len(item[0]), reverse=True)

    if not aliases:
        return [(base_language, text)]

    pattern = re.compile(
        "|".join(f"({re.escape(alias)})" for alias, _ in aliases),
        flags=re.IGNORECASE | re.UNICODE,
    )
    alias_map = {alias.casefold(): brand for alias, brand in aliases}

    segments: list[tuple[str, str]] = []
    cursor = 0
    for match in pattern.finditer(text):
        if match.start() > cursor:
            segments.append((base_language, text[cursor:match.start()]))

        matched = match.group(0)
        brand = alias_map.get(matched.casefold())
        if brand:
            spoken = brand.get("spoken", {})
            brand_locale = str(spoken.get("locale", "en-US"))
            brand_language = brand_locale.split("-")[0].lower()
            segments.append((brand_language, str(spoken.get("text", matched))))
        else:
            segments.append((base_language, matched))
        cursor = match.end()

    if cursor < len(text):
        segments.append((base_language, text[cursor:]))

    return [(language, part) for language, part in segments if part.strip()]


def prepare_segment_text(text: str, language: str, registry: dict) -> str:
    prepared = text.strip()
    if language == "ru":
        prepared = stress_russian_text(prepared, registry)
    return prepared


def resolve_engine(requested: str, language: str) -> str:
    if requested != "auto":
        return requested

    # Approved VIIVERSION free presenter voice: Chatterbox V3.
    # Use it whenever installed and the locale is supported; otherwise keep
    # the lightweight Supertonic path as a zero-API-cost fallback.
    if language in CHATTERBOX_LANGUAGES and module_available("chatterbox"):
        return "chatterbox"
    return "supertonic"


def device_name(requested: str) -> str:
    if requested != "auto":
        return requested
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def synthesize_supertonic(args: argparse.Namespace, text: str) -> None:
    try:
        from supertonic import TTS
    except ImportError as exc:
        raise RuntimeError(
            "Supertonic is not installed. Run: pip install supertonic"
        ) from exc

    tts = TTS(auto_download=True)
    style = tts.get_voice_style(voice_name=args.voice or "M1")
    wav, _duration = tts.synthesize(
        text,
        voice_style=style,
        lang=args.language,
    )
    tts.save_audio(wav, args.output)


def synthesize_chatterbox(args: argparse.Namespace, text: str) -> None:
    try:
        import torchaudio as ta
        import perth

        # Upstream chatterbox can expose PerthImplicitWatermarker as None in
        # some environments. Fall back to the no-op watermarker so synthesis
        # remains available instead of failing during model construction.
        if not callable(getattr(perth, "PerthImplicitWatermarker", None)):
            perth.PerthImplicitWatermarker = perth.DummyWatermarker

        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        from chatterbox.models.tokenizers import tokenizer as tokenizer_module

        # We pre-stress Russian exactly once in this bridge, with controlled
        # overrides. Disable Chatterbox's second automatic stress pass so it
        # cannot rewrite our approved accents.
        tokenizer_module.add_russian_stress = lambda value: value
    except ImportError as exc:
        raise RuntimeError(
            "Chatterbox is not installed. Run: pip install chatterbox-tts"
        ) from exc

    device = device_name(args.device)

    # Chatterbox releases have changed the V3 loader signature. Prefer the
    # documented V3 argument and remain compatible with builds where V3 is
    # already the default and t3_model is no longer accepted.
    try:
        model = ChatterboxMultilingualTTS.from_pretrained(
            device=device,
            t3_model="v3",
        )
    except TypeError:
        model = ChatterboxMultilingualTTS.from_pretrained(device=device)

    registry = load_pronunciation_registry()
    segments = split_brand_segments(text, args.language, registry)
    rendered = []

    if args.reference_audio:
        model.prepare_conditionals(args.reference_audio)

    for index, (segment_language, segment_text) in enumerate(segments):
        prepared = prepare_segment_text(segment_text, segment_language, registry)
        if not prepared:
            continue

        # Avoid a hard full-stop between language spans. Chatterbox's punc_norm
        # adds punctuation automatically, so comma-terminate non-final spans.
        if index < len(segments) - 1 and prepared[-1] not in ",.!?-":
            prepared += ","

        wav = model.generate(
            prepared,
            language_id=segment_language,
            audio_prompt_path=None,
            cfg_weight=0.0 if segment_language != args.language else 0.5,
        )
        rendered.append(wav)

    if not rendered:
        raise RuntimeError("No speech segments were produced.")

    import torch
    gap = torch.zeros((1, int(model.sr * 0.025)), dtype=rendered[0].dtype)
    pieces = []
    for index, wav in enumerate(rendered):
        if index:
            pieces.append(gap)
        pieces.append(wav)
    combined = torch.cat(pieces, dim=1)
    ta.save(args.output, combined, model.sr)


def main() -> int:
    args = parse_args()
    text = sys.stdin.read().strip()
    if not text:
        raise RuntimeError("Narration text is empty.")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    engine = resolve_engine(args.engine, args.language)
    if engine == "chatterbox":
        try:
            synthesize_chatterbox(args, text)
        except Exception as exc:
            if args.engine != "auto":
                raise
            print(
                f"Chatterbox failed in auto mode ({exc}); falling back to Supertonic.",
                file=sys.stderr,
            )
            synthesize_supertonic(args, text)
    else:
        synthesize_supertonic(args, text)

    if not output.exists() or output.stat().st_size == 0:
        raise RuntimeError(f"TTS engine did not create audio: {output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"hf_tts.py: {exc}", file=sys.stderr)
        traceback.print_exc()
        raise SystemExit(1)
