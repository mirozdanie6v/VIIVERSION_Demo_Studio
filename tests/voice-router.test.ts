import assert from "node:assert/strict";
import test from "node:test";
import { VoiceRouter } from "../src/voice-router.js";
import type {
  VoiceProvider,
  VoiceRequest,
  VoiceResult,
} from "../src/voice-engine-types.js";

class FakeProvider implements VoiceProvider {
  constructor(
    readonly id: "elevenlabs" | "openai" | "huggingface" | "piper",
    readonly nativeTimings: boolean,
    private readonly configured: boolean,
    private readonly locales: string[],
    private readonly fail = false,
  ) {}

  isConfigured(): boolean {
    return this.configured;
  }

  supportsLocale(locale: string): boolean {
    return this.locales.includes("*") || this.locales.includes(locale);
  }

  async synthesize(request: VoiceRequest): Promise<VoiceResult> {
    if (this.fail) throw new Error(`${this.id} failed`);
    return {
      provider: this.id,
      locale: request.locale,
      model: "fake",
      voiceId: "fake",
      audioPath: request.outputPath,
      timings: [],
      hasNativeTimings: this.nativeTimings,
      directedText: request.text,
      instructions: "",
    };
  }
}

const request: VoiceRequest = {
  text: "Hello",
  locale: "vi-VN",
  outputPath: "/tmp/voice.mp3",
  provider: "auto",
};

test("prefers configured provider order for arbitrary locales", () => {
  const router = new VoiceRouter({
    providers: [
      new FakeProvider("elevenlabs", true, true, ["*"]),
      new FakeProvider("openai", false, true, ["*"]),
      new FakeProvider("piper", false, true, ["vi-VN"]),
    ],
    context: { env: {} },
  });

  assert.equal(router.inspect(request).selected, "elevenlabs");
});

test("falls back when the preferred provider is unavailable", () => {
  const router = new VoiceRouter({
    providers: [
      new FakeProvider("elevenlabs", true, false, ["*"]),
      new FakeProvider("openai", false, true, ["*"]),
      new FakeProvider("piper", false, true, ["vi-VN"]),
    ],
    context: { env: {} },
  });

  assert.equal(router.inspect(request).selected, "openai");
});

test("requires a native-timing provider when precise synchronization is requested", () => {
  const router = new VoiceRouter({
    providers: [
      new FakeProvider("elevenlabs", true, true, ["*"]),
      new FakeProvider("openai", false, true, ["*"]),
    ],
    context: { env: {} },
  });

  const decision = router.inspect({ ...request, requireNativeTimings: true });
  assert.equal(decision.selected, "elevenlabs");
});

test("honors an explicit provider override", () => {
  const router = new VoiceRouter({
    providers: [
      new FakeProvider("elevenlabs", true, true, ["*"]),
      new FakeProvider("openai", false, true, ["*"]),
    ],
    context: { env: {} },
  });

  assert.equal(
    router.inspect({ ...request, provider: "openai" }).selected,
    "openai",
  );
});


test("falls back at runtime when an auto-selected provider errors", async () => {
  const router = new VoiceRouter({
    providers: [
      new FakeProvider("elevenlabs", true, true, ["*"], true),
      new FakeProvider("openai", false, true, ["*"]),
    ],
    context: { env: {} },
  });

  const result = await router.synthesize(request);
  assert.equal(result.provider, "openai");
});


test("prefers enabled local Hugging Face TTS before paid providers", () => {
  const router = new VoiceRouter({
    providers: [
      new FakeProvider("huggingface", false, true, ["vi-VN"]),
      new FakeProvider("elevenlabs", true, true, ["*"]),
      new FakeProvider("openai", false, true, ["*"]),
    ],
    context: { env: {} },
  });

  assert.equal(router.inspect(request).selected, "huggingface");
});


test("prefers premium ElevenLabs presenter for Russian in auto mode", () => {
  const router = new VoiceRouter({
    providers: [
      new FakeProvider("huggingface", false, true, ["ru-RU"]),
      new FakeProvider("elevenlabs", true, true, ["*"]),
      new FakeProvider("openai", false, true, ["*"]),
    ],
    context: { env: {} },
  });

  assert.equal(
    router.inspect({ ...request, locale: "ru-RU", persona: "viiversion-presenter" }).selected,
    "elevenlabs",
  );
});

test("prefers premium ElevenLabs presenter for English in auto mode", () => {
  const router = new VoiceRouter({
    providers: [
      new FakeProvider("huggingface", false, true, ["en-US"]),
      new FakeProvider("elevenlabs", true, true, ["*"]),
      new FakeProvider("openai", false, true, ["*"]),
    ],
    context: { env: {} },
  });

  assert.equal(
    router.inspect({ ...request, locale: "en-US", persona: "viiversion-presenter" }).selected,
    "elevenlabs",
  );
});

test("premium locale preference does not override an explicit provider", () => {
  const router = new VoiceRouter({
    providers: [
      new FakeProvider("huggingface", false, true, ["ru-RU"]),
      new FakeProvider("elevenlabs", true, true, ["*"]),
    ],
    context: { env: {} },
  });

  assert.equal(
    router.inspect({ ...request, locale: "ru-RU", provider: "huggingface" }).selected,
    "huggingface",
  );
});


test("strict premium mode refuses non-premium fallback for Russian presenter", () => {
  const router = new VoiceRouter({
    providers: [
      new FakeProvider("elevenlabs", true, false, ["*"]),
      new FakeProvider("huggingface", false, false, ["ru-RU"]),
      new FakeProvider("openai", false, true, ["*"]),
      new FakeProvider("piper", false, true, ["ru-RU"]),
    ],
    context: { env: { DEMO_STUDIO_REQUIRE_PREMIUM_VOICE: "true" } },
  });

  assert.equal(
    router.inspect({ ...request, locale: "ru-RU", persona: "viiversion-presenter" }).selected,
    undefined,
  );
});

test("strict premium mode accepts approved premium provider", () => {
  const router = new VoiceRouter({
    providers: [
      new FakeProvider("huggingface", false, true, ["en-US"]),
      new FakeProvider("openai", false, true, ["*"]),
      new FakeProvider("piper", false, true, ["en-US"]),
    ],
    context: { env: { DEMO_STUDIO_REQUIRE_PREMIUM_VOICE: "true" } },
  });

  assert.equal(
    router.inspect({ ...request, locale: "en-US", persona: "viiversion-presenter" }).selected,
    "huggingface",
  );
});
