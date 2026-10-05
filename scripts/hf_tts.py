#!/usr/bin/env python3
"""Local Hugging Face TTS bridge for VIIVERSION Demo Studio.

Reads UTF-8 narration from stdin and writes a WAV file. The first invocation
downloads model assets into the normal Hugging Face cache.
"""

from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path
import sys
import traceback


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

    kwargs = {}
    if args.reference_audio:
        kwargs["audio_prompt_path"] = args.reference_audio

    wav = model.generate(
        text,
        language_id=args.language,
        **kwargs,
    )
    ta.save(args.output, wav, model.sr)


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
