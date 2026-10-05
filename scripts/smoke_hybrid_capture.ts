import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { composeHybridRun } from "../src/hybrid-compose.js";
import { renderRun } from "../src/render.js";
import { runScenario } from "../src/runner.js";
import type { DemoScenario } from "../src/types.js";

process.env.ALLOW_PRIVATE_TARGETS = "true";
process.env.DEMO_STUDIO_REUSE_BROWSER = "false";

const source = JSON.parse(
  await readFile("examples/smoke.json", "utf8"),
) as DemoScenario;

const target =
  process.argv[2] ??
  "http://127.0.0.1:4173/fixtures/smoke.html";
const scenario: DemoScenario = {
  ...source,
  baseUrl: target.replace(/\/fixtures\/smoke\.html$/, ""),
};

const root = await mkdtemp(path.join(os.tmpdir(), "demo-hybrid-smoke-"));

async function ffmpeg(args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
  });
}

const standardCaptureStarted = performance.now();
const standard = await runScenario(scenario, {
  artifactsRoot: path.join(root, "standard"),
  hybrid: false,
});
const standardCaptureMs = performance.now() - standardCaptureStarted;

const standardRenderStarted = performance.now();
const standardFinal = await renderRun({
  runDir: standard.runDir,
  outputPath: path.join(root, "standard-final.mp4"),
  captions: false,
  brandLabel: "",
  intro: false,
  outro: false,
});
const standardRenderMs = performance.now() - standardRenderStarted;

const hybridCaptureStarted = performance.now();
const hybrid = await runScenario(scenario, {
  artifactsRoot: path.join(root, "hybrid"),
  hybrid: true,
});
const hybridCaptureMs = performance.now() - hybridCaptureStarted;

assert.equal(standard.captureMode, "standard");
assert.ok(standard.videoPath);
assert.equal(hybrid.captureMode, "hybrid-prototype");
assert.ok(hybrid.videoPath);
assert.ok(hybrid.hybridManifestPath);

const manifest = JSON.parse(
  await readFile(hybrid.hybridManifestPath!, "utf8"),
) as {
  counts: {
    keyframeSteps: number;
    realtimeSteps: number;
    passiveSteps: number;
    capturedFrames: number;
  };
  realtimeSourceVideoPath?: string;
  keyframes: Array<{ stepIndex: number; path: string }>;
};

assert.ok(manifest.counts.keyframeSteps >= 2);
assert.ok(manifest.counts.realtimeSteps >= 2);
assert.ok(manifest.counts.passiveSteps >= 1);
assert.equal(manifest.counts.capturedFrames, manifest.keyframes.length);
assert.ok(manifest.counts.capturedFrames >= 4);
assert.equal(manifest.realtimeSourceVideoPath, hybrid.videoPath);

const composeStarted = performance.now();
const composed = await composeHybridRun(hybrid.runDir);
const composeMs = performance.now() - composeStarted;

const hybridRenderStarted = performance.now();
const hybridFinal = await renderRun({
  runDir: composed.runDir,
  outputPath: path.join(root, "hybrid-final.mp4"),
  captions: false,
  brandLabel: "",
  intro: false,
  outro: false,
});
const hybridRenderMs = performance.now() - hybridRenderStarted;

assert.ok(standardFinal.endsWith(".mp4"));
assert.ok(hybridFinal.endsWith(".mp4"));
assert.ok(composed.segmentCount >= 3);

const standardTotalMs = standardCaptureMs + standardRenderMs;
const hybridTotalMs =
  hybridCaptureMs + composeMs + hybridRenderMs;
const captureSpeedup = standardCaptureMs / hybridCaptureMs;
const totalSpeedup = standardTotalMs / hybridTotalMs;
const totalReduction =
  1 - hybridTotalMs / standardTotalMs;

console.log(
  JSON.stringify({
    phase: "hybrid-core-benchmark",
    standardTotalMs: Math.round(standardTotalMs),
    hybridTotalMs: Math.round(hybridTotalMs),
    totalReductionPercent: Number((totalReduction * 100).toFixed(1)),
    captureSpeedup: Number(captureSpeedup.toFixed(3)),
    composeMs: Math.round(composeMs),
  }),
);

assert.ok(
  hybridCaptureMs < standardCaptureMs,
  `Expected hybrid capture to be faster. standard=${standardCaptureMs.toFixed(0)}ms hybrid=${hybridCaptureMs.toFixed(0)}ms`,
);
assert.ok(
  totalReduction >= 0.2,
  `Expected >=20% capture+render reduction. standard=${standardTotalMs.toFixed(0)}ms hybrid=${hybridTotalMs.toFixed(0)}ms reduction=${(totalReduction * 100).toFixed(1)}%`,
);

const standardScenes = JSON.parse(
  await readFile(path.join(standard.runDir, "scenes.json"), "utf8"),
) as {
  scenes: Array<{
    outputStart: number;
    outputEnd: number;
    stepIndexes: number[];
  }>;
};
const hybridScenes = JSON.parse(
  await readFile(path.join(composed.runDir, "scenes.json"), "utf8"),
) as typeof standardScenes;

const standardStableScene = standardScenes.scenes.find((scene) =>
  scene.stepIndexes.includes(0),
);
const hybridStableScene = hybridScenes.scenes.find((scene) =>
  scene.stepIndexes.includes(0),
);
assert.ok(standardStableScene);
assert.ok(hybridStableScene);

const standardStableTime =
  (standardStableScene!.outputStart + standardStableScene!.outputEnd) / 2;
const hybridStableTime =
  (hybridStableScene!.outputStart + hybridStableScene!.outputEnd) / 2;
const standardStablePath = path.join(root, "standard-stable-final.png");
const hybridStablePath = path.join(root, "hybrid-stable-final.png");

await ffmpeg([
  "-y",
  "-i",
  standardFinal,
  "-ss",
  standardStableTime.toFixed(3),
  "-frames:v",
  "1",
  standardStablePath,
]);
await ffmpeg([
  "-y",
  "-i",
  hybridFinal,
  "-ss",
  hybridStableTime.toFixed(3),
  "-frames:v",
  "1",
  hybridStablePath,
]);

const ssimLog = await ffmpeg([
  "-i",
  standardStablePath,
  "-i",
  hybridStablePath,
  "-lavfi",
  "ssim",
  "-f",
  "null",
  "-",
]);
const ssimMatch = ssimLog.match(/All:([0-9.]+)/);
assert.ok(ssimMatch, "Expected FFmpeg SSIM output.");
const stableFrameSsim = Number(ssimMatch![1]);
assert.ok(
  stableFrameSsim >= 0.99,
  `Expected final stable-frame SSIM >=0.99, got ${stableFrameSsim}`,
);

console.log(
  JSON.stringify({
    ok: true,
    root,
    standard: {
      captureMs: Math.round(standardCaptureMs),
      renderMs: Math.round(standardRenderMs),
      totalMs: Math.round(standardTotalMs),
    },
    hybrid: {
      captureMs: Math.round(hybridCaptureMs),
      composeMs: Math.round(composeMs),
      renderMs: Math.round(hybridRenderMs),
      totalMs: Math.round(hybridTotalMs),
    },
    captureSpeedup: Number(captureSpeedup.toFixed(3)),
    totalSpeedup: Number(totalSpeedup.toFixed(3)),
    totalReductionPercent: Number(
      (totalReduction * 100).toFixed(1),
    ),
    stableFrameSsim: Number(stableFrameSsim.toFixed(6)),
    counts: manifest.counts,
    composedSegments: composed.segmentCount,
  }),
);
