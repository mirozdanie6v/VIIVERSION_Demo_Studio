import { spawn } from "node:child_process";
import path from "node:path";
import type {
  VoiceProvider,
  VoiceProviderContext,
  VoiceRequest,
  VoiceResult,
} from "./voice-engine-types.js";
import { directVoiceRequest } from "./voice-director.js";

type HuggingFaceEngine = "supertonic" | "chatterbox";

const SUPERTONIC_LANGUAGES = new Set([
  "ar", "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hi",
  "hr", "hu", "id", "it", "ja", "ko", "lt", "lv", "nl", "pl", "pt", "ro",
  "ru", "sk", "sl", "sv", "tr", "uk", "vi",
]);

const CHATTERBOX_LANGUAGES = new Set([
  "ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja",
  "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh",
]);

function languageOf(locale: string): string {
  return locale.trim().replace(/_/g, "-").split("-")[0].toLowerCase();
}

function truthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function engineFrom(env: NodeJS.ProcessEnv): HuggingFaceEngine {
  const value = (env.HF_TTS_ENGINE ?? "supertonic").trim().toLowerCase();
  if (value === "chatterbox") return "chatterbox";
  return "supertonic";
}

function referenceKeys(locale: string): string[] {
  const normalized = locale.toUpperCase().replace(/-/g, "_");
  const language = normalized.split("_")[0];
  return [
    `HF_TTS_REFERENCE_AUDIO_${normalized}`,
    `HF_TTS_REFERENCE_AUDIO_${language}`,
    "HF_TTS_REFERENCE_AUDIO",
  ];
}

function resolveReferenceAudio(
  env: NodeJS.ProcessEnv,
  locale: string,
): string | undefined {
  return referenceKeys(locale).map((key) => env[key]).find(Boolean);
}

async function run(
  executable: string,
  args: string[],
  stdin: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["pipe", "ignore", "pipe"],
      env: { ...process.env, ...env },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `Hugging Face local TTS exited with code ${code ?? "unknown"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
          ),
        );
      }
    });
    child.stdin.end(stdin);
  });
}

async function transcode(
  source: string,
  target: string,
  ffmpeg: string,
): Promise<void> {
  await run(
    ffmpeg,
    ["-y", "-i", source, "-c:a", "libmp3lame", "-b:a", "192k", target],
    "",
  );
}

export class HuggingFaceVoiceProvider implements VoiceProvider {
  readonly id = "huggingface" as const;
  readonly nativeTimings = false;

  isConfigured(
    request: VoiceRequest,
    context: VoiceProviderContext = {},
  ): boolean {
    const env = context.env ?? process.env;
    return (
      request.provider === "huggingface" ||
      truthy(env.HF_TTS_ENABLED) ||
      Boolean(env.HF_TTS_ENGINE)
    );
  }

  supportsLocale(
    locale: string,
    _request: VoiceRequest,
    context: VoiceProviderContext = {},
  ): boolean {
    const env = context.env ?? process.env;
    const language = languageOf(locale);
    return engineFrom(env) === "chatterbox"
      ? CHATTERBOX_LANGUAGES.has(language)
      : SUPERTONIC_LANGUAGES.has(language);
  }

  async synthesize(
    request: VoiceRequest,
    context: VoiceProviderContext = {},
  ): Promise<VoiceResult> {
    const directed = directVoiceRequest(request);
    const env = context.env ?? process.env;
    const engine = engineFrom(env);
    const python = env.HF_TTS_PYTHON ?? "python3";
    const script = env.HF_TTS_SCRIPT ?? path.resolve(process.cwd(), "scripts", "hf_tts.py");
    const language = languageOf(directed.locale);
    const voiceId =
      request.voiceId ??
      env.HF_TTS_VOICE ??
      (engine === "supertonic" ? "M1" : "default");
    const wavPath = request.outputPath.toLowerCase().endsWith(".wav")
      ? request.outputPath
      : request.outputPath + ".wav";

    const args = [
      script,
      "--engine",
      engine,
      "--locale",
      directed.locale,
      "--language",
      language,
      "--output",
      wavPath,
      "--voice",
      voiceId,
      "--device",
      env.HF_TTS_DEVICE ?? "auto",
    ];

    const referenceAudio = resolveReferenceAudio(env, directed.locale);
    if (referenceAudio) {
      args.push("--reference-audio", referenceAudio);
    }
    if (request.model) {
      args.push("--model", request.model);
    }

    await run(python, args, directed.directedText, env);

    if (wavPath !== request.outputPath) {
      await transcode(wavPath, request.outputPath, env.FFMPEG_PATH ?? "ffmpeg");
    }

    return {
      provider: this.id,
      locale: directed.locale,
      model:
        request.model ??
        (engine === "chatterbox"
          ? "ResembleAI/chatterbox-multilingual-v3"
          : "Supertone/supertonic-3"),
      voiceId,
      audioPath: request.outputPath,
      timings: [],
      hasNativeTimings: false,
      directedText: directed.directedText,
      instructions: directed.resolvedInstructions,
    };
  }
}
