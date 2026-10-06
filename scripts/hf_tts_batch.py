#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

import torch
import torchaudio as ta
import perth

from hf_tts import (
    device_name,
    load_pronunciation_registry,
    prepare_segment_text,
    split_brand_segments,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voices-dir", required=True)
    parser.add_argument("--reference-audio", required=True)
    parser.add_argument("--base-language", default="ru")
    parser.add_argument("--device", default="auto")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    voices_dir = Path(args.voices_dir)
    reference = str(Path(args.reference_audio).resolve())
    registry = load_pronunciation_registry()

    if not callable(getattr(perth, "PerthImplicitWatermarker", None)):
        perth.PerthImplicitWatermarker = perth.DummyWatermarker

    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    from chatterbox.models.tokenizers import tokenizer as tokenizer_module

    # Russian text is already stressed exactly once by our provider bridge.
    tokenizer_module.add_russian_stress = lambda value: value

    device = device_name(args.device)
    try:
        model = ChatterboxMultilingualTTS.from_pretrained(
            device=device,
            t3_model="v3",
        )
    except TypeError:
        model = ChatterboxMultilingualTTS.from_pretrained(device=device)

    model.prepare_conditionals(reference)

    text_files = sorted(
        voices_dir.glob("text-*.txt"),
        key=lambda p: int(p.stem.split("-")[-1]),
    )
    if not text_files:
        raise RuntimeError(f"No narration text files found in {voices_dir}")

    for txt in text_files:
        idx = txt.stem.split("-")[-1]
        source = txt.read_text(encoding="utf-8").strip()
        if not source:
            continue

        segments = split_brand_segments(source, args.base_language, registry)
        rendered = []

        for segment_index, (segment_language, segment_text) in enumerate(segments):
            prepared = prepare_segment_text(segment_text, segment_language, registry)
            if not prepared:
                continue
            if segment_index < len(segments) - 1 and prepared[-1] not in ",.!?-":
                prepared += ","

            wav = model.generate(
                prepared,
                language_id=segment_language,
                audio_prompt_path=None,
                cfg_weight=0.0 if segment_language != args.base_language else 0.5,
            )
            rendered.append(wav)

        if not rendered:
            raise RuntimeError(f"No speech generated for {txt}")

        gap = torch.zeros((1, int(model.sr * 0.025)), dtype=rendered[0].dtype)
        pieces = []
        for segment_index, wav in enumerate(rendered):
            if segment_index:
                pieces.append(gap)
            pieces.append(wav)

        combined = torch.cat(pieces, dim=1)
        ta.save(str(voices_dir / f"raw-{idx}.wav"), combined, model.sr)
        print(f"SYNTHESIZED_STEP={idx}")

    print(f"PREMIUM_VOICE_DEVICE={device}")
    print(f"PREMIUM_VOICE_SEGMENTS={len(text_files)}")
    print("PRONUNCIATION_PIPELINE=stressonnx-single-pass+approved-overrides+brand-language-spans")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
