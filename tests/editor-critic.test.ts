import assert from "node:assert/strict";
import test from "node:test";
import { reviewEditorPlan } from "../src/editor-critic.js";

test("critic trims an overlong scene before render", () => {
  const result = reviewEditorPlan({
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
    semantics: [],
    scenes: [{
      sourceStart: 0,
      sourceEnd: 8,
      outputStart: 0,
      outputEnd: 8,
      stepIndexes: [0],
      importance: 0.8,
      shotIntents: ["continuity_action"],
      narrativeRole: "demonstration",
      reason: "Test",
    }],
    qualityGate: {
      passed: true,
      checks: {
        scenesExist: true,
        importantCoverage: true,
        finalMeaningfulStepCovered: true,
        durationsValid: true,
        chronological: true,
        sourceOverlapFree: true,
      },
      metrics: {
        meaningfulSteps: 1,
        coveredMeaningfulSteps: 1,
        weightedCoverage: 1,
        sceneCount: 1,
        sourceDurationSeconds: 8,
        editedDurationSeconds: 8,
      },
    },
  });

  assert.equal(result.passed, true);
  assert.equal(result.revisedScenes[0].outputEnd, 6.5);
  assert.ok(
    result.findings.some(
      (finding) => finding.code === "scene_too_long",
    ),
  );
});
