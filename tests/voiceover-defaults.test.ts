import assert from "node:assert/strict";
import test from "node:test";
import { defaultPresentationLocale } from "../src/voiceover.js";

test("defaults Cyrillic narration to Russian", () => {
  assert.equal(
    defaultPresentationLocale("MAX TOUR помогает выбрать экскурсию и оформить бронирование."),
    "ru-RU",
  );
});

test("defaults Latin narration to English", () => {
  assert.equal(
    defaultPresentationLocale("MAX TOUR helps customers choose and book an excursion."),
    "en-US",
  );
});
