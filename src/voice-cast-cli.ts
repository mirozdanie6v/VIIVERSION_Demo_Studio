import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { VoiceRouter } from "./voice-router.js";
import type { VoicePersonaId, VoiceProviderId } from "./voice-engine-types.js";

type CastConfig = {
  persona?: VoicePersonaId;
  instructions?: string;
  samples: Array<{
    locale: string;
    text: string;
    pronunciation?: Record<string, string>;
  }>;
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function safeLocale(locale: string): string {
  return locale.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

async function main() {
  const configPath = arg("--config");
  const outArg = arg("--out");
  if (!configPath || !outArg) {
    throw new Error(
      "Usage: npm run voice:cast -- --config examples/voice-cast.json --out artifacts/voice-cast",
    );
  }

  const config = JSON.parse(
    await readFile(path.resolve(configPath), "utf8"),
  ) as CastConfig;

  const outDir = path.resolve(outArg);
  await mkdir(outDir, { recursive: true });

  const candidates: Array<{
    provider: VoiceProviderId;
    voiceId?: string;
    label: string;
  }> = [
    { provider: "openai", voiceId: "marin", label: "openai-marin" },
    { provider: "openai", voiceId: "cedar", label: "openai-cedar" },
    { provider: "elevenlabs", label: "elevenlabs-v3" },
  ];

  const report: {
    generatedAt: string;
    persona: VoicePersonaId;
    instructions?: string;
    results: Array<Record<string, unknown>>;
  } = {
    generatedAt: new Date().toISOString(),
    persona: config.persona ?? "viiversion-presenter",
    instructions: config.instructions,
    results: [],
  };

  for (const sample of config.samples) {
    for (const candidate of candidates) {
      const router = new VoiceRouter();
      const baseRequest = {
        text: sample.text,
        locale: sample.locale,
        outputPath: path.join(
          outDir,
          `${safeLocale(sample.locale)}-${candidate.label}.mp3`,
        ),
        provider: candidate.provider,
        voiceId: candidate.voiceId,
        persona: config.persona ?? "viiversion-presenter",
        instructions: config.instructions,
        pronunciation: sample.pronunciation,
        requireNativeTimings: candidate.provider === "elevenlabs",
      } as const;

      const route = router.inspect(baseRequest);
      const routeCandidate = route.candidates.find(
        (item) => item.provider === candidate.provider,
      );

      if (!routeCandidate?.configured || !routeCandidate.localeSupported) {
        report.results.push({
          locale: sample.locale,
          label: candidate.label,
          provider: candidate.provider,
          status: "skipped",
          configured: routeCandidate?.configured ?? false,
          localeSupported: routeCandidate?.localeSupported ?? false,
          reason: "provider-not-configured-or-locale-unavailable",
        });
        continue;
      }

      try {
        const result = await router.synthesize(baseRequest);
        report.results.push({
          locale: sample.locale,
          label: candidate.label,
          provider: candidate.provider,
          status: "success",
          audioPath: path.basename(result.audioPath),
          model: result.model,
          voiceId: result.voiceId,
          hasNativeTimings: result.hasNativeTimings,
          timingPoints: result.timings.length,
          instructions: result.instructions,
        });
      } catch (error) {
        report.results.push({
          locale: sample.locale,
          label: candidate.label,
          provider: candidate.provider,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  await writeFile(
    path.join(outDir, "voice-cast-report.json"),
    JSON.stringify(report, null, 2) + "\n",
    "utf8",
  );

  const succeeded = report.results.filter((item) => item.status === "success");
  console.log(
    JSON.stringify(
      {
        outDir,
        total: report.results.length,
        success: succeeded.length,
        skipped: report.results.filter((item) => item.status === "skipped").length,
        errors: report.results.filter((item) => item.status === "error").length,
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
