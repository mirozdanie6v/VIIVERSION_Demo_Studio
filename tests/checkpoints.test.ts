import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  restoreCaptureCheckpoint,
  restoreScenarioCheckpoint,
  restoreVoiceoverCheckpoint,
} from "../src/checkpoints.js";

test("validated local checkpoints can be resumed without durable storage", async () => {
  const jobDir = await mkdtemp(path.join(os.tmpdir(), "demo-checkpoint-"));
  const runId = "2026-10-05T00-00-00-000Z-smoke";
  const runDir = path.join(jobDir, "captures", runId);
  await mkdir(runDir, { recursive: true });

  const scenario = {
    name: "Checkpoint smoke",
    baseUrl: "https://example.com",
    steps: [{ action: "goto", url: "https://example.com" }],
  };

  await Promise.all([
    writeFile(
      path.join(jobDir, "scenario.json"),
      JSON.stringify(scenario, null, 2),
      "utf8",
    ),
    writeFile(path.join(jobDir, "storyboard.md"), "# Storyboard\n", "utf8"),
    writeFile(
      path.join(jobDir, "design_contract.json"),
      JSON.stringify({ version: 1, source: "test" }),
      "utf8",
    ),
    writeFile(
      path.join(jobDir, "ux_preflight.json"),
      JSON.stringify({ status: "PASS", findings: [] }),
      "utf8",
    ),
    writeFile(
      path.join(runDir, "run.json"),
      JSON.stringify({
        scenario,
        timeline: [],
        startedAt: "2026-10-05T00:00:00.000Z",
        finishedAt: "2026-10-05T00:00:03.000Z",
        videoPath: "/stale/container/path/capture.webm",
        success: true,
      }),
      "utf8",
    ),
    writeFile(path.join(runDir, "capture.webm"), Buffer.alloc(2048, 1)),
    writeFile(path.join(jobDir, "voiceover.mp3"), Buffer.alloc(1024, 2)),
  ]);

  const restoredScenario = await restoreScenarioCheckpoint("job-id", jobDir);
  assert.equal(restoredScenario?.scenario.name, "Checkpoint smoke");

  const restoredCapture = await restoreCaptureCheckpoint(
    "job-id",
    jobDir,
    runId,
  );
  assert.equal(restoredCapture?.runId, runId);
  assert.equal(restoredCapture?.videoPath, path.join(runDir, "capture.webm"));

  const normalizedManifest = JSON.parse(
    await readFile(path.join(runDir, "run.json"), "utf8"),
  );
  assert.equal(
    normalizedManifest.videoPath,
    path.join(runDir, "capture.webm"),
  );

  assert.equal(
    await restoreVoiceoverCheckpoint(
      "job-id",
      path.join(jobDir, "voiceover.mp3"),
    ),
    path.join(jobDir, "voiceover.mp3"),
  );
});
