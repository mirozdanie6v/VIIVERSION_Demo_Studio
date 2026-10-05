import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  persistCheckpointFile,
  restoreCheckpointFile,
} from "./persistence.js";
import type { DemoScenario, RunResult } from "./types.js";

export type DemoJobCheckpoint = {
  version: 1;
  scenarioReady?: boolean;
  captureRunId?: string;
  voiceoverReady?: boolean;
};

type RunManifest = {
  startedAt?: string;
  finishedAt?: string;
  success?: boolean;
  videoPath?: string;
};

async function hasBytes(filePath: string, minimum = 1): Promise<boolean> {
  try {
    return (await stat(filePath)).size >= minimum;
  } catch {
    return false;
  }
}

async function ensureFile(
  jobId: string,
  name:
    | "scenario.json"
    | "storyboard.md"
    | "design_contract.json"
    | "ux_preflight.json"
    | "run.json"
    | "capture.webm"
    | "voiceover.mp3",
  destinationPath: string,
  minimumBytes = 1,
): Promise<boolean> {
  if (await hasBytes(destinationPath, minimumBytes)) return true;

  const restored = await restoreCheckpointFile(
    jobId,
    name,
    destinationPath,
  ).catch(() => false);

  return restored && (await hasBytes(destinationPath, minimumBytes));
}

export async function persistScenarioCheckpoint(
  jobId: string,
  jobDir: string,
): Promise<void> {
  await Promise.all([
    persistCheckpointFile(
      jobId,
      "scenario.json",
      path.join(jobDir, "scenario.json"),
      "application/json; charset=utf-8",
    ),
    persistCheckpointFile(
      jobId,
      "storyboard.md",
      path.join(jobDir, "storyboard.md"),
      "text/markdown; charset=utf-8",
    ),
    persistCheckpointFile(
      jobId,
      "design_contract.json",
      path.join(jobDir, "design_contract.json"),
      "application/json; charset=utf-8",
    ),
    persistCheckpointFile(
      jobId,
      "ux_preflight.json",
      path.join(jobDir, "ux_preflight.json"),
      "application/json; charset=utf-8",
    ),
  ]);
}

export async function restoreScenarioCheckpoint(
  jobId: string,
  jobDir: string,
): Promise<{ scenario: DemoScenario; storyboard: string } | undefined> {
  const scenarioPath = path.join(jobDir, "scenario.json");
  const storyboardPath = path.join(jobDir, "storyboard.md");
  const required = await Promise.all([
    ensureFile(jobId, "scenario.json", scenarioPath, 16),
    ensureFile(jobId, "storyboard.md", storyboardPath, 1),
    ensureFile(
      jobId,
      "design_contract.json",
      path.join(jobDir, "design_contract.json"),
      16,
    ),
    ensureFile(
      jobId,
      "ux_preflight.json",
      path.join(jobDir, "ux_preflight.json"),
      16,
    ),
  ]);

  if (required.some((value) => !value)) return undefined;

  try {
    const scenario = JSON.parse(
      await readFile(scenarioPath, "utf8"),
    ) as DemoScenario;
    if (
      !scenario ||
      typeof scenario.name !== "string" ||
      !Array.isArray(scenario.steps) ||
      scenario.steps.length === 0
    ) {
      return undefined;
    }

    const storyboard = await readFile(storyboardPath, "utf8");
    if (!storyboard.trim()) return undefined;
    return { scenario, storyboard };
  } catch {
    return undefined;
  }
}

export async function persistCaptureCheckpoint(
  jobId: string,
  capture: RunResult,
): Promise<void> {
  if (!capture.videoPath) {
    throw new Error("Capture checkpoint requires a recorded video.");
  }

  await Promise.all([
    persistCheckpointFile(
      jobId,
      "run.json",
      path.join(capture.runDir, "run.json"),
      "application/json; charset=utf-8",
    ),
    persistCheckpointFile(
      jobId,
      "capture.webm",
      capture.videoPath,
      "video/webm",
    ),
  ]);
}

export async function restoreCaptureCheckpoint(
  jobId: string,
  jobDir: string,
  runId: string,
): Promise<RunResult | undefined> {
  const runDir = path.join(jobDir, "captures", runId);
  const runPath = path.join(runDir, "run.json");
  const videoPath = path.join(runDir, "capture.webm");

  const [runReady, videoReady] = await Promise.all([
    ensureFile(jobId, "run.json", runPath, 32),
    ensureFile(jobId, "capture.webm", videoPath, 1024),
  ]);
  if (!runReady || !videoReady) return undefined;

  try {
    const manifest = JSON.parse(
      await readFile(runPath, "utf8"),
    ) as RunManifest;
    if (
      manifest.success !== true ||
      typeof manifest.startedAt !== "string" ||
      typeof manifest.finishedAt !== "string"
    ) {
      return undefined;
    }

    // The original manifest can contain an absolute path from a destroyed
    // container. Renderers use run.json, so normalize it to the restored file.
    const normalized = {
      ...manifest,
      videoPath,
    };
    await writeFile(
      runPath,
      JSON.stringify(normalized, null, 2) + "\n",
      "utf8",
    );

    return {
      runId,
      runDir,
      videoPath,
      startedAt: manifest.startedAt,
      finishedAt: manifest.finishedAt,
      success: true,
    };
  } catch {
    return undefined;
  }
}

export async function persistVoiceoverCheckpoint(
  jobId: string,
  voiceoverPath: string,
): Promise<void> {
  await persistCheckpointFile(
    jobId,
    "voiceover.mp3",
    voiceoverPath,
    "audio/mpeg",
  );
}

export async function restoreVoiceoverCheckpoint(
  jobId: string,
  voiceoverPath: string,
): Promise<string | undefined> {
  return (await ensureFile(jobId, "voiceover.mp3", voiceoverPath, 512))
    ? voiceoverPath
    : undefined;
}
