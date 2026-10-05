import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
  captureMode?: "standard" | "hybrid-prototype";
  hybridManifestPath?: string;
};

type HybridCheckpointKeyframe = {
  stepIndex: number;
  action: string;
  mode: string;
  path: string;
  capturedAt: string;
  [key: string]: unknown;
};

type HybridCheckpointManifest = {
  version?: number;
  realtimeSourceVideoPath?: string;
  keyframes: HybridCheckpointKeyframe[];
  [key: string]: unknown;
};

type HybridCheckpointBundle = {
  version: 1;
  manifest: HybridCheckpointManifest;
  frames: Array<{
    stepIndex: number;
    filename: string;
    contentBase64: string;
  }>;
};

const HYBRID_BUNDLE_NAME = "hybrid-capture.bundle.json" as const;

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
    | "hybrid-capture.bundle.json"
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

function hybridFrameFilename(value: string, stepIndex: number): string {
  const filename = path.basename(value);
  if (!/^\d{3}-[a-zA-Z0-9_-]+\.png$/.test(filename)) {
    throw new Error(
      "Hybrid checkpoint contains an invalid keyframe filename for step " +
        stepIndex +
        ".",
    );
  }
  return filename;
}

async function buildHybridCheckpointBundle(
  capture: RunResult,
): Promise<string> {
  const manifestPath =
    capture.hybridManifestPath ??
    path.join(capture.runDir, "hybrid_capture.json");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as HybridCheckpointManifest;

  if (!Array.isArray(manifest.keyframes) || manifest.keyframes.length === 0) {
    throw new Error("Hybrid capture checkpoint has no keyframes.");
  }

  const frames = await Promise.all(
    manifest.keyframes.map(async (frame) => {
      const filename = hybridFrameFilename(frame.path, frame.stepIndex);
      const bytes = await readFile(
        path.isAbsolute(frame.path)
          ? frame.path
          : path.resolve(capture.runDir, frame.path),
      );
      if (bytes.length < 128) {
        throw new Error(
          "Hybrid capture checkpoint keyframe is unexpectedly small: " +
            filename,
        );
      }
      return {
        stepIndex: frame.stepIndex,
        filename,
        contentBase64: bytes.toString("base64"),
      };
    }),
  );

  const bundlePath = path.join(capture.runDir, HYBRID_BUNDLE_NAME);
  const bundle: HybridCheckpointBundle = {
    version: 1,
    manifest,
    frames,
  };
  await writeFile(
    bundlePath,
    JSON.stringify(bundle) + "\n",
    "utf8",
  );
  return bundlePath;
}

async function restoreHybridCheckpointBundle(
  jobId: string,
  runDir: string,
  videoPath: string,
): Promise<string | undefined> {
  const bundlePath = path.join(runDir, HYBRID_BUNDLE_NAME);
  const ready = await ensureFile(
    jobId,
    HYBRID_BUNDLE_NAME,
    bundlePath,
    64,
  );
  if (!ready) return undefined;

  try {
    const bundle = JSON.parse(
      await readFile(bundlePath, "utf8"),
    ) as HybridCheckpointBundle;
    if (
      bundle.version !== 1 ||
      !bundle.manifest ||
      !Array.isArray(bundle.manifest.keyframes) ||
      bundle.manifest.keyframes.length === 0 ||
      !Array.isArray(bundle.frames)
    ) {
      return undefined;
    }

    const frameByStep = new Map(
      bundle.frames.map((frame) => [frame.stepIndex, frame]),
    );
    const keyframeDir = path.join(runDir, "hybrid-keyframes");
    await mkdir(keyframeDir, { recursive: true });

    const restoredKeyframes: HybridCheckpointKeyframe[] = [];
    for (const frame of bundle.manifest.keyframes) {
      const bundled = frameByStep.get(frame.stepIndex);
      if (!bundled) return undefined;
      const filename = hybridFrameFilename(
        bundled.filename,
        frame.stepIndex,
      );
      const bytes = Buffer.from(bundled.contentBase64, "base64");
      if (bytes.length < 128) return undefined;
      const restoredPath = path.join(keyframeDir, filename);
      await writeFile(restoredPath, bytes);
      restoredKeyframes.push({
        ...frame,
        path: restoredPath,
      });
    }

    const hybridManifestPath = path.join(runDir, "hybrid_capture.json");
    const restoredManifest: HybridCheckpointManifest = {
      ...bundle.manifest,
      realtimeSourceVideoPath: videoPath,
      keyframes: restoredKeyframes,
    };
    await writeFile(
      hybridManifestPath,
      JSON.stringify(restoredManifest, null, 2) + "\n",
      "utf8",
    );
    return hybridManifestPath;
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

  const hybridBundlePath =
    capture.captureMode === "hybrid-prototype"
      ? await buildHybridCheckpointBundle(capture)
      : undefined;

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
    ...(hybridBundlePath
      ? [
          persistCheckpointFile(
            jobId,
            HYBRID_BUNDLE_NAME,
            hybridBundlePath,
            "application/json; charset=utf-8",
          ),
        ]
      : []),
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

    let hybridManifestPath: string | undefined;
    if (manifest.captureMode === "hybrid-prototype") {
      hybridManifestPath = await restoreHybridCheckpointBundle(
        jobId,
        runDir,
        videoPath,
      );
      if (!hybridManifestPath) return undefined;
    }

    // The original manifest can contain absolute paths from a destroyed
    // container. Normalize every media reference to the restored run.
    const normalized = {
      ...manifest,
      videoPath,
      ...(hybridManifestPath ? { hybridManifestPath } : {}),
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
      captureMode: manifest.captureMode,
      hybridManifestPath,
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
