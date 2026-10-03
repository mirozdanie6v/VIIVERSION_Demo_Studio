import type {
  VoicePersonaId,
  VoiceProviderId,
  VoiceResult,
} from "./voice-engine-types.js";
import { synthesizeVoice } from "./voice-router.js";

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
      locale: options.locale ?? "en-US",
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
