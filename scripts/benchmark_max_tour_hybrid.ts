import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { renderRun } from "../src/render.js";
import { runScenario } from "../src/runner.js";
import type { DemoScenario } from "../src/types.js";

process.env.DEMO_STUDIO_ALLOWED_HOSTS =
  process.env.DEMO_STUDIO_ALLOWED_HOSTS ?? "max-tour.viiversion.com";
process.env.ALLOW_PRIVATE_TARGETS = "false";
process.env.DEMO_STUDIO_REUSE_BROWSER = "false";

const root = path.resolve(
  process.env.MAX_TOUR_HYBRID_BENCHMARK_ROOT ??
    "/tmp/max-tour-hybrid-promotion-gate",
);
const scenarioPath = path.resolve(
  process.env.MAX_TOUR_SCENARIO ??
    "examples/max-tour-english-full-journey-v4.json",
);
const minimumImprovement = Number(
  process.env.MAX_TOUR_HYBRID_MIN_IMPROVEMENT ?? "0.15",
);
const minimumSsim = Number(
  process.env.MAX_TOUR_HYBRID_MIN_SSIM ?? "0.99",
);

await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });

const scenario = JSON.parse(
  await readFile(scenarioPath, "utf8"),
) as DemoScenario;

type TimelineEntry = {
  index: number;
  label: string;
  action: string;
  startedAt: string;
  finishedAt: string;
  success: boolean;
};

type RunManifest = {
  scenario: DemoScenario;
  timeline: TimelineEntry[];
  startedAt: string;
  finishedAt: string;
  videoPath?: string;
  success: boolean;
  captureMode?: string;
  hybridManifestPath?: string;
};

type EditorBrainArtifact = {
  qualityGate: {
    passed: boolean;
    checks: Record<string, boolean>;
    metrics: {
      meaningfulSteps: number;
      coveredMeaningfulSteps: number;
      weightedCoverage: number;
      sceneCount: number;
      sourceDurationSeconds: number;
      editedDurationSeconds: number;
    };
  };
  scenes: Array<{ stepIndexes: number[] }>;
};

type PipelineResult = {
  mode: "standard" | "hybrid";
  runDir: string;
  finalPath: string;
  captureMs: number;
  renderMs: number;
  totalMs: number;
  aiWaitMs: number;
  sourceDurationSeconds: number;
  editedDurationSeconds: number;
  weightedCoverage: number;
  finalSizeBytes: number;
};

function secondsBetween(startIso: string, endIso: string): number {
  return Math.max(0, (Date.parse(endIso) - Date.parse(startIso)) / 1000);
}

function timelineEntry(
  manifest: RunManifest,
  label: string,
): TimelineEntry {
  const item = manifest.timeline.find((entry) => entry.label === label);
  if (!item) throw new Error("Missing required MAX TOUR step: " + label);
  return item;
}

function assertFullJourney(manifest: RunManifest): void {
  assert.equal(manifest.success, true, "Capture run must report success.");
  assert.equal(
    manifest.timeline.length,
    scenario.steps.length,
    "Capture timeline must contain every v4 scenario step.",
  );
  const failed = manifest.timeline.filter((item) => !item.success);
  assert.deepEqual(failed, [], "Every MAX TOUR v4 step must succeed.");

  for (const label of [
    "Home",
    "Open Dalat Premium",
    "Ask a human excursion question",
    "Send AI question",
    "Wait for actual AI answer",
    "Read AI answer",
    "Start booking",
    "Select available date",
    "Enter hotel",
    "Calculate total",
    "Create booking",
    "Demo payment",
    "Wait booking confirmation",
    "Booking confirmation",
  ]) {
    assert.equal(timelineEntry(manifest, label).success, true);
  }
}

async function pipeline(
  mode: "standard" | "hybrid",
): Promise<PipelineResult> {
  const captureRoot = path.join(root, mode, "captures");
  const captureStarted = performance.now();
  const capture = await runScenario(scenario, {
    artifactsRoot: captureRoot,
    hybrid: mode === "hybrid",
  });
  const captureMs = performance.now() - captureStarted;

  const manifest = JSON.parse(
    await readFile(path.join(capture.runDir, "run.json"), "utf8"),
  ) as RunManifest;
  assertFullJourney(manifest);

  if (mode === "hybrid") {
    assert.equal(manifest.captureMode, "hybrid-prototype");
    const hybridManifest = JSON.parse(
      await readFile(
        manifest.hybridManifestPath ??
          path.join(capture.runDir, "hybrid_capture.json"),
        "utf8",
      ),
    ) as {
      plan: Array<{ label: string; mode: string }>;
      keyframes: Array<{ stepIndex: number; path: string }>;
    };
    const aiWait = hybridManifest.plan.find(
      (item) => item.label === "Wait for actual AI answer",
    );
    assert.equal(
      aiWait?.mode,
      "realtime",
      "The live AI-answer wait must remain realtime in hybrid capture.",
    );
    assert.ok(
      hybridManifest.keyframes.length > 5,
      "Hybrid capture must retain stable UI keyframes.",
    );
  }

  const finalPath = path.join(root, mode, "max-tour-v4-final.mp4");
  const renderStarted = performance.now();
  await renderRun({
    runDir: capture.runDir,
    outputPath: finalPath,
    preset: "9:16",
    captions: true,
    brandLabel: "VIIVERSION",
    title: "MAX TOUR · Customer Journey",
    cta: "A smoother path from discovery to booking",
    encoderPreset: "veryfast",
    hybrid: mode === "hybrid",
    hybridStrict: mode === "hybrid",
  });
  const renderMs = performance.now() - renderStarted;

  const editor = JSON.parse(
    await readFile(path.join(capture.runDir, "editor_brain.json"), "utf8"),
  ) as EditorBrainArtifact;
  assert.equal(editor.qualityGate.passed, true);
  assert.equal(editor.qualityGate.checks.sourceOverlapFree, true);
  assert.ok(
    editor.qualityGate.metrics.weightedCoverage >= 0.9,
    "Editor Brain weighted coverage must remain >= 0.90.",
  );

  const covered = new Set(
    editor.scenes.flatMap((scene) => scene.stepIndexes),
  );
  for (const label of [
    "Send AI question",
    "Start booking",
    "Calculate total",
    "Create booking",
    "Demo payment",
  ]) {
    const index = timelineEntry(manifest, label).index;
    assert.ok(
      covered.has(index),
      "Editor output must preserve the key action: " + label,
    );
  }

  const aiWait = timelineEntry(manifest, "Wait for actual AI answer");
  const aiWaitMs =
    Date.parse(aiWait.finishedAt) - Date.parse(aiWait.startedAt);

  return {
    mode,
    runDir: capture.runDir,
    finalPath,
    captureMs,
    renderMs,
    totalMs: captureMs + renderMs,
    aiWaitMs,
    sourceDurationSeconds: editor.qualityGate.metrics.sourceDurationSeconds,
    editedDurationSeconds: editor.qualityGate.metrics.editedDurationSeconds,
    weightedCoverage: editor.qualityGate.metrics.weightedCoverage,
    finalSizeBytes: (await stat(finalPath)).size,
  };
}

async function runProcess(
  executable: string,
  args: string[],
): Promise<string> {
  const stderr: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            executable +
              " exited with code " +
              String(code) +
              ": " +
              stderr.join("").slice(-5000),
          ),
        );
      }
    });
  });
  return stderr.join("");
}

async function extractFrame(
  videoPath: string,
  seconds: number,
  outputPath: string,
): Promise<void> {
  await runProcess(process.env.FFMPEG_PATH ?? "ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-ss",
    Math.max(0, seconds).toFixed(3),
    "-frames:v",
    "1",
    outputPath,
  ]);
}

async function imageSsim(a: string, b: string): Promise<number> {
  const stderr = await runProcess(process.env.FFMPEG_PATH ?? "ffmpeg", [
    "-i",
    a,
    "-i",
    b,
    "-lavfi",
    // Two independent Chromium sessions can differ by a few subpixels in
    // font antialiasing, caret/focus paint and soft CSS glows even when the
    // perceived UI is identical. A 2 px low-pass keeps layout/content/color
    // regressions visible while making the >=0.99 gate perceptually stable.
    "[0:v]gblur=sigma=2[a];[1:v]gblur=sigma=2[b];[a][b]ssim",
    "-f",
    "null",
    "-",
  ]);
  const match = stderr.match(/All:([0-9.]+)/);
  if (!match) throw new Error("Could not parse FFmpeg SSIM output.");
  return Number(match[1]);
}

async function stableCaptureParity(
  standard: PipelineResult,
  hybrid: PipelineResult,
): Promise<Array<{
  label: string;
  ssim: number;
  bestOffsetSeconds: number;
}>> {
  const standardManifest = JSON.parse(
    await readFile(path.join(standard.runDir, "run.json"), "utf8"),
  ) as RunManifest;
  const hybridManifest = JSON.parse(
    await readFile(path.join(hybrid.runDir, "hybrid_capture.json"), "utf8"),
  ) as {
    keyframes: Array<{ stepIndex: number; path: string }>;
  };
  const standardVideo = standardManifest.videoPath;
  if (!standardVideo) throw new Error("Standard capture is missing videoPath.");

  const keyframeByStep = new Map(
    hybridManifest.keyframes.map((item) => [item.stepIndex, item.path]),
  );
  const labels = [
    "Home",
    "Ask a human excursion question",
    "Enter hotel",
  ];
  const results: Array<{
    label: string;
    ssim: number;
    bestOffsetSeconds: number;
  }> = [];

  for (const label of labels) {
    const step = timelineEntry(standardManifest, label);
    const keyframePath = keyframeByStep.get(step.index);
    if (!keyframePath) {
      throw new Error("Hybrid keyframe missing for stable step: " + label);
    }

    const nominal =
      secondsBetween(standardManifest.startedAt, step.finishedAt) - 0.04;
    let best = { ssim: -1, offset: 0 };

    for (const offset of [-0.24, -0.16, -0.08, 0, 0.08, 0.16, 0.24]) {
      const framePath = path.join(
        root,
        "parity-" +
          label.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
          "-" +
          String(offset).replace(".", "_") +
          ".png",
      );
      await extractFrame(standardVideo, nominal + offset, framePath);
      const score = await imageSsim(framePath, keyframePath);
      if (score > best.ssim) best = { ssim: score, offset };
    }

    results.push({
      label,
      ssim: Number(best.ssim.toFixed(6)),
      bestOffsetSeconds: best.offset,
    });
  }

  return results;
}

const standard = await pipeline("standard");
const hybrid = await pipeline("hybrid");

const improvementRatio = 1 - hybrid.totalMs / standard.totalMs;
const engineOnlyStandardMs = Math.max(0, standard.totalMs - standard.aiWaitMs);
const engineOnlyHybridMs = Math.max(0, hybrid.totalMs - hybrid.aiWaitMs);
const engineImprovementRatio =
  engineOnlyStandardMs > 0
    ? 1 - engineOnlyHybridMs / engineOnlyStandardMs
    : 0;

const parity = await stableCaptureParity(standard, hybrid);
const minStableSsim = Math.min(...parity.map((item) => item.ssim));

const result = {
  scenario: path.relative(process.cwd(), scenarioPath),
  standard: {
    captureMs: Math.round(standard.captureMs),
    renderMs: Math.round(standard.renderMs),
    totalMs: Math.round(standard.totalMs),
    aiWaitMs: standard.aiWaitMs,
    sourceDurationSeconds: standard.sourceDurationSeconds,
    editedDurationSeconds: standard.editedDurationSeconds,
    weightedCoverage: Number(standard.weightedCoverage.toFixed(4)),
    finalSizeBytes: standard.finalSizeBytes,
  },
  hybrid: {
    captureMs: Math.round(hybrid.captureMs),
    renderMs: Math.round(hybrid.renderMs),
    totalMs: Math.round(hybrid.totalMs),
    aiWaitMs: hybrid.aiWaitMs,
    sourceDurationSeconds: hybrid.sourceDurationSeconds,
    editedDurationSeconds: hybrid.editedDurationSeconds,
    weightedCoverage: Number(hybrid.weightedCoverage.toFixed(4)),
    finalSizeBytes: hybrid.finalSizeBytes,
  },
  totalSpeedup: Number((standard.totalMs / hybrid.totalMs).toFixed(3)),
  totalImprovementPercent: Number((improvementRatio * 100).toFixed(1)),
  engineAdjusted: {
    standardMs: Math.round(engineOnlyStandardMs),
    hybridMs: Math.round(engineOnlyHybridMs),
    speedup:
      engineOnlyHybridMs > 0
        ? Number((engineOnlyStandardMs / engineOnlyHybridMs).toFixed(3))
        : null,
    improvementPercent: Number(
      (engineImprovementRatio * 100).toFixed(1),
    ),
  },
  stableCaptureParity: parity,
  parityNormalization: "gaussian low-pass, sigma=2px before SSIM",
  minimumStableSsim: Number(minStableSsim.toFixed(6)),
  visualParityPassed: minStableSsim >= minimumSsim,
  speedGatePassed:
    improvementRatio >= minimumImprovement ||
    engineImprovementRatio >= minimumImprovement,
  required: {
    minimumImprovementPercent: minimumImprovement * 100,
    minimumStableSsim: minimumSsim,
  },
};

await writeFile(
  path.join(root, "max-tour-hybrid-benchmark.json"),
  JSON.stringify(result, null, 2) + "\n",
  "utf8",
);

console.log("MAX_TOUR_HYBRID_BENCHMARK " + JSON.stringify(result));

assert.equal(
  result.visualParityPassed,
  true,
  "MAX TOUR stable capture parity failed: minimum SSIM " +
    result.minimumStableSsim +
    " < " +
    minimumSsim,
);
assert.equal(
  result.speedGatePassed,
  true,
  "MAX TOUR hybrid speed improvement did not reach the " +
    String(minimumImprovement * 100) +
    "% promotion threshold.",
);
