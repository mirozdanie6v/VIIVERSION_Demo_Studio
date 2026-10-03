import type { EditScene, SceneManifest, SceneStep } from "./scenes.js";

export type HumanEditorShotIntent =
  | "broll_music"
  | "continuity_speech"
  | "continuity_action"
  | "reaction"
  | "ritual"
  | "atmosphere"
  | "montage";

export type ProductSceneType =
  | "establishing"
  | "navigation"
  | "discovery"
  | "interaction"
  | "input"
  | "result"
  | "proof"
  | "transition"
  | "closing";

export type NarrativeRole =
  | "setup"
  | "demonstration"
  | "proof"
  | "conversion";

export type SemanticStep = {
  index: number;
  action: string;
  sceneType: ProductSceneType;
  shotIntent: HumanEditorShotIntent;
  importance: number;
  continuity: "independent" | "preserve_with_next" | "reaction_to_previous";
  storyNote: string;
  editStrategy: string;
  narrativeRole: NarrativeRole;
};

export type EditorScene = EditScene & {
  importance: number;
  shotIntents: HumanEditorShotIntent[];
  narrativeRole: NarrativeRole;
  reason: string;
};

export type EditorQualityGate = {
  passed: boolean;
  checks: {
    scenesExist: boolean;
    importantCoverage: boolean;
    finalMeaningfulStepCovered: boolean;
    durationsValid: boolean;
    chronological: boolean;
    sourceOverlapFree: boolean;
  };
  metrics: {
    meaningfulSteps: number;
    coveredMeaningfulSteps: number;
    weightedCoverage: number;
    sceneCount: number;
    sourceDurationSeconds: number;
    editedDurationSeconds: number;
  };
};

export type EditorBrainPlan = {
  version: "editor-brain-v1";
  reuseSource: {
    repository: "mirozdanie6v/EventVideoHumanEditor";
    pipeline: "semantic-v5-quality-20260819";
    reusedConcepts: [
      "scene_type",
      "shot_intent",
      "importance",
      "continuity",
      "story_note",
      "edit_strategy",
      "quality_gate"
    ];
  };
  semantics: SemanticStep[];
  scenes: EditorScene[];
  qualityGate: EditorQualityGate;
};

const PASSIVE_ACTIONS = new Set([
  "wait",
  "waitFor",
  "waitForNavigation",
  "assert",
]);

const RESULT_WORDS =
  /\b(success|successful|confirmation|confirmed|result|ready|calculated|created|completed|submitted|booked|saved|sent|approved)\b/i;
const CONVERSION_WORDS =
  /\b(submit|book|buy|purchase|request|send|calculate|checkout|contact|start|continue)\b/i;

function secondsBetween(startIso: string, valueIso: string): number {
  return Math.max(0, (Date.parse(valueIso) - Date.parse(startIso)) / 1000);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stepText(step: SceneStep): string {
  return [step.label, step.narration].filter(Boolean).join(" ");
}

function strategyFor(intent: HumanEditorShotIntent): string {
  switch (intent) {
    case "continuity_speech":
      return "Preserve the complete spoken thought.";
    case "continuity_action":
      return "Preserve action and its immediate visual consequence.";
    case "reaction":
      return "Hold long enough for the result to register before cutting.";
    case "ritual":
      return "Preserve causal order and the complete interaction.";
    case "broll_music":
      return "Use as concise visual support under music or narration.";
    case "atmosphere":
      return "Use as a short orientation or breathing beat.";
    case "montage":
      return "Keep only the most informative visual movement.";
  }
}

export function semanticStep(
  step: SceneStep,
  index: number,
): SemanticStep {
  const text = stepText(step);
  let sceneType: ProductSceneType;
  let shotIntent: HumanEditorShotIntent;
  let importance: number;
  let continuity: SemanticStep["continuity"];

  switch (step.action) {
    case "goto":
      sceneType = "establishing";
      shotIntent = "atmosphere";
      importance = 0.62;
      continuity = "independent";
      break;
    case "click":
      sceneType = CONVERSION_WORDS.test(text) ? "closing" : "interaction";
      shotIntent = "continuity_action";
      importance = sceneType === "closing" ? 0.94 : 0.82;
      continuity = "preserve_with_next";
      break;
    case "fill":
      sceneType = "input";
      shotIntent = "continuity_action";
      importance = 0.72;
      continuity = "preserve_with_next";
      break;
    case "press":
      sceneType = "interaction";
      shotIntent = "continuity_action";
      importance = 0.78;
      continuity = "preserve_with_next";
      break;
    case "scroll":
      sceneType = "navigation";
      shotIntent = "montage";
      importance = 0.4;
      continuity = "independent";
      break;
    case "hover":
      sceneType = "discovery";
      shotIntent = "broll_music";
      importance = 0.35;
      continuity = "independent";
      break;
    case "waitFor":
    case "waitForNavigation":
      if (text.trim()) {
        sceneType = "result";
        shotIntent = "reaction";
        importance = 0.9;
      } else {
        sceneType = "transition";
        shotIntent = "atmosphere";
        importance = 0.08;
      }
      continuity = "reaction_to_previous";
      break;
    case "assert":
      sceneType = "proof";
      shotIntent = "reaction";
      importance = 0.97;
      continuity = "reaction_to_previous";
      break;
    case "wait":
      sceneType = "transition";
      shotIntent = "atmosphere";
      importance = text.trim() ? 0.5 : 0.08;
      continuity = "reaction_to_previous";
      break;
    default:
      sceneType = "transition";
      shotIntent = "atmosphere";
      importance = 0.2;
      continuity = "independent";
  }

  if (RESULT_WORDS.test(text)) {
    sceneType = sceneType === "proof" ? "proof" : "result";
    importance = Math.max(importance, 0.92);
  }

  const narrativeRole: NarrativeRole =
    sceneType === "establishing"
      ? "setup"
      : sceneType === "proof" || sceneType === "result"
        ? "proof"
        : sceneType === "closing"
          ? "conversion"
          : "demonstration";

  const storyNote =
    narrativeRole === "setup"
      ? "Orient the viewer before the product flow begins."
      : narrativeRole === "proof"
        ? "Show the visible outcome that proves the action worked."
        : narrativeRole === "conversion"
          ? "Land the demo on the action closest to customer intent."
          : "Advance the viewer through the core product workflow.";

  return {
    index,
    action: step.action,
    sceneType,
    shotIntent,
    importance: clamp01(importance),
    continuity,
    storyNote,
    editStrategy: strategyFor(shotIntent),
    narrativeRole,
  };
}

function tailFor(semantic: SemanticStep): number {
  if (semantic.shotIntent === "reaction") return 0.68;
  if (semantic.importance >= 0.9) return 0.58;
  if (semantic.importance >= 0.7) return 0.44;
  return 0.24;
}

function leadFor(semantic: SemanticStep): number {
  if (semantic.sceneType === "establishing") return 0.08;
  if (semantic.importance >= 0.9) return 0.2;
  if (semantic.importance >= 0.7) return 0.16;
  return 0.1;
}

function sourceDuration(manifest: SceneManifest): number {
  if (manifest.finishedAt) {
    return secondsBetween(manifest.startedAt, manifest.finishedAt);
  }
  return manifest.timeline.reduce(
    (max, item) =>
      Math.max(max, secondsBetween(manifest.startedAt, item.finishedAt)),
    0,
  );
}

function makeCandidates(
  manifest: SceneManifest,
  semantics: SemanticStep[],
): Array<Omit<EditorScene, "outputStart" | "outputEnd">> {
  const duration = sourceDuration(manifest);
  const candidates: Array<Omit<EditorScene, "outputStart" | "outputEnd">> = [];

  for (let i = 0; i < manifest.timeline.length; i += 1) {
    const item = manifest.timeline[i];
    if (!item.success) continue;

    const semantic = semantics[item.index];
    if (!semantic || PASSIVE_ACTIONS.has(item.action)) continue;

    let sourceStart = Math.max(
      0,
      secondsBetween(manifest.startedAt, item.startedAt) - leadFor(semantic),
    );
    let sourceEnd = Math.min(
      duration,
      secondsBetween(manifest.startedAt, item.finishedAt) + tailFor(semantic),
    );
    const stepIndexes = [item.index];
    const intents = [semantic.shotIntent];
    let importance = semantic.importance;
    let narrativeRole = semantic.narrativeRole;

    for (let j = i + 1; j < manifest.timeline.length; j += 1) {
      const next = manifest.timeline[j];
      if (!next.success) break;

      const nextSemantic = semantics[next.index];
      if (!nextSemantic) break;

      const isReaction =
        nextSemantic.continuity === "reaction_to_previous" ||
        PASSIVE_ACTIONS.has(next.action);

      if (!isReaction) break;

      const nextStartedAt = secondsBetween(
        manifest.startedAt,
        next.startedAt,
      );
      const nextFinishedAt = secondsBetween(
        manifest.startedAt,
        next.finishedAt,
      );
      const technicalTransition =
        nextSemantic.sceneType === "transition" &&
        nextSemantic.importance <= 0.1;
      const nextEnd = technicalTransition
        ? Math.min(nextFinishedAt, nextStartedAt + 0.42) + 0.12
        : nextFinishedAt + tailFor(nextSemantic);

      sourceEnd = Math.min(duration, Math.max(sourceEnd, nextEnd));
      stepIndexes.push(next.index);
      intents.push(nextSemantic.shotIntent);
      importance = Math.max(importance, nextSemantic.importance);
      if (nextSemantic.narrativeRole === "proof") {
        narrativeRole = "proof";
      }
      i = j;
    }

    candidates.push({
      sourceStart,
      sourceEnd,
      stepIndexes,
      importance,
      shotIntents: [...new Set(intents)],
      narrativeRole,
      reason:
        semantic.continuity === "preserve_with_next"
          ? "Preserve action and consequence as one editorial unit."
          : semantic.editStrategy,
    });
  }

  return candidates.filter(
    (scene) => scene.sourceEnd > scene.sourceStart + 0.08,
  );
}

function mergeCandidates(
  candidates: Array<Omit<EditorScene, "outputStart" | "outputEnd">>,
): Array<Omit<EditorScene, "outputStart" | "outputEnd">> {
  const merged: Array<Omit<EditorScene, "outputStart" | "outputEnd">> = [];

  for (const candidate of candidates) {
    const previous = merged.at(-1);
    if (!previous) {
      merged.push({ ...candidate });
      continue;
    }

    const gap = candidate.sourceStart - previous.sourceEnd;
    const combinedDuration =
      Math.max(previous.sourceEnd, candidate.sourceEnd) -
      previous.sourceStart;
    const continuityDriven =
      previous.shotIntents.includes("continuity_action") &&
      candidate.shotIntents.includes("continuity_action");
    const narrativeBoundary =
      previous.narrativeRole !== candidate.narrativeRole &&
      (
        previous.narrativeRole === "setup" ||
        candidate.narrativeRole === "proof" ||
        candidate.narrativeRole === "conversion"
      );

    if (
      !narrativeBoundary &&
      combinedDuration <= 6.5 &&
      (gap <= 0.22 || (gap <= 0.48 && continuityDriven))
    ) {
      previous.sourceEnd = Math.max(
        previous.sourceEnd,
        candidate.sourceEnd,
      );
      previous.stepIndexes.push(...candidate.stepIndexes);
      previous.importance = Math.max(
        previous.importance,
        candidate.importance,
      );
      previous.shotIntents = [
        ...new Set([
          ...previous.shotIntents,
          ...candidate.shotIntents,
        ]),
      ];
      if (candidate.narrativeRole === "proof") {
        previous.narrativeRole = "proof";
      } else if (candidate.narrativeRole === "conversion") {
        previous.narrativeRole = "conversion";
      }
      previous.reason += " " + candidate.reason;
      continue;
    }

    merged.push({ ...candidate });
  }

  return merged;
}

function resolveSourceOverlaps(
  scenes: Array<Omit<EditorScene, "outputStart" | "outputEnd">>,
): Array<Omit<EditorScene, "outputStart" | "outputEnd">> {
  const resolved = scenes.map((scene) => ({ ...scene }));

  for (let index = 1; index < resolved.length; index += 1) {
    const previous = resolved[index - 1];
    const current = resolved[index];

    if (current.sourceStart >= previous.sourceEnd) continue;

    const minimumSceneSeconds = 0.25;
    const lowerBoundary = previous.sourceStart + minimumSceneSeconds;
    const upperBoundary = current.sourceEnd - minimumSceneSeconds;
    const preferredBoundary =
      current.importance >= previous.importance
        ? current.sourceStart
        : previous.sourceEnd;

    let boundary: number;
    if (lowerBoundary <= upperBoundary) {
      boundary = Math.min(
        upperBoundary,
        Math.max(lowerBoundary, preferredBoundary),
      );
    } else {
      boundary =
        (Math.max(previous.sourceStart, current.sourceStart) +
          Math.min(previous.sourceEnd, current.sourceEnd)) /
        2;
    }

    previous.sourceEnd = boundary;
    current.sourceStart = boundary;
  }

  return resolved;
}

function assignOutputTimes(
  scenes: Array<Omit<EditorScene, "outputStart" | "outputEnd">>,
): EditorScene[] {
  let cursor = 0;
  return scenes.map((scene) => {
    const length = scene.sourceEnd - scene.sourceStart;
    const output: EditorScene = {
      ...scene,
      outputStart: cursor,
      outputEnd: cursor + length,
    };
    cursor += length;
    return output;
  });
}

function qualityGate(
  manifest: SceneManifest,
  semantics: SemanticStep[],
  scenes: EditorScene[],
): EditorQualityGate {
  const meaningful = semantics.filter(
    (semantic) =>
      semantic.importance >= 0.25 &&
      manifest.timeline.some(
        (item) => item.index === semantic.index && item.success,
      ),
  );
  const coveredIndexes = new Set(
    scenes.flatMap((scene) => scene.stepIndexes),
  );
  const covered = meaningful.filter((semantic) =>
    coveredIndexes.has(semantic.index),
  );

  const totalWeight = meaningful.reduce(
    (sum, semantic) => sum + semantic.importance,
    0,
  );
  const coveredWeight = covered.reduce(
    (sum, semantic) => sum + semantic.importance,
    0,
  );
  const weightedCoverage =
    totalWeight > 0 ? coveredWeight / totalWeight : 1;

  const finalMeaningful = meaningful.at(-1);
  const chronological = scenes.every(
    (scene, index) =>
      index === 0 ||
      scene.sourceStart >= scenes[index - 1].sourceStart,
  );
  const durationsValid = scenes.every((scene) => {
    const duration = scene.sourceEnd - scene.sourceStart;
    const contentHold = scene.stepIndexes.some((stepIndex) => {
      const semantic = semantics[stepIndex];
      return semantic?.action === "wait" && semantic.importance >= 0.5;
    });
    const maxDuration = contentHold ? 18 : 8.5;
    return duration >= 0.2 && duration <= maxDuration;
  });

  const sourceOverlapFree = scenes.every(
    (scene, index) =>
      index === 0 ||
      scene.sourceStart >= scenes[index - 1].sourceEnd - 0.001,
  );

  const checks = {
    scenesExist: scenes.length > 0,
    importantCoverage: weightedCoverage >= 0.95,
    finalMeaningfulStepCovered:
      !finalMeaningful || coveredIndexes.has(finalMeaningful.index),
    durationsValid,
    chronological,
    sourceOverlapFree,
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    metrics: {
      meaningfulSteps: meaningful.length,
      coveredMeaningfulSteps: covered.length,
      weightedCoverage: Number(weightedCoverage.toFixed(4)),
      sceneCount: scenes.length,
      sourceDurationSeconds: Number(sourceDuration(manifest).toFixed(3)),
      editedDurationSeconds: Number(
        (scenes.at(-1)?.outputEnd ?? 0).toFixed(3),
      ),
    },
  };
}

export function buildEditorBrainPlan(
  manifest: SceneManifest,
): EditorBrainPlan {
  const semantics = manifest.scenario.steps.map((step, index) =>
    semanticStep(step, index),
  );

  let scenes = assignOutputTimes(
    resolveSourceOverlaps(
      mergeCandidates(makeCandidates(manifest, semantics)),
    ),
  );

  if (scenes.length === 0 && sourceDuration(manifest) > 0) {
    const duration = sourceDuration(manifest);
    scenes = [
      {
        sourceStart: 0,
        sourceEnd: duration,
        outputStart: 0,
        outputEnd: duration,
        stepIndexes: manifest.timeline
          .filter((item) => item.success)
          .map((item) => item.index),
        importance: 0.5,
        shotIntents: ["atmosphere"],
        narrativeRole: "setup",
        reason: "Fallback preserves the successful capture.",
      },
    ];
  }

  return {
    version: "editor-brain-v1",
    reuseSource: {
      repository: "mirozdanie6v/EventVideoHumanEditor",
      pipeline: "semantic-v5-quality-20260819",
      reusedConcepts: [
        "scene_type",
        "shot_intent",
        "importance",
        "continuity",
        "story_note",
        "edit_strategy",
        "quality_gate",
      ],
    },
    semantics,
    scenes,
    qualityGate: qualityGate(manifest, semantics, scenes),
  };
}
