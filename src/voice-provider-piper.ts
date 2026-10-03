import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  VoiceProvider,
  VoiceProviderContext,
  VoiceRequest,
  VoiceResult,
} from "./voice-engine-types.js";
import { directVoiceRequest } from "./voice-director.js";

function modelKeys(locale: string): string[] {
  const normalized = locale.toUpperCase().replace(/-/g, "_");
  const language = normalized.split("_")[0];
  return [`PIPER_MODEL_${normalized}`, `PIPER_MODEL_${language}`, "PIPER_MODEL"];
}

function resolveModel(env: NodeJS.ProcessEnv, locale: string): string | undefined {
  return modelKeys(locale).map((key) => env[key]).find(Boolean);
}

async function runPiper(
  executable: string,
  model: string,
  text: string,
  outputPath: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ["--model", model, "--output_file", outputPath], {
      stdio: ["pipe", "ignore", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`piper exited with code ${code ?? "unknown"}`));
    });
    child.stdin.end(text + "\n");
  });
}

export class PiperVoiceProvider implements VoiceProvider {
  readonly id = "piper" as const;
  readonly nativeTimings = false;

  isConfigured(request: VoiceRequest, context: VoiceProviderContext = {}): boolean {
    const env = context.env ?? process.env;
    return Boolean(request.model || resolveModel(env, request.locale));
  }

  supportsLocale(locale: string, request: VoiceRequest, context: VoiceProviderContext = {}): boolean {
    const env = context.env ?? process.env;
    return Boolean(request.model || resolveModel(env, locale));
  }

  async synthesize(
    request: VoiceRequest,
    context: VoiceProviderContext = {},
  ): Promise<VoiceResult> {
    const directed = directVoiceRequest(request);
    const env = context.env ?? process.env;
    const model = request.model ?? resolveModel(env, directed.locale);
    if (!model) {
      throw new Error(`No Piper model configured for locale ${directed.locale}.`);
    }

    const executable = env.PIPER_BIN ?? "piper";
    const wavPath = request.outputPath.toLowerCase().endsWith(".wav")
      ? request.outputPath
      : request.outputPath + ".wav";

    await runPiper(executable, model, directed.directedText, wavPath);

    if (wavPath !== request.outputPath) {
      await writeFile(request.outputPath, await readFile(wavPath));
    }

    return {
      provider: this.id,
      locale: directed.locale,
      model: path.basename(model),
      voiceId: path.basename(model),
      audioPath: request.outputPath,
      timings: [],
      hasNativeTimings: false,
      directedText: directed.directedText,
      instructions: directed.resolvedInstructions,
    };
  }
}
