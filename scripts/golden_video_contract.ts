import { readFile } from "node:fs/promises";
import path from "node:path";

type GoldenCase = {
  id: string;
  scenario: string;
  workflow: string;
  locale: string;
};

type GoldenMatrix = {
  version: string;
  cases: GoldenCase[];
};

function fail(message: string): never {
  throw new Error(message);
}

async function text(file: string): Promise<string> {
  return await readFile(path.resolve(file), "utf8");
}

async function main() {
  const matrix = JSON.parse(
    await text("config/golden-video-matrix.json"),
  ) as GoldenMatrix;

  if (matrix.version !== "golden-video-v1") {
    fail("Unsupported golden video matrix version.");
  }
  if (matrix.cases.length !== 5) {
    fail(`Golden gate must cover exactly five release cases, found ${matrix.cases.length}.`);
  }

  for (const item of matrix.cases) {
    const scenario = JSON.parse(await text(item.scenario));
    const workflow = await text(item.workflow);
    const voice = scenario.voice ?? {};
    const narrated = scenario.steps.filter((step: any) =>
      typeof step.narration === "string" && step.narration.trim().length > 0
    );
    const last = narrated.at(-1);

    if (voice.locale !== item.locale) {
      fail(`${item.id}: expected voice locale ${item.locale}, got ${voice.locale ?? "missing"}.`);
    }
    if (voice.provider !== "auto") {
      fail(`${item.id}: golden scenario must use provider=auto so the production premium router is exercised.`);
    }
    if (voice.persona !== "viiversion-presenter") {
      fail(`${item.id}: golden scenario must use viiversion-presenter.`);
    }
    if (!last || !/VIIVERSION/i.test([last.narration, last.voiceText].filter(Boolean).join(" "))) {
      fail(`${item.id}: final spoken CTA must name VIIVERSION.`);
    }

    const scenarioText = JSON.stringify(scenario);
    if (!/(AI|ИИ)/i.test(scenarioText)) {
      fail(`${item.id}: scenario must include visible AI capability proof.`);
    }

    const requiredWorkflowTokens = [
      'workflow_call:',
      'DEMO_STUDIO_REQUIRE_PREMIUM_VOICE: "true"',
      'npm run voice:scenario',
      '--captions-file',
      '--intro-seconds',
      '--outro-seconds',
      '--cta',
      'voice-segments.json',
      'editor_brain.json',
      'editor_critic.json',
      'music_brain.json',
      'qa-intro.png',
      'qa-outro.png',
    ];
    for (const token of requiredWorkflowTokens) {
      if (!workflow.includes(token)) {
        fail(`${item.id}: workflow missing required production token: ${token}`);
      }
    }
    if (/\b(edge-tts|piper-tts|\bpiper\b)/i.test(workflow)) {
      fail(`${item.id}: legacy non-premium TTS is forbidden in golden workflows.`);
    }
  }

  const captionBrain = await text("src/caption-brain.ts");
  if (!/preset === "9:16"[\s\S]*fontSize:\s*50/.test(captionBrain)) {
    fail("Vertical production captions must remain at the approved 50px size.");
  }

  const render = await text("src/render.ts");

  // An inset inside a vertical 1080x1920 canvas is a Golden Gate blocker.
  // Subtitles retain their separate approved 50px overlay.
  const fullBleed = [
    "force_original_aspect_ratio=increase",
    "crop=${width}:${height}:(iw-ow)/2:(ih-oh)/2",
  ];
  for (const token of fullBleed) {
    if (!render.includes(token)) {
      fail(`Golden vertical video must fill the canvas; missing: ${token}`);
    }
  }
  if (render.includes("scale=900:1480:force_original_aspect_ratio=decrease")) {
    fail("Golden vertical video still contains the old undersized inset.");
  }

  const sync = await text("src/narration-sync-cli.ts");
  if (!sync.includes("Style: Default,DejaVu Sans,50")) {
    fail("Voice-synchronized ASS captions must remain at the approved 50px size.");
  }

  if (!render.includes("options.introSeconds ?? 2.2") ||
      !render.includes("options.outroSeconds ?? 4.8")) {
    fail("Premium intro/outro defaults drifted from the approved production policy.");
  }

  const worker = await text("cloudflare/worker.js");
  for (const token of [
    'DEMO_STUDIO_REQUIRE_PREMIUM_VOICE: "true"',
    'ELEVENLABS_API_KEY',
    'ACTIVE_VOICE_CONFIG_KEY',
  ]) {
    if (!worker.includes(token)) {
      fail(`Production Worker is missing premium voice runtime contract: ${token}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        version: matrix.version,
        cases: matrix.cases.map((item) => item.id),
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
