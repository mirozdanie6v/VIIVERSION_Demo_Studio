import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
  const scenario = JSON.parse(
    await readFile(scenarioPath, "utf8"),
  ) as Scenario;
  const voicesDir = path.join(runDir, "voices");
  await mkdir(voicesDir, { recursive: true });

  const router = new VoiceRouter();
  const manifest: Array<Record<string, unknown>> = [];

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
