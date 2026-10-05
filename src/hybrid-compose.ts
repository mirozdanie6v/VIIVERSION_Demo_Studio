import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DemoScenario, DemoStep } from "./types.js";
import type { CameraFrame } from "./types.js";
import type {
  HybridKeyframe,
  HybridStepMode,
  HybridStepPlan,
} from "./hybrid-capture.js";

type RunTimelineItem = {
  index: number;
  label: string;
  action: DemoStep["action"];
  startedAt: string;
  finishedAt: string;
  success: boolean;
  camera?: CameraFrame;
  recovery?: unknown;
  error?: string;
};

type HybridRunManifest = {
  scenario: DemoScenario;
  timeline: RunTimelineItem[];
  startedAt: string;
  finishedAt: string;
  videoPath?: string;
  browserSource?: string;
  success: boolean;
};

type HybridCaptureManifest = {
  version: number;
  experimental: boolean;
  scenarioName: string;
  startedAt: string;
  finishedAt: string;
  realtimeSourceVideoPath?: string;
  plan: HybridStepPlan[];
  keyframes: HybridKeyframe[];
};

export type HybridComposeSegment = {
  order: number;
  stepIndex: number;
  action: DemoStep["action"];
  mode: Exclude<HybridStepMode, "passive">;
  durationSeconds: number;
  outputStart: number;
  outputEnd: number;
  sourceStart?: number;
  sourceEnd?: number;
  keyframePath?: string;
};

export type HybridCompositionPlan = {
  version: "hybrid-composition-v1";
  viewport: { width: number; height: number };
  sourceVideoPath: string;
  durationSeconds: number;
  segments: HybridComposeSegment[];
  timeline: RunTimelineItem[];
};

export type HybridComposeResult = {
  runDir: string;
  videoPath: string;
  manifestPath: string;
  compositionPath: string;
  durationSeconds: number;
  segmentCount: number;
};

function secondsBetween(startIso: string, valueIso: string): number {
  return Math.max(0, (Date.parse(valueIso) - Date.parse(startIso)) / 1000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function syntheticKeyframeDuration(
  step: DemoStep,
  scenario: DemoScenario,
): number {
  const pauseMs = step.pauseAfterMs ?? scenario.defaultPauseMs ?? 650;
  return clamp(pauseMs / 1000 + 0.4, 0.6, 1.6);
}

function isoAt(baseMs: number, seconds: number): string {
  return new Date(baseMs + Math.round(seconds * 1000)).toISOString();
}

export function buildHybridCompositionPlan(
  run: HybridRunManifest,
  hybrid: HybridCaptureManifest,
): HybridCompositionPlan {
  if (!run.success) {
    throw new Error("Cannot compose an unsuccessful hybrid capture.");
  }

  const sourceVideoPath =
    hybrid.realtimeSourceVideoPath ?? run.videoPath;
  if (!sourceVideoPath) {
    throw new Error("Hybrid capture is missing the realtime source video.");
  }

  const modes = new Map(
    hybrid.plan.map((item) => [item.index, item.mode] as const),
  );
  const keyframes = new Map(
    hybrid.keyframes.map((item) => [item.stepIndex, item.path] as const),
  );
  const baseMs = Date.parse(run.startedAt);
  if (!Number.isFinite(baseMs)) {
    throw new Error("Hybrid run has an invalid startedAt timestamp.");
  }

  const timeline: RunTimelineItem[] = [];
  const segments: HybridComposeSegment[] = [];
  let cursor = 0;

  for (const item of run.timeline) {
    const step = run.scenario.steps[item.index];
    if (!step) {
      throw new Error(`Hybrid timeline references missing step ${item.index}.`);
    }

    const mode = modes.get(item.index) ?? "realtime";
    const outputStart = cursor;
    let outputEnd = cursor;

    if (item.success && mode !== "passive") {
      if (mode === "keyframe") {
        const keyframePath = keyframes.get(item.index);
        if (!keyframePath) {
          throw new Error(
            `Hybrid keyframe is missing for step ${item.index} (${item.label}).`,
          );
        }

        const durationSeconds = syntheticKeyframeDuration(
          step,
          run.scenario,
        );
        outputEnd = outputStart + durationSeconds;
        segments.push({
          order: segments.length,
          stepIndex: item.index,
          action: step.action,
          mode,
          durationSeconds,
          outputStart,
          outputEnd,
          keyframePath,
        });
      } else {
        const rawStart = secondsBetween(run.startedAt, item.startedAt);
        const rawEnd = secondsBetween(run.startedAt, item.finishedAt);
        const sourceStart = Math.max(0, rawStart);
        const sourceEnd = Math.max(rawEnd, sourceStart + 0.08);
        const durationSeconds = sourceEnd - sourceStart;
        outputEnd = outputStart + durationSeconds;
        segments.push({
          order: segments.length,
          stepIndex: item.index,
          action: step.action,
          mode,
          durationSeconds,
          outputStart,
          outputEnd,
          sourceStart,
          sourceEnd,
        });
      }

      cursor = outputEnd;
    }

    timeline.push({
      ...item,
      startedAt: isoAt(baseMs, outputStart),
      finishedAt: isoAt(baseMs, outputEnd),
    });
  }

  if (segments.length === 0) {
    throw new Error("Hybrid composition has no renderable segments.");
  }

  const viewport = run.scenario.viewport ?? {
    width: 1440,
    height: 900,
  };

  return {
    version: "hybrid-composition-v1",
    viewport,
    sourceVideoPath: path.resolve(sourceVideoPath),
    durationSeconds: cursor,
    segments,
    timeline,
  };
}

function number(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

async function runFfmpeg(
  executable: string,
  args: string[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code ?? "unknown"}.`));
    });
  });
}

function normalizedVideoFilter(width: number, height: number): string {
  return (
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
    "setsar=1,fps=30,format=yuv420p"
  );
}

export async function composeHybridRun(
  runDirInput: string,
  options: {
    outputDir?: string;
    ffmpegPath?: string;
  } = {},
): Promise<HybridComposeResult> {
  const sourceRunDir = path.resolve(runDirInput);
  const [run, hybrid] = await Promise.all([
    readFile(path.join(sourceRunDir, "run.json"), "utf8").then(
      (value) => JSON.parse(value) as HybridRunManifest,
    ),
    readFile(path.join(sourceRunDir, "hybrid_capture.json"), "utf8").then(
      (value) => JSON.parse(value) as HybridCaptureManifest,
    ),
  ]);

  const plan = buildHybridCompositionPlan(run, hybrid);
  const outputDir = path.resolve(
    options.outputDir ?? path.join(sourceRunDir, "hybrid-composed"),
  );
  await mkdir(outputDir, { recursive: true });

  const outputVideoPath = path.join(outputDir, "capture.mp4");
  const outputManifestPath = path.join(outputDir, "run.json");
  const compositionPath = path.join(
    outputDir,
    "hybrid_composition.json",
  );

  const args: string[] = ["-y", "-i", plan.sourceVideoPath];
  const imageInputBySegment = new Map<number, number>();
  let inputIndex = 1;

  for (const segment of plan.segments) {
    if (segment.mode !== "keyframe") continue;
    imageInputBySegment.set(segment.order, inputIndex);
    inputIndex += 1;
    args.push(
      "-loop",
      "1",
      "-framerate",
      "30",
      "-t",
      number(segment.durationSeconds),
      "-i",
      path.resolve(segment.keyframePath!),
    );
  }

  const filters: string[] = [];
  const segmentLabels: string[] = [];
  const normalized = normalizedVideoFilter(
    plan.viewport.width,
    plan.viewport.height,
  );

  for (const segment of plan.segments) {
    const label = `hseg${segment.order}`;
    segmentLabels.push(`[${label}]`);

    if (segment.mode === "realtime") {
      filters.push(
        `[0:v]trim=start=${number(segment.sourceStart!)}:end=${number(segment.sourceEnd!)},` +
          `setpts=PTS-STARTPTS,${normalized}[${label}]`,
      );
      continue;
    }

    const imageInput = imageInputBySegment.get(segment.order);
    if (imageInput === undefined) {
      throw new Error(
        `Missing FFmpeg input for hybrid segment ${segment.order}.`,
      );
    }
    filters.push(
      `[${imageInput}:v]setpts=PTS-STARTPTS,${normalized}[${label}]`,
    );
  }

  filters.push(
    `${segmentLabels.join("")}concat=n=${plan.segments.length}:v=1:a=0[vout]`,
  );

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    outputVideoPath,
  );

  await runFfmpeg(
    options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg",
    args,
  );

  const composedManifest = {
    ...run,
    timeline: plan.timeline,
    finishedAt: isoAt(
      Date.parse(run.startedAt),
      plan.durationSeconds,
    ),
    videoPath: outputVideoPath,
    captureMode: "hybrid-composed",
    sourceHybridRunDir: sourceRunDir,
  };

  await Promise.all([
    writeFile(
      outputManifestPath,
      JSON.stringify(composedManifest, null, 2) + "\n",
      "utf8",
    ),
    writeFile(
      compositionPath,
      JSON.stringify(
        {
          ...plan,
          sourceRunDir,
          outputVideoPath,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    ),
  ]);

  return {
    runDir: outputDir,
    videoPath: outputVideoPath,
    manifestPath: outputManifestPath,
    compositionPath,
    durationSeconds: plan.durationSeconds,
    segmentCount: plan.segments.length,
  };
}
