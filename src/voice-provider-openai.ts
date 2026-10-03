import { writeFile } from "node:fs/promises";
import type {
  VoiceProvider,
  VoiceProviderContext,
  VoiceRequest,
  VoiceResult,
} from "./voice-engine-types.js";
import { directVoiceRequest } from "./voice-director.js";

export class OpenAIVoiceProvider implements VoiceProvider {
  readonly id = "openai" as const;
  readonly nativeTimings = false;

  isConfigured(_request: VoiceRequest, context: VoiceProviderContext = {}): boolean {
    const env = context.env ?? process.env;
    return Boolean(env.OPENAI_API_KEY);
  }

  supportsLocale(locale: string): boolean {
    return Boolean(locale.trim());
  }

  async synthesize(
    request: VoiceRequest,
    context: VoiceProviderContext = {},
  ): Promise<VoiceResult> {
    const directed = directVoiceRequest(request);
    const env = context.env ?? process.env;
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is required.");

    const model = request.model ?? env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
    const voiceId = request.voiceId ?? env.OPENAI_TTS_VOICE ?? "marin";

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice: voiceId,
        input: directed.directedText,
        instructions: directed.resolvedInstructions,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI speech generation failed (${response.status}): ${body}`);
    }

    await writeFile(request.outputPath, Buffer.from(await response.arrayBuffer()));

    return {
      provider: this.id,
      locale: directed.locale,
      model,
      voiceId,
      audioPath: request.outputPath,
      timings: [],
      hasNativeTimings: false,
      directedText: directed.directedText,
      instructions: directed.resolvedInstructions,
    };
  }
}
