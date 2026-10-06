#!/usr/bin/env python3
from scripts.hf_tts import (
    load_pronunciation_registry,
    split_brand_segments,
    stress_russian_text,
)


def main() -> int:
    registry = load_pronunciation_registry()

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
            "Russian stress preflight failed; missing approved forms: "
            + ", ".join(missing)
            + f"\nActual: {stressed}"
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

    print("RUSSIAN_STRESS_PREFLIGHT=ok")
    print("BRAND_PRONUNCIATION_PREFLIGHT=ok")
    print(f"STRESSED_SAMPLE={stressed}")
    print(f"BRAND_SEGMENTS={segments}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
