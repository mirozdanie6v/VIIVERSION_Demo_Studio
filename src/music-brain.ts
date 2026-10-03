import type { EditScene } from "./scenes.js";

export type MusicBrainPlan = {
  version: "music-brain-v1";
  bpm?: number;
  beatOffsetSeconds: number;
  aligned: boolean;
  scenes: EditScene[];
  adjustments: Array<{
    sceneIndex: number;
    originalBoundary: number;
    alignedBoundary: number;
    shiftSeconds: number;
  }>;
};

function recomputeOutputTimes(scenes: EditScene[]): EditScene[] {
  let cursor = 0;
  return scenes.map((scene) => {
    const duration = scene.sourceEnd - scene.sourceStart;
    const next = {
      ...scene,
      outputStart: cursor,
      outputEnd: cursor + duration,
    };
    cursor += duration;
    return next;
  });
}

function nearestBeat(
  seconds: number,
  bpm: number,
  offset: number,
): number {
  const beat = 60 / bpm;
  const index = Math.round((seconds - offset) / beat);
  return offset + index * beat;
}

export function alignScenesToBeatGrid(
  inputScenes: EditScene[],
  options: {
    bpm?: number;
    beatOffsetSeconds?: number;
    maxShiftSeconds?: number;
  } = {},
): MusicBrainPlan {
  const bpm = options.bpm;
  const offset = options.beatOffsetSeconds ?? 0;
  const maxShift = options.maxShiftSeconds ?? 0.14;
  const scenes = recomputeOutputTimes(inputScenes.map((scene) => ({ ...scene })));
  const adjustments: MusicBrainPlan["adjustments"] = [];

  if (!bpm || !Number.isFinite(bpm) || bpm < 40 || bpm > 240) {
    return {
      version: "music-brain-v1",
      bpm,
      beatOffsetSeconds: offset,
      aligned: false,
      scenes,
      adjustments,
    };
  }

  for (let index = 0; index < scenes.length - 1; index += 1) {
    const current = scenes[index];
    const boundary = current.outputEnd;
    const beatBoundary = nearestBeat(boundary, bpm, offset);
    const shift = beatBoundary - boundary;

    if (Math.abs(shift) > maxShift) continue;

    const duration = current.sourceEnd - current.sourceStart;
    if (duration + shift < 0.35) continue;

    current.sourceEnd += shift;
    adjustments.push({
      sceneIndex: index,
      originalBoundary: Number(boundary.toFixed(3)),
      alignedBoundary: Number(beatBoundary.toFixed(3)),
      shiftSeconds: Number(shift.toFixed(3)),
    });

    const recomputed = recomputeOutputTimes(scenes);
    scenes.splice(0, scenes.length, ...recomputed);
  }

  return {
    version: "music-brain-v1",
    bpm,
    beatOffsetSeconds: offset,
    aligned: adjustments.length > 0,
    scenes,
    adjustments,
  };
}
