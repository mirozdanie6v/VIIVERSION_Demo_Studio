import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SceneManifest, SceneStep, SceneTimelineEntry } from "./scenes.js";

type HybridStepMode = "keyframe" | "realtime" | "passive";

type HybridPlanItem = {
  index: number;
  action: string;
  label: string;
  mode: HybridStepMode;
  reason: string;
};

type HybridKeyframe = {
  stepIndex: number;
  action: string;
  mode: HybridStepMode;
  path: string;
  capturedAt: string;
};

export type HybridCaptureManifest = {
  version: number;
  experimental: boolean;
  scenarioName?: string;
  startedAt: string;
  finishedAt: string;
  realtimeSourceVideoPath?: string;
  plan: HybridPlanItem[];
  keyframes: HybridKeyframe[];
};

type HybridScenarioStep = SceneStep & {
  pauseAfterMs?: number;
};

export type HybridRenderManifest = SceneManifest & {
  scenario: SceneManifest["scenario"] & {
    defaultPauseMs?: number;
    steps: HybridScenarioStep[];
  };
  success: boolean;
  videoPath?: string;
  captureMode?: "standard" | "hybrid-prototype";
  hybridManifestPath?: string;
  [key: string]: unknown;
};

export type HybridSourceSegment =
  | {
      kind: "keyframe";
      stepIndex: number;
      path: string;
      outputStart: number;
      outputEnd: number;
      duration: number;
    }
  | {
      kind: "realtime";
      stepIndex: number;
      sourceStart: number;
      sourceEnd: number;
      outputStart: number;
      outputEnd: number;
      duration: number;
    };

export type HybridCompositionPlan = {
  version: "hybrid-composition-v1";
  experimental: true;
  sourceVideoPath: string;
  totalDurationSeconds: number;
  segments: HybridSourceSegment[];
  syntheticTimeline: SceneTimelineEntry[];
  manifest: HybridRenderManifest;
};

function truthy(value: string | undefined): boolean {
  return ["1", "true", "on", "yes"].includes(value?.trim().toLowerCase() ?? "");
}

export function hybridRenderEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return truthy(env.DEMO_STUDIO_HYBRID_RENDER);
}

export function hybridRenderStrictEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return truthy(env.DEMO_STUDIO_HYBRID_RENDER_STRICT);
}

function secondsBetween(startIso: string, valueIso: string): number {
  return Math.max(0, (Date.parse(valueIso) - Date.parse(startIso)) / 1000);
}

function isoAt(startIso: string, seconds: number): string {
  return new Date(Date.parse(startIso) + Math.round(seconds * 1000)).toISOString();
}

function resolveArtifactPath(runDir: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(runDir, value);
}

function requestedHoldSeconds(
  step: HybridScenarioStep | undefined,
  defaultPauseMs: number | undefined,
): number {
  const requestedMs = step?.pauseAfterMs ?? defaultPauseMs ?? 650;
  const narrationWords = step?.narration?.trim()
    ? step.narration.trim().split(/\s+/).length
    : 0;
  const narrationFloor = narrationWords > 0
    ? Math.min(4, narrationWords / 2.8 + 0.18)
    : 0;

  return Math.max(0.45, requestedMs / 1000 + 0.12, narrationFloor);
}

export function buildHybridCompositionPlan(
  runDir: string,
  manifest: HybridRenderManifest,
  hybrid: HybridCaptureManifest,
): HybridCompositionPlan {
  if (!manifest.success) {
    throw new Error("Cannot compose an unsuccessful capture run.");
  }
  if (manifest.captureMode !== "hybrid-prototype") {
    throw new Error("Hybrid composition requires a hybrid-prototype capture.");
  }
  if (!hybrid.realtimeSourceVideoPath) {
    throw new Error("Hybrid capture is missing realtimeSourceVideoPath.");
  }

  const timelineByIndex = new Map(
    manifest.timeline.map((item) => [item.index, item]),
  );
  const keyframeByIndex = new Map(
    hybrid.keyframes.map((frame) => [frame.stepIndex, frame]),
  );

  const syntheticTimeline: SceneTimelineEntry[] = [];
  const segments: HybridSourceSegment[] = [];
  let cursor = 0;

  for (const item of hybrid.plan) {
    const timeline = timelineByIndex.get(item.index);
    if (!timeline) {
      throw new Error(
        `Hybrid plan references missing timeline step ${item.index}.`,
      );
    }

    const syntheticStart = cursor;

    if (item.mode === "keyframe") {
      const keyframe = keyframeByIndex.get(item.index);
      if (!keyframe) {
        throw new Error(
          `Hybrid keyframe step ${item.index} has no captured frame.`,
        );
      }

      const duration = requestedHoldSeconds(
        manifest.scenario.steps[item.index],
        manifest.scenario.defaultPauseMs,
      );
      cursor += duration;
      segments.push({
        kind: "keyframe",
        stepIndex: item.index,
        path: resolveArtifactPath(runDir, keyframe.path),
        outputStart: syntheticStart,
        outputEnd: cursor,
        duration,
      });
    } else if (item.mode === "realtime") {
      const sourceStart = secondsBetween(manifest.startedAt, timeline.startedAt);
      const measuredEnd = secondsBetween(manifest.startedAt, timeline.finishedAt);
      const sourceEnd = Math.max(sourceStart + 0.08, measuredEnd);
      const duration = sourceEnd - sourceStart;
      cursor += duration;
      segments.push({
        kind: "realtime",
        stepIndex: item.index,
        sourceStart,
        sourceEnd,
        outputStart: syntheticStart,
        outputEnd: cursor,
        duration,
      });
    }

    syntheticTimeline.push({
      ...timeline,
      startedAt: isoAt(manifest.startedAt, syntheticStart),
      finishedAt: isoAt(manifest.startedAt, cursor),
    });
  }

  if (segments.length === 0 || cursor <= 0.08) {
    throw new Error("Hybrid composition did not produce renderable segments.");
  }

  const composedManifest: HybridRenderManifest = {
    ...manifest,
    timeline: syntheticTimeline,
    finishedAt: isoAt(manifest.startedAt, cursor),
  };

  return {
    version: "hybrid-composition-v1",
    experimental: true,
    sourceVideoPath: resolveArtifactPath(
      runDir,
      hybrid.realtimeSourceVideoPath,
    ),
    totalDurationSeconds: cursor,
    segments,
    syntheticTimeline,
    manifest: composedManifest,
  };
}

export async function planHybridComposition(
  runDir: string,
  manifest: HybridRenderManifest,
): Promise<HybridCompositionPlan> {
  const hybridManifestPath = manifest.hybridManifestPath
    ? resolveArtifactPath(runDir, manifest.hybridManifestPath)
    : path.join(runDir, "hybrid_capture.json");
  const hybrid = JSON.parse(
    await readFile(hybridManifestPath, "utf8"),
  ) as HybridCaptureManifest;

  const plan = buildHybridCompositionPlan(runDir, manifest, hybrid);
  await writeFile(
    path.join(runDir, "hybrid_composition.json"),
    JSON.stringify(
      {
        version: plan.version,
        experimental: plan.experimental,
        sourceVideoPath: plan.sourceVideoPath,
        totalDurationSeconds: plan.totalDurationSeconds,
        segments: plan.segments,
        syntheticTimeline: plan.syntheticTimeline,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return plan;
}
