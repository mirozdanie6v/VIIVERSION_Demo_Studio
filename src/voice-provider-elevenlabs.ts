import { writeFile } from "node:fs/promises";
import type {
  VoiceProvider,
  VoiceProviderContext,
  VoiceRequest,
  VoiceResult,
  VoiceTiming,
} from "./voice-engine-types.js";
import { directVoiceRequest } from "./voice-director.js";
import { applyBrandSpokenAliases, brandPronunciationRules } from "./pronunciation-registry.js";

type Alignment = {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
};

type PronunciationDictionaryLocator = {
  pronunciation_dictionary_id: string;
  version_id: string;
};

const BRAND_DICTIONARY_NAME = "VIIVERSION Brand Pronunciations";
let brandDictionaryPromise: Promise<PronunciationDictionaryLocator | undefined> | undefined;

async function ensureBrandPronunciationDictionary(
  apiKey: string,
): Promise<PronunciationDictionaryLocator | undefined> {
  if (brandDictionaryPromise) return brandDictionaryPromise;

  brandDictionaryPromise = (async () => {
    const headers = {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    };

    const listResponse = await fetch(
      "https://api.elevenlabs.io/v1/pronunciation-dictionaries?page_size=100",
      { headers },
    );
    if (!listResponse.ok) return undefined;

    const listPayload = (await listResponse.json()) as {
      pronunciation_dictionaries?: Array<{
        id: string;
        name: string;
        latest_version_id?: string;
      }>;
    };
    const existing = listPayload.pronunciation_dictionaries?.find(
      (item) => item.name === BRAND_DICTIONARY_NAME,
    );
    const rules = brandPronunciationRules();

    if (existing) {
      const update = await fetch(
        `https://api.elevenlabs.io/v1/pronunciation-dictionaries/${encodeURIComponent(existing.id)}/set-rules`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ rules }),
        },
      );
      if (!update.ok) return undefined;
      const payload = (await update.json()) as { id: string; version_id: string };
      return {
        pronunciation_dictionary_id: payload.id,
        version_id: payload.version_id,
      };
    }

    const create = await fetch(
      "https://api.elevenlabs.io/v1/pronunciation-dictionaries/add-from-rules",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: BRAND_DICTIONARY_NAME,
          description: "Canonical VIIVERSION product and client brand pronunciations.",
          rules,
        }),
      },
    );
    if (!create.ok) return undefined;
    const payload = (await create.json()) as { id: string; version_id: string };
    return {
      pronunciation_dictionary_id: payload.id,
      version_id: payload.version_id,
    };
  })();

  return brandDictionaryPromise;
}

function localeEnvKey(prefix: string, locale: string): string[] {
  const normalized = locale.toUpperCase().replace(/-/g, "_");
  const language = normalized.split("_")[0];
  return [`${prefix}_${normalized}`, `${prefix}_${language}`, prefix];
}

function resolveEnv(
  env: NodeJS.ProcessEnv,
  prefix: string,
  locale: string,
): string | undefined {
  return localeEnvKey(prefix, locale)
    .map((key) => env[key])
    .find((value) => Boolean(value?.trim()));
}

export class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly id = "elevenlabs" as const;
  readonly nativeTimings = true;

  isConfigured(request: VoiceRequest, context: VoiceProviderContext = {}): boolean {
    const env = context.env ?? process.env;
    return Boolean(
      env.ELEVENLABS_API_KEY &&
      (request.voiceId || resolveEnv(env, "ELEVENLABS_VOICE_ID", request.locale)),
    );
  }

  supportsLocale(requestLocale: string): boolean {
    return Boolean(requestLocale.trim());
  }

  async synthesize(
    request: VoiceRequest,
    context: VoiceProviderContext = {},
  ): Promise<VoiceResult> {
    const directed = directVoiceRequest(request);
    const env = context.env ?? process.env;
    const apiKey = env.ELEVENLABS_API_KEY;
    const voiceId =
      request.voiceId ??
      resolveEnv(env, "ELEVENLABS_VOICE_ID", directed.locale);
    if (!apiKey || !voiceId) {
      throw new Error(
        "ElevenLabs requires ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID (global, language, or locale-specific).",
      );
    }

    const model =
      request.model ??
      resolveEnv(env, "ELEVENLABS_MODEL", directed.locale) ??
      "eleven_v3";

    const brandDictionary =
      model === "eleven_v3" || model === "eleven_v4"
        ? await ensureBrandPronunciationDictionary(apiKey)
        : undefined;
    const providerText = brandDictionary
      ? directed.directedText
      : applyBrandSpokenAliases(directed.directedText);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: model === "eleven_v3"
            ? `[warm] [confident] [conversational] ${providerText}`
            : providerText,
          model_id: model,
          ...(model === "eleven_v3" || model === "eleven_v4"
            ? { language_code: directed.locale.split("-")[0].toLowerCase() }
            : {}),
          ...(brandDictionary
            ? { pronunciation_dictionary_locators: [brandDictionary] }
            : {}),
          voice_settings: {
            stability: Number(env.ELEVENLABS_STABILITY ?? "0.43"),
            similarity_boost: Number(env.ELEVENLABS_SIMILARITY_BOOST ?? "0.78"),
            style: Number(env.ELEVENLABS_STYLE ?? "0.28"),
            use_speaker_boost: true,
          },
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ElevenLabs TTS failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as {
      audio_base64?: string;
      alignment?: Alignment;
      normalized_alignment?: Alignment;
    };

    if (!payload.audio_base64) {
      throw new Error("ElevenLabs returned no audio.");
    }

    await writeFile(request.outputPath, Buffer.from(payload.audio_base64, "base64"));

    const alignment = payload.normalized_alignment ?? payload.alignment ?? {};
    const chars = alignment.characters ?? [];
    const starts = alignment.character_start_times_seconds ?? [];
    const ends = alignment.character_end_times_seconds ?? [];
    const timings: VoiceTiming[] = chars
      .map((character, index) => ({
        character,
        startSeconds: starts[index] ?? 0,
        endSeconds: ends[index] ?? starts[index] ?? 0,
      }))
      .filter((item) => item.endSeconds >= item.startSeconds);

    return {
      provider: this.id,
      locale: directed.locale,
      model,
      voiceId,
      audioPath: request.outputPath,
      timings,
      hasNativeTimings: timings.length > 0,
      directedText: directed.directedText,
      instructions: directed.resolvedInstructions,
    };
  }
}
