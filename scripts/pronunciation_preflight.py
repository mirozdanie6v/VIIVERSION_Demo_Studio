#!/usr/bin/env python3
import argparse

from hf_tts import (
    accented_to_ruaccent,
    load_pronunciation_registry,
    ruaccent_to_combining_acute,
    split_brand_segments,
    stress_russian_text,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    registry = load_pronunciation_registry()

    for source, stressed in registry.get("russianStressOverrides", {}).items():
        round_trip = ruaccent_to_combining_acute(accented_to_ruaccent(stressed))
        if round_trip != stressed:
            raise SystemExit(
                f"Stress notation round-trip failed for {source}: {stressed} -> {round_trip}"
            )

    segments = split_brand_segments(
        "Свяжитесь с VIIVERSION. Также пишут Viversion и Виверсион.",
        "ru",
        registry,
    )
    english = [text for language, text in segments if language == "en"]
    if english != ["Vee Version", "Vee Version", "Vee Version"]:
        raise SystemExit(
            "Brand pronunciation preflight failed. "
            f"English spans: {english}; all segments: {segments}"
        )

    print("STRESS_REGISTRY_PREFLIGHT=ok")
    print("BRAND_PRONUNCIATION_PREFLIGHT=ok")
    print(f"BRAND_SEGMENTS={segments}")

    if args.full:
        stressed = stress_russian_text(
            "Запись, каталог, стоматологиям, салонам, клиникам, консультант, компанией.",
            registry,
        )
        required = [
            "за́пись",
            "катало́г",
            "стоматоло́гиям",
            "сало́нам",
            "кли́никам",
            "консульта́нт",
            "компа́нией",
        ]
        lowered = stressed.lower()
        missing = [word for word in required if word not in lowered]
        if missing:
            raise SystemExit(
                "RUAccent full preflight failed; missing approved forms: "
                + ", ".join(missing)
                + f"\nActual: {stressed}"
            )
        print("RUACCENT_FULL_PREFLIGHT=ok")
        print(f"STRESSED_SAMPLE={stressed}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
