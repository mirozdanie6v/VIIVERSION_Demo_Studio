import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPronunciation } from "./voice-director.js";
import { synthesizeVoice, VoiceRouter } from "./voice-router.js";
import type {
  VoicePersonaId,
  VoiceProviderId,
} from "./voice-engine-types.js";

type ScenarioVoice = {
  locale?: string;
  provider?: VoiceProviderId | "auto";
  voiceId?: string;
  model?: string;
  persona?: VoicePersonaId;
  instructions?: string;
  pronunciation?: Record<string, string>;
};

type Scenario = {
  voice?: ScenarioVoice;
  steps: Array<{
    narration?: string;
    voiceText?: string;
  }>;
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function run(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, ...env },
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${executable} exited with code ${code ?? "unknown"}.`));
    });
  });
}

function languageOf(locale: string): string {
  return locale.trim().replace(/_/g, "-").split("-")[0].toLowerCase();
}

function inferLocale(text: string): string {
  const cyrillic = (text.match(/[А-Яа-яЁё]/g) ?? []).length;
  const letters = (text.match(/[A-Za-zА-Яа-яЁё]/g) ?? []).length;
  return letters > 0 && cyrillic / letters > 0.35 ? "ru-RU" : "en-US";
}

async function main() {
  const scenarioArg = arg("--scenario");
  const runArg = arg("--run");
  if (!scenarioArg || !runArg) {
    throw new Error(
      "Usage: npm run voice:scenario -- --scenario examples/demo.json --run artifacts/<run-id>",
    );
  }

  const scenarioPath = path.resolve(scenarioArg);
  const runDir = path.resolve(runArg);
  const batchReference = arg("--reference-audio");
  const scenario = JSON.parse(
    await readFile(scenarioPath, "utf8"),
  ) as Scenario;
  const voicesDir = path.join(runDir, "voices");
  await mkdir(voicesDir, { recursive: true });

  const router = new VoiceRouter();
  const manifest: Array<Record<string, unknown>> = [];

  if (batchReference) {
    const referencePath = path.resolve(batchReference);
    const locale =
      scenario.voice?.locale ??
      inferLocale(
        scenario.steps
          .map((step) => step.narration ?? "")
          .join(" "),
      );
    const baseLanguage = languageOf(locale);
    const pronunciation = scenario.voice?.pronunciation ?? {};

    for (let index = 0; index < scenario.steps.length; index += 1) {
      const step = scenario.steps[index];
      const narration = step.narration?.trim();
      if (!narration) continue;
      const source = step.voiceText?.trim() || narration;
      const spoken = applyPronunciation(source, pronunciation);
      await writeFile(
        path.join(voicesDir, `text-${index}.txt`),
        spoken + "\n",
        "utf8",
      );
    }

    const python = process.env.HF_TTS_PYTHON ?? "python3";
    const batchScript = path.resolve(
      process.cwd(),
      "scripts",
      "hf_tts_batch.py",
    );
    await run(
      python,
      [
        batchScript,
        "--voices-dir",
        voicesDir,
        "--reference-audio",
        referencePath,
        "--base-language",
        baseLanguage,
        "--device",
        process.env.HF_TTS_DEVICE ?? "auto",
      ],
    );

    for (let index = 0; index < scenario.steps.length; index += 1) {
      const narration = scenario.steps[index].narration?.trim();
      if (!narration) continue;

      const raw = path.join(voicesDir, `raw-${index}.wav`);
      const outputPath = path.join(voicesDir, `step-${index}.mp3`);
      await run(
        process.env.FFMPEG_PATH ?? "ffmpeg",
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          raw,
          "-af",
          "highpass=f=70,lowpass=f=11500,acompressor=threshold=-18dB:ratio=1.55:attack=18:release=220,loudnorm=I=-16:TP=-1.5:LRA=8",
          "-c:a",
          "libmp3lame",
          "-b:a",
          "224k",
          outputPath,
        ],
      );

      manifest.push({
        stepIndex: index,
        locale,
        selected: "huggingface",
        provider: "huggingface",
        model: "ResembleAI/chatterbox-multilingual-v3",
        voiceId: "approved-niki-reference",
        audio: path.basename(outputPath),
      });
    }

    await writeFile(
      path.join(runDir, "voice-segments.json"),
      JSON.stringify(
        {
          version: "scenario-voice-v1",
          scenario: path.basename(scenarioPath),
          batch: true,
          reference: path.basename(referencePath),
          segments: manifest,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    console.log(
      JSON.stringify(
        {
          voiceSegments: manifest.length,
          providers: ["huggingface"],
          batch: true,
        },
        null,
        2,
      ),
    );
    return;
  }

  for (let index = 0; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index];
    const narration = step.narration?.trim();
    if (!narration) continue;

    const text = step.voiceText?.trim() || narration;
    const locale = scenario.voice?.locale ?? inferLocale(text);
    const outputPath = path.join(voicesDir, `step-${index}.mp3`);
    const request = {
      text,
      locale,
      outputPath,
      provider: scenario.voice?.provider ?? "auto",
      voiceId: scenario.voice?.voiceId,
      model: scenario.voice?.model,
      persona: scenario.voice?.persona ?? "viiversion-presenter",
      instructions: scenario.voice?.instructions,
      pronunciation: scenario.voice?.pronunciation,
      requireNativeTimings: false,
    };

    const route = router.inspect(request);
    if (!route.selected) {
      throw new Error(
        `No approved voice route for step ${index} (${locale}). Candidates: ${JSON.stringify(route.candidates)}`,
      );
    }

    const result = await synthesizeVoice(request);
    manifest.push({
      stepIndex: index,
      locale,
      selected: route.selected,
      provider: result.provider,
      model: result.model,
      voiceId: result.voiceId,
      audio: path.basename(result.audioPath),
    });
  }

  if (!manifest.length) {
    throw new Error("Scenario has no narration to synthesize.");
  }

  await writeFile(
    path.join(runDir, "voice-segments.json"),
    JSON.stringify(
      {
        version: "scenario-voice-v1",
        scenario: path.basename(scenarioPath),
        segments: manifest,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        voiceSegments: manifest.length,
        providers: [...new Set(manifest.map((item) => item.provider))],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
