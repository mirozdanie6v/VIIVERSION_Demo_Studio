import type { CameraFrame } from "./types.js";

export type SceneTimelineEntry = {
  index: number;
  label: string;
  action: string;
  startedAt: string;
  finishedAt: string;
  success: boolean;
  camera?: CameraFrame;
};

export type SceneStep = {
  action: string;
  label?: string;
  narration?: string;
};

export type SceneManifest = {
  scenario: {
    name?: string;
    steps: SceneStep[];
  };
  timeline: SceneTimelineEntry[];
  startedAt: string;
  finishedAt?: string;
};

export type EditScene = {
  sourceStart: number;
  sourceEnd: number;
  outputStart: number;
  outputEnd: number;
  stepIndexes: number[];
};

const PASSIVE_ACTIONS = new Set([
  "wait",
  "waitFor",
  "waitForNavigation",
  "assert",
]);

function secondsBetween(startIso: string, valueIso: string): number {
  return Math.max(0, (Date.parse(valueIso) - Date.parse(startIso)) / 1000);
}

export function manifestDuration(manifest: SceneManifest): number {
  const explicit = manifest.finishedAt
    ? secondsBetween(manifest.startedAt, manifest.finishedAt)
    : 0;

  const timelineEnd = manifest.timeline.reduce(
    (max, item) =>
      Math.max(max, secondsBetween(manifest.startedAt, item.finishedAt)),
    0,
  );

  return Math.max(explicit, timelineEnd);
}

export function buildScenePlan(
  manifest: SceneManifest,
  options: {
    leadInSeconds?: number;
    tailSeconds?: number;
    mergeGapSeconds?: number;
  } = {},
): EditScene[] {
  const duration = manifestDuration(manifest);
  const leadIn = options.leadInSeconds ?? 0.16;
  const tail = options.tailSeconds ?? 0.34;
  const mergeGap = options.mergeGapSeconds ?? 0.28;

  const candidates = manifest.timeline
    .filter((item) => {
      if (!item.success) return false;
      const step = manifest.scenario.steps[item.index];
      if (!step) return false;
      if (PASSIVE_ACTIONS.has(step.action)) return false;
      return Boolean(step.label?.trim() || step.narration?.trim());
    })
    .map((item) => ({
      sourceStart: Math.max(
        0,
        secondsBetween(manifest.startedAt, item.startedAt) - leadIn,
      ),
      sourceEnd: Math.min(
        duration,
        secondsBetween(manifest.startedAt, item.finishedAt) + tail,
      ),
      stepIndexes: [item.index],
    }))
    .filter((scene) => scene.sourceEnd > scene.sourceStart + 0.05);

  if (candidates.length === 0) return [];

  const merged: Array<{
    sourceStart: number;
    sourceEnd: number;
    stepIndexes: number[];
  }> = [];

  for (const candidate of candidates) {
    const previous = merged.at(-1);

    if (
      previous &&
      candidate.sourceStart <= previous.sourceEnd + mergeGap
    ) {
      previous.sourceEnd = Math.max(previous.sourceEnd, candidate.sourceEnd);
      previous.stepIndexes.push(...candidate.stepIndexes);
      continue;
    }

    merged.push({ ...candidate });
  }

  let cursor = 0;
  return merged.map((scene) => {
    const length = scene.sourceEnd - scene.sourceStart;
    const output: EditScene = {
      ...scene,
      outputStart: cursor,
      outputEnd: cursor + length,
    };
    cursor += length;
    return output;
  });
}

export function mapSourceTimeToOutput(
  sourceSeconds: number,
  scenes: EditScene[],
): number | undefined {
  for (const scene of scenes) {
    if (
      sourceSeconds >= scene.sourceStart &&
      sourceSeconds <= scene.sourceEnd
    ) {
      return (
        scene.outputStart +
        Math.max(0, sourceSeconds - scene.sourceStart)
      );
    }
  }

  return undefined;
}

export function editedDuration(
  manifest: SceneManifest,
  scenes: EditScene[],
): number {
  return scenes.length > 0
    ? scenes.at(-1)?.outputEnd ?? 0
    : manifestDuration(manifest);
}
