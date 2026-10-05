import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { renderRun, type RenderEncoderPreset } from "../src/render.js";
import { runScenario } from "../src/runner.js";
import type { DemoScenario } from "../src/types.js";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4173";
const root = path.resolve(
  process.env.RENDER_BENCHMARK_ROOT ?? "/tmp/demo-render-benchmark",
);
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });

const scenario = JSON.parse(
  await readFile("examples/smoke.json", "utf8"),
) as DemoScenario;
scenario.baseUrl = baseUrl.replace(/\/$/, "");

const capture = await runScenario(scenario, {
  artifactsRoot: path.join(root, "captures"),
});

async function timedRender(
  encoderPreset: RenderEncoderPreset,
  suffix: string,
): Promise<{ path: string; durationMs: number; size: number }> {
  const outputPath = path.join(root, encoderPreset + "-" + suffix + ".mp4");
  const started = performance.now();
  await renderRun({
    runDir: capture.runDir,
    outputPath,
    preset: "16:9",
    captions: true,
    brandLabel: "VIIVERSION",
    intro: false,
    outro: false,
    encoderPreset,
  });
  const durationMs = performance.now() - started;
  return {
    path: outputPath,
    durationMs,
    size: (await stat(outputPath)).size,
  };
}

async function ssim(a: string, b: string): Promise<number> {
  const stderr: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.env.FFMPEG_PATH ?? "ffmpeg",
      [
        "-i",
        a,
        "-i",
        b,
        "-lavfi",
        "[0:v][1:v]ssim",
        "-f",
        "null",
        "-",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("FFmpeg SSIM exited with code " + code));
    });
  });

  const output = stderr.join("");
  const match = output.match(/All:([0-9.]+)/);
  if (!match) throw new Error("Could not parse SSIM result.");
  return Number(match[1]);
}

const fastA = await timedRender("fast", "a");
const veryfastA = await timedRender("veryfast", "a");
const veryfastB = await timedRender("veryfast", "b");
const fastB = await timedRender("fast", "b");

const fastMeanMs = (fastA.durationMs + fastB.durationMs) / 2;
const veryfastMeanMs = (veryfastA.durationMs + veryfastB.durationMs) / 2;
const speedup = fastMeanMs / veryfastMeanMs;
const visualSsim = await ssim(fastB.path, veryfastB.path);

const result = {
  captureRunId: capture.runId,
  fast: {
    meanMs: Math.round(fastMeanMs),
    runsMs: [Math.round(fastA.durationMs), Math.round(fastB.durationMs)],
    sizeBytes: fastB.size,
  },
  veryfast: {
    meanMs: Math.round(veryfastMeanMs),
    runsMs: [
      Math.round(veryfastA.durationMs),
      Math.round(veryfastB.durationMs),
    ],
    sizeBytes: veryfastB.size,
  },
  speedup: Number(speedup.toFixed(3)),
  ssim: Number(visualSsim.toFixed(6)),
  visualParityPassed: visualSsim >= 0.99,
  candidateFaster: veryfastMeanMs < fastMeanMs,
  recommendVeryfast:
    visualSsim >= 0.99 && veryfastMeanMs <= fastMeanMs * 0.9,
};

await writeFile(
  path.join(root, "benchmark.json"),
  JSON.stringify(result, null, 2) + "\n",
  "utf8",
);

console.log("RENDER_BENCHMARK " + JSON.stringify(result));

if (!result.visualParityPassed) {
  throw new Error(
    "veryfast failed visual parity: SSIM " + result.ssim + " < 0.99",
  );
}
