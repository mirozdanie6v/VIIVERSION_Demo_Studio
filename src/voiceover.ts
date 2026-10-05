import type {
  VoicePersonaId,
  VoiceProviderId,
  VoiceResult,
} from "./voice-engine-types.js";
import { synthesizeVoice } from "./voice-router.js";

export function defaultPresentationLocale(text: string): "ru-RU" | "en-US" {
  const cyrillic = (text.match(/[А-Яа-яЁё]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return cyrillic > latin ? "ru-RU" : "en-US";
}

export type VoiceoverOptions = {
  apiKey?: string;
  model?: string;
  voice?: string;
  instructions?: string;
  locale?: string;
  provider?: VoiceProviderId | "auto";
  persona?: VoicePersonaId;
  pronunciation?: Record<string, string>;
  requireNativeTimings?: boolean;
};

export async function createVoiceoverResult(
  text: string,
  outputPath: string,
  options: VoiceoverOptions = {},
): Promise<VoiceResult> {
  const env = { ...process.env };

  if (options.apiKey) {
    if (options.provider === "elevenlabs") {
      env.ELEVENLABS_API_KEY = options.apiKey;
    } else {
      env.OPENAI_API_KEY = options.apiKey;
    }
  }

  return synthesizeVoice(
    {
      text,
      outputPath,
      locale: options.locale ?? defaultPresentationLocale(text),
      provider: options.provider ?? "auto",
      model: options.model,
      voiceId: options.voice,
      persona: options.persona ?? "viiversion-presenter",
      instructions: options.instructions,
      pronunciation: options.pronunciation,
      requireNativeTimings: options.requireNativeTimings,
    },
    { context: { env } },
  );
}

export async function createVoiceover(
  text: string,
  outputPath: string,
  options: VoiceoverOptions = {},
): Promise<string> {
  const result = await createVoiceoverResult(text, outputPath, options);
  return result.audioPath;
}
