import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { synthesizeVoice, VoiceRouter } from "./voice-router.js";
import type {
  VoicePersonaId,
  VoiceProviderId,
} from "./voice-engine-types.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function has(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const locale = arg("--locale");
  const output = arg("--out");
  const inlineText = arg("--text");
  const textFile = arg("--text-file");

  if (!locale || !output || (!inlineText && !textFile)) {
    throw new Error(
      "Usage: npm run voice -- --locale en-US --text \"Hello\" --out speech.mp3 [--provider auto|huggingface|elevenlabs|openai|piper]",
    );
  }

  const text = inlineText ?? await readFile(path.resolve(textFile!), "utf8");
  const provider = (arg("--provider") ?? "auto") as VoiceProviderId | "auto";
  const persona = (arg("--persona") ?? "viiversion-presenter") as VoicePersonaId;
  const request = {
    text,
    locale,
    outputPath: path.resolve(output),
    provider,
    voiceId: arg("--voice"),
    model: arg("--model"),
    persona,
    instructions: arg("--instructions"),
    requireNativeTimings: has("--require-timings"),
  };

  const router = new VoiceRouter();
  const route = router.inspect(request);
  const result = await synthesizeVoice(request);

  const manifestPath = result.audioPath + ".voice.json";
  await writeFile(
    manifestPath,
    JSON.stringify({ route, result }, null, 2) + "\n",
    "utf8",
  );

  console.log(JSON.stringify({ route, result, manifestPath }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
