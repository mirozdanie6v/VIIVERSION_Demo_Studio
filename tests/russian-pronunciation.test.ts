import assert from "node:assert/strict";
import test from "node:test";
import { directVoiceRequest } from "../src/voice-director.js";
import { applyDefaultLocalePronunciation } from "../src/russian-pronunciation.js";

test("applies approved Russian stress marks to business-demo vocabulary", () => {
  assert.equal(
    applyDefaultLocalePronunciation(
      "Запись, каталог, стоматологиям, салонам, клиникам, консультант, компанией.",
      "ru-RU",
    ),
    "За́пись, катало́г, стоматоло́гиям, сало́нам, кли́никам, консульта́нт, компа́нией.",
  );
});

test("preserves non-Russian text", () => {
  assert.equal(
    applyDefaultLocalePronunciation("catalog consultant", "en-US"),
    "catalog consultant",
  );
});

test("applies scenario pronunciation before Russian stress normalization", () => {
  const result = directVoiceRequest({
    text: "Свяжитесь с VIIVERSION. AVE Dental принимает запись.",
    locale: "ru-RU",
    outputPath: "/tmp/test.mp3",
    pronunciation: {
      VIIVERSION: "Виверсион",
      "AVE Dental": "Эй-ви-и Дентал",
    },
  });

  assert.equal(
    result.directedText,
    "Свяжитесь с Виве́рсион. Эй-ви-и Де́нтал принимает за́пись.",
  );
});
