import assert from "node:assert/strict";
import test from "node:test";
import { directVoiceRequest } from "../src/voice-director.js";
import {
  applyBrandSpokenAliases,
  brandPronunciationRules,
  loadPronunciationRegistry,
} from "../src/pronunciation-registry.js";

test("Voice Director does not pre-stress Russian before the provider", () => {
  const result = directVoiceRequest({
    text: "Запись, каталог и консультация.",
    locale: "ru-RU",
    outputPath: "/tmp/test.mp3",
  });

  assert.equal(result.directedText, "Запись, каталог и консультация.");
});

test("central brand registry owns VIIVERSION pronunciation", () => {
  assert.equal(
    applyBrandSpokenAliases(
      "VIIVERSION, Viversion, Viiversion и Виверсион.",
    ),
    "Vee Version, Vee Version, Vee Version и Vee Version.",
  );
});

test("VIIVERSION has an English spoken locale and IPA", () => {
  const brand = loadPronunciationRegistry().brands.find(
    (item) => item.id === "viiversion",
  );
  assert.ok(brand);
  assert.equal(brand.spoken.locale, "en-US");
  assert.equal(brand.spoken.text, "Vee Version");
  assert.equal(brand.spoken.ipa, "viː ˈvɝːʒən");
});

test("ElevenLabs dictionary rules include every VIIVERSION alias", () => {
  const rules = brandPronunciationRules();
  const variants = ["VIIVERSION", "Viversion", "Viiversion", "Виверсион"];
  for (const variant of variants) {
    assert.ok(
      rules.some(
        (rule) =>
          rule.string_to_replace === variant &&
          rule.type === "phoneme" &&
          rule.phoneme === "viː ˈvɝːʒən",
      ),
    );
  }
});
