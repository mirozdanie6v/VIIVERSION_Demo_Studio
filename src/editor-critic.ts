import type { EditorBrainPlan, EditorScene } from "./editor-brain.js";

export type CriticFinding = {
  severity: "info" | "warning" | "error";
  code:
    | "quality_gate"
    | "scene_too_long"
    | "scene_too_short"
    | "weak_proof_hold"
    | "weak_ending"
    | "high_cut_density";
  sceneIndex?: number;
  message: string;
  revision?: string;
};

export type CriticResult = {
  version: "editor-critic-v1";
  passed: boolean;
  findings: CriticFinding[];
  revisedScenes: EditorScene[];
};

function recomputeOutputTimes(scenes: EditorScene[]): EditorScene[] {
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

export function reviewEditorPlan(plan: EditorBrainPlan): CriticResult {
  const findings: CriticFinding[] = [];
  let scenes = plan.scenes.map((scene) => ({ ...scene }));

  if (!plan.qualityGate.passed) {
    findings.push({
      severity: "error",
      code: "quality_gate",
      message: "Editor Brain quality gate did not pass.",
      revision: "Reject render until semantic coverage and scene validity pass.",
    });
  }

  const sourceDuration = plan.qualityGate.metrics.sourceDurationSeconds;

  scenes = scenes.map((scene, index) => {
    let sourceEnd = scene.sourceEnd;
    const duration = sourceEnd - scene.sourceStart;

    const contentHold = scene.stepIndexes.some((stepIndex) => {
      const semantic = plan.semantics[stepIndex];
      return semantic?.shotIntent === "continuity_speech" ||
        (semantic?.action === "wait" && semantic.importance >= 0.5);
    });
    const maxDuration = contentHold ? 30 : 6.5;

    if (duration > maxDuration) {
      sourceEnd = scene.sourceStart + maxDuration;
      findings.push({
        severity: "warning",
        code: "scene_too_long",
        sceneIndex: index,
        message: `Scene ${index + 1} is ${duration.toFixed(2)}s long.`,
        revision: `Trim to a maximum ${maxDuration}s hold.`,
      });
    }

    if (duration < 0.35) {
      sourceEnd = Math.min(sourceDuration, scene.sourceStart + 0.35);
      findings.push({
        severity: "warning",
        code: "scene_too_short",
        sceneIndex: index,
        message: `Scene ${index + 1} is too short to read visually.`,
        revision: "Extend to at least 0.35s.",
      });
    }

    if (
      scene.narrativeRole === "proof" &&
      sourceEnd - scene.sourceStart < 0.85
    ) {
      sourceEnd = Math.min(sourceDuration, scene.sourceStart + 0.85);
      findings.push({
        severity: "info",
        code: "weak_proof_hold",
        sceneIndex: index,
        message: "A proof/result scene needs more recognition time.",
        revision: "Hold the result for at least 0.85s.",
      });
    }

    return { ...scene, sourceEnd };
  });

  scenes = recomputeOutputTimes(scenes);

  const editedDuration = scenes.at(-1)?.outputEnd ?? 0;
  const cutDensity =
    editedDuration > 0 ? Math.max(0, scenes.length - 1) / editedDuration : 0;

  if (cutDensity > 0.9) {
    findings.push({
      severity: "warning",
      code: "high_cut_density",
      message: `Cut density is ${cutDensity.toFixed(2)} cuts/sec.`,
      revision: "Merge adjacent low-value scenes or increase visual holds.",
    });
  }

  const last = scenes.at(-1);
  if (
    last &&
    last.narrativeRole !== "proof" &&
    last.narrativeRole !== "conversion"
  ) {
    findings.push({
      severity: "info",
      code: "weak_ending",
      sceneIndex: scenes.length - 1,
      message: "The final scene is informational rather than proof/conversion.",
      revision: "Prefer a visible result or customer-intent action as the ending.",
    });
  }

  const hardErrors = findings.some((finding) => finding.severity === "error");

  return {
    version: "editor-critic-v1",
    passed: !hardErrors,
    findings,
    revisedScenes: scenes,
  };
}
