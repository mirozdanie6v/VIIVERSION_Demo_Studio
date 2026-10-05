import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { renderRun } from "../src/render.js";
import { runScenario } from "../src/runner.js";
import type { DemoScenario } from "../src/types.js";

process.env.ALLOW_PRIVATE_TARGETS = "true";
process.env.DEMO_STUDIO_REUSE_BROWSER = "false";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4173";
const root = path.resolve(
  process.env.HYBRID_RENDER_BENCHMARK_ROOT ??
    "/tmp/demo-hybrid-render-benchmark",
);
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });

const source = JSON.parse(
  await readFile("examples/smoke.json", "utf8"),
) as DemoScenario;
const scenario: DemoScenario = {
  ...source,
  baseUrl: baseUrl.replace(/\/$/, ""),
};

type PipelineResult = {
  mode: "standard" | "hybrid";
  runDir: string;
  outputPath: string;
  captureMs: number;
  renderMs: number;
  totalMs: number;
  sizeBytes: number;
};

async function pipeline(
  mode: "standard" | "hybrid",
  suffix: string,
): Promise<PipelineResult> {
  const artifactsRoot = path.join(root, mode + "-" + suffix, "captures");
  const captureStarted = performance.now();
  const capture = await runScenario(scenario, {
    artifactsRoot,
    hybrid: mode === "hybrid",
  });
  const captureMs = performance.now() - captureStarted;

  const outputPath = path.join(root, mode + "-" + suffix + ".mp4");
  const renderStarted = performance.now();
  await renderRun({
    runDir: capture.runDir,
    outputPath,
    preset: "16:9",
    captions: true,
    brandLabel: "VIIVERSION",
    intro: false,
    outro: false,
    encoderPreset: "veryfast",
    hybrid: mode === "hybrid",
    hybridStrict: mode === "hybrid",
  });
  const renderMs = performance.now() - renderStarted;

  return {
    mode,
    runDir: capture.runDir,
    outputPath,
    captureMs,
    renderMs,
    totalMs: captureMs + renderMs,
    sizeBytes: (await stat(outputPath)).size,
  };
}

async function run(
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
              stderr.join("").slice(-4000),
          ),
        );
      }
    });
  });
  return stderr.join("");
}

async function extractStableFrame(
  videoPath: string,
  secondsFromEnd: number,
  outputPath: string,
): Promise<void> {
  await run(process.env.FFMPEG_PATH ?? "ffmpeg", [
    "-y",
    "-sseof",
    "-" + String(secondsFromEnd),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    outputPath,
  ]);
}

async function ssim(a: string, b: string): Promise<number> {
  const stderr = await run(process.env.FFMPEG_PATH ?? "ffmpeg", [
    "-i",
    a,
    "-i",
    b,
    "-lavfi",
    "[0:v][1:v]ssim",
    "-f",
    "null",
    "-",
  ]);
  const match = stderr.match(/All:([0-9.]+)/);
  if (!match) throw new Error("Could not parse SSIM result.");
  return Number(match[1]);
}

const standardA = await pipeline("standard", "a");
const hybridA = await pipeline("hybrid", "a");
const hybridB = await pipeline("hybrid", "b");
const standardB = await pipeline("standard", "b");

const standardMeanMs = (standardA.totalMs + standardB.totalMs) / 2;
const hybridMeanMs = (hybridA.totalMs + hybridB.totalMs) / 2;
const improvementRatio = 1 - hybridMeanMs / standardMeanMs;

const stablePairs = [
  { name: "tail-300ms", secondsFromEnd: 0.3 },
  { name: "tail-120ms", secondsFromEnd: 0.12 },
];

const parity: Array<{ name: string; ssim: number }> = [];
for (const pair of stablePairs) {
  const standardFrame = path.join(root, "standard-" + pair.name + ".png");
  const hybridFrame = path.join(root, "hybrid-" + pair.name + ".png");
  await extractStableFrame(
    standardB.outputPath,
    pair.secondsFromEnd,
    standardFrame,
  );
  await extractStableFrame(
    hybridB.outputPath,
    pair.secondsFromEnd,
    hybridFrame,
  );
  parity.push({
    name: pair.name,
    ssim: await ssim(standardFrame, hybridFrame),
  });
}

const minimumSsim = Math.min(...parity.map((item) => item.ssim));
const result = {
  standard: {
    meanTotalMs: Math.round(standardMeanMs),
    runs: [standardA, standardB].map((item) => ({
      captureMs: Math.round(item.captureMs),
      renderMs: Math.round(item.renderMs),
      totalMs: Math.round(item.totalMs),
      sizeBytes: item.sizeBytes,
    })),
  },
  hybrid: {
    meanTotalMs: Math.round(hybridMeanMs),
    runs: [hybridA, hybridB].map((item) => ({
      captureMs: Math.round(item.captureMs),
      renderMs: Math.round(item.renderMs),
      totalMs: Math.round(item.totalMs),
      sizeBytes: item.sizeBytes,
    })),
  },
  speedup: Number((standardMeanMs / hybridMeanMs).toFixed(3)),
  improvementPercent: Number((improvementRatio * 100).toFixed(1)),
  parity: parity.map((item) => ({
    ...item,
    ssim: Number(item.ssim.toFixed(6)),
  })),
  minimumSsim: Number(minimumSsim.toFixed(6)),
  visualParityPassed: minimumSsim >= 0.99,
  speedTargetPassed: improvementRatio >= 0.2,
};

await writeFile(
  path.join(root, "benchmark.json"),
  JSON.stringify(result, null, 2) + "\n",
  "utf8",
);

console.log("HYBRID_RENDER_BENCHMARK " + JSON.stringify(result));

assert.equal(
  result.visualParityPassed,
  true,
  "Hybrid render failed visual parity: minimum SSIM " +
    result.minimumSsim +
    " < 0.99",
);
assert.equal(
  result.speedTargetPassed,
  true,
  "Hybrid capture+render improvement " +
    result.improvementPercent +
    "% is below the 20% target.",
);
