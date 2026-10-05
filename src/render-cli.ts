import path from "node:path";
import { readFile } from "node:fs/promises";
import { buildNarration, renderRun, type RenderPreset } from "./render.js";
import { createVoiceover } from "./voiceover.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function has(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const runArg = arg("--run");
  if (!runArg) {
    throw new Error(
      "Usage: npm run render -- --run artifacts/<run-id> [--preset 16:9|9:16|1:1] [--tts] [--music file.mp3] [--music-bpm 120] [--hybrid]",
    );
  }

  const runDir = path.resolve(runArg);
  const preset = (arg("--preset") ?? "16:9") as RenderPreset;
  if (!["16:9", "9:16", "1:1"].includes(preset)) {
    throw new Error("--preset must be 16:9, 9:16 or 1:1.");
  }

  let voiceoverPath = arg("--voiceover");

  if (has("--tts")) {
    const manifest = JSON.parse(
      await readFile(path.join(runDir, "run.json"), "utf8"),
    ) as Parameters<typeof buildNarration>[0];
    const narration = buildNarration(manifest);
    if (!narration) {
      throw new Error(
        "No step narration found. Add narration to scenario steps before using --tts.",
      );
    }

    voiceoverPath = path.join(runDir, "voiceover.mp3");
    const scenarioVoice = manifest.scenario.voice;
    await createVoiceover(narration, voiceoverPath, {
      locale: arg("--locale") ?? scenarioVoice?.locale ?? "en-US",
      provider:
        (arg("--voice-provider") as "auto" | "huggingface" | "elevenlabs" | "openai" | "piper" | undefined) ??
        scenarioVoice?.provider ??
        "auto",
      voice: arg("--voice") ?? scenarioVoice?.voiceId,
      model: arg("--voice-model") ?? scenarioVoice?.model,
      persona: scenarioVoice?.persona ?? "viiversion-presenter",
      instructions:
        arg("--voice-instructions") ??
        scenarioVoice?.instructions,
      pronunciation: scenarioVoice?.pronunciation,
      requireNativeTimings:
        has("--require-voice-timings") ||
        scenarioVoice?.requireNativeTimings,
    });
  }

  const output = await renderRun({
    runDir,
    outputPath: arg("--output"),
    preset,
    captions: !has("--no-captions"),
    captionsFilePath: arg("--captions-file"),
    designContractPath: arg("--design-contract"),
    uxPreflightPath: arg("--ux-preflight"),
    voiceoverPath,
    musicPath: arg("--music"),
    musicVolume: arg("--music-volume")
      ? Number(arg("--music-volume"))
      : undefined,
    musicBpm: arg("--music-bpm")
      ? Number(arg("--music-bpm"))
      : undefined,
    musicBeatOffsetSeconds: arg("--music-beat-offset")
      ? Number(arg("--music-beat-offset"))
      : undefined,
    brandLabel: arg("--brand") ?? "VIIVERSION",
    cta: arg("--cta"),
    ctaSecondary: arg("--cta-secondary"),
    title: arg("--title"),
    intro: !has("--no-intro"),
    outro: !has("--no-outro"),
    introSeconds: arg("--intro-seconds") ? Number(arg("--intro-seconds")) : undefined,
    outroSeconds: arg("--outro-seconds") ? Number(arg("--outro-seconds")) : undefined,
    hybrid: has("--hybrid"),
    hybridStrict: has("--hybrid-strict"),
  });

  console.log(output);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
