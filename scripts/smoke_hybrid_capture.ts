import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
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

const standardStarted = performance.now();
const standard = await runScenario(scenario, {
  artifactsRoot: path.join(root, "standard"),
  hybrid: false,
});
const standardMs = performance.now() - standardStarted;

const hybridStarted = performance.now();
const hybrid = await runScenario(scenario, {
  artifactsRoot: path.join(root, "hybrid"),
  hybrid: true,
});
const hybridMs = performance.now() - hybridStarted;

assert.equal(standard.captureMode, "standard");
assert.ok(standard.videoPath);
assert.equal(hybrid.captureMode, "hybrid-prototype");
assert.equal(hybrid.videoPath, undefined);
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
  keyframes: Array<{ path: string }>;
};

assert.ok(manifest.counts.keyframeSteps >= 2);
assert.ok(manifest.counts.realtimeSteps >= 2);
assert.ok(manifest.counts.passiveSteps >= 1);
assert.equal(manifest.counts.capturedFrames, manifest.keyframes.length);
assert.ok(manifest.counts.capturedFrames >= 4);

const speedup = standardMs / hybridMs;
assert.ok(
  hybridMs < standardMs,
  `Expected hybrid capture to be faster. standard=${standardMs.toFixed(0)}ms hybrid=${hybridMs.toFixed(0)}ms`,
);

console.log(
  JSON.stringify({
    ok: true,
    root,
    standardMs: Math.round(standardMs),
    hybridMs: Math.round(hybridMs),
    speedup: Number(speedup.toFixed(3)),
    counts: manifest.counts,
  }),
);
