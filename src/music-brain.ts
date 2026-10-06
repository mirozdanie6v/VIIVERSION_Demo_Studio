import type { EditScene } from "./scenes.js";

export type MusicAccentCue = {
  sceneIndex: number;
  timeSeconds: number;
  kind: "ui_click" | "ui_result";
  strength: "subtle" | "normal";
};

export type MusicBrainPlan = {
  version: "music-brain-v1";
  bpm?: number;
  beatOffsetSeconds: number;
  aligned: boolean;
  scenes: EditScene[];
  accents: MusicAccentCue[];
  adjustments: Array<{
    sceneIndex: number;
    originalBoundary: number;
    alignedBoundary: number;
    shiftSeconds: number;
  }>;
};

function buildAccentCues(scenes: EditScene[]): MusicAccentCue[] {
  return scenes.flatMap((scene, sceneIndex) => {
    const semanticScene = scene as EditScene & {
      shotIntents?: string[];
      importance?: number;
    };
    const intents = semanticScene.shotIntents ?? [];
    const duration = Math.max(0, scene.outputEnd - scene.outputStart);
    const cues: MusicAccentCue[] = [];

    if (intents.includes("continuity_action")) {
      cues.push({
        sceneIndex,
        timeSeconds: Number(
          (scene.outputStart + Math.min(0.14, duration * 0.2)).toFixed(3),
        ),
        kind: "ui_click",
        strength:
          (semanticScene.importance ?? 0) >= 0.9 ? "normal" : "subtle",
      });
    }

    if (intents.includes("reaction")) {
      cues.push({
        sceneIndex,
        timeSeconds: Number(
          Math.max(
            scene.outputStart,
            scene.outputEnd - Math.min(0.2, duration * 0.25),
          ).toFixed(3),
        ),
        kind: "ui_result",
        strength:
          (semanticScene.importance ?? 0) >= 0.9 ? "normal" : "subtle",
      });
    }

    return cues;
  });
}

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
  const scenes = recomputeOutputTimes(
    inputScenes.map((scene) => ({ ...scene })),
  );
  const adjustments: MusicBrainPlan["adjustments"] = [];

  if (!bpm || !Number.isFinite(bpm) || bpm < 40 || bpm > 240) {
    return {
      version: "music-brain-v1",
      bpm,
      beatOffsetSeconds: offset,
      aligned: false,
      scenes,
      accents: buildAccentCues(scenes),
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
    accents: buildAccentCues(scenes),
    adjustments,
  };
}
