import assert from "node:assert/strict";
import test from "node:test";
import { HuggingFaceVoiceProvider } from "../src/voice-provider-huggingface.js";

const baseRequest = {
  text: "Hello",
  locale: "en-US",
  outputPath: "/tmp/test.wav",
} as const;

test("Hugging Face provider stays opt-in for automatic routing", () => {
  const provider = new HuggingFaceVoiceProvider();
  assert.equal(provider.isConfigured(baseRequest, { env: {} }), false);
  assert.equal(
    provider.isConfigured(
      { ...baseRequest, provider: "huggingface" },
      { env: {} },
    ),
    true,
  );
  assert.equal(
    provider.isConfigured(baseRequest, { env: { HF_TTS_ENABLED: "1" } }),
    true,
  );
});

test("Supertonic local engine supports Russian and Vietnamese", () => {
  const provider = new HuggingFaceVoiceProvider();
  const context = { env: { HF_TTS_ENGINE: "supertonic" } };

  assert.equal(provider.supportsLocale("ru-RU", baseRequest, context), true);
  assert.equal(provider.supportsLocale("vi-VN", baseRequest, context), true);
  assert.equal(provider.supportsLocale("zh-CN", baseRequest, context), false);
});

test("Chatterbox local engine supports Russian and Chinese", () => {
  const provider = new HuggingFaceVoiceProvider();
  const context = { env: { HF_TTS_ENGINE: "chatterbox" } };

  assert.equal(provider.supportsLocale("ru-RU", baseRequest, context), true);
  assert.equal(provider.supportsLocale("zh-CN", baseRequest, context), true);
  assert.equal(provider.supportsLocale("vi-VN", baseRequest, context), false);
});
