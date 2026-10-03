import assert from "node:assert/strict";
import test from "node:test";
import { buildEditorBrainPlan, semanticStep } from "../src/editor-brain.js";

const manifest = {
  scenario: {
    name: "Checkout",
    steps: [
      { action: "goto", label: "Open app" },
      { action: "click", label: "Calculate price" },
      { action: "waitFor", label: "Result ready" },
      { action: "assert", label: "Calculation completed" },
    ],
  },
  timeline: [
    {
      index: 0,
      label: "Open app",
      action: "goto",
      startedAt: "2026-10-03T00:00:00.000Z",
      finishedAt: "2026-10-03T00:00:00.700Z",
      success: true,
    },
    {
      index: 1,
      label: "Calculate price",
      action: "click",
      startedAt: "2026-10-03T00:00:01.000Z",
      finishedAt: "2026-10-03T00:00:01.300Z",
      success: true,
    },
    {
      index: 2,
      label: "Result ready",
      action: "waitFor",
      startedAt: "2026-10-03T00:00:01.300Z",
      finishedAt: "2026-10-03T00:00:01.700Z",
      success: true,
    },
    {
      index: 3,
      label: "Calculation completed",
      action: "assert",
      startedAt: "2026-10-03T00:00:01.700Z",
      finishedAt: "2026-10-03T00:00:01.900Z",
      success: true,
    },
  ],
  startedAt: "2026-10-03T00:00:00.000Z",
  finishedAt: "2026-10-03T00:00:02.200Z",
};

test("reuses Human Editor semantic fields for product-demo steps", () => {
  const semantic = semanticStep(
    { action: "click", label: "Submit request" },
    2,
  );

  assert.equal(semantic.shotIntent, "continuity_action");
  assert.equal(semantic.continuity, "preserve_with_next");
  assert.equal(semantic.narrativeRole, "conversion");
  assert.ok(semantic.importance >= 0.9);
  assert.match(semantic.editStrategy, /Preserve action/);
});

test("keeps action and visible result in the same editorial unit", () => {
  const plan = buildEditorBrainPlan(manifest);

  assert.equal(plan.version, "editor-brain-v1");
  assert.equal(
    plan.reuseSource.repository,
    "mirozdanie6v/EventVideoHumanEditor",
  );
  assert.equal(plan.qualityGate.passed, true);

  const resultScene = plan.scenes.find((scene) =>
    scene.stepIndexes.includes(1),
  );
  assert.ok(resultScene);
  assert.deepEqual(resultScene?.stepIndexes, [1, 2, 3]);
  assert.equal(resultScene?.narrativeRole, "proof");
  assert.equal(plan.scenes[0].narrativeRole, "setup");
});


test("technical waits do not collapse setup into proof", () => {
  const plan = buildEditorBrainPlan({
    scenario: {
      name: "Smoke",
      steps: [
        { action: "goto", label: "Open application" },
        { action: "waitFor" },
        { action: "click", label: "Open catalog" },
        { action: "waitFor" },
        { action: "assert", label: "Verify result" },
        { action: "wait" },
      ],
    },
    timeline: [
      {
        index: 0,
        label: "Open application",
        action: "goto",
        startedAt: "2026-10-03T00:00:00.000Z",
        finishedAt: "2026-10-03T00:00:00.900Z",
        success: true,
      },
      {
        index: 1,
        label: "waitFor #2",
        action: "waitFor",
        startedAt: "2026-10-03T00:00:00.900Z",
        finishedAt: "2026-10-03T00:00:00.930Z",
        success: true,
      },
      {
        index: 2,
        label: "Open catalog",
        action: "click",
        startedAt: "2026-10-03T00:00:00.930Z",
        finishedAt: "2026-10-03T00:00:02.200Z",
        success: true,
      },
      {
        index: 3,
        label: "waitFor #4",
        action: "waitFor",
        startedAt: "2026-10-03T00:00:02.200Z",
        finishedAt: "2026-10-03T00:00:02.230Z",
        success: true,
      },
      {
        index: 4,
        label: "Verify result",
        action: "assert",
        startedAt: "2026-10-03T00:00:02.230Z",
        finishedAt: "2026-10-03T00:00:02.500Z",
        success: true,
      },
      {
        index: 5,
        label: "wait #6",
        action: "wait",
        startedAt: "2026-10-03T00:00:02.500Z",
        finishedAt: "2026-10-03T00:00:03.200Z",
        success: true,
      },
    ],
    startedAt: "2026-10-03T00:00:00.000Z",
    finishedAt: "2026-10-03T00:00:03.200Z",
  });

  assert.equal(plan.qualityGate.passed, true);
  assert.ok(plan.scenes.length >= 2);
  assert.equal(plan.scenes[0].narrativeRole, "setup");
  assert.equal(plan.scenes.at(-1)?.narrativeRole, "proof");
  assert.deepEqual(plan.scenes.at(-1)?.stepIndexes, [2, 3, 4, 5]);
  assert.equal(plan.qualityGate.checks.sourceOverlapFree, true);
  assert.ok(plan.scenes[1].sourceStart >= plan.scenes[0].sourceEnd);
});


test("compresses long unlabeled technical waits but preserves content holds", () => {
  const plan = buildEditorBrainPlan({
    scenario: {
      name: "Paced demo",
      steps: [
        { action: "click", label: "Open product" },
        { action: "wait", ms: 1800 },
        { action: "scroll", y: 400, label: "Show details" },
        {
          action: "wait",
          ms: 1200,
          label: "Let the viewer read",
          narration: "Key details remain visible long enough to understand.",
        },
      ],
    },
    timeline: [
      {
        index: 0,
        label: "Open product",
        action: "click",
        startedAt: "2026-10-03T00:00:00.000Z",
        finishedAt: "2026-10-03T00:00:00.300Z",
        success: true,
      },
      {
        index: 1,
        label: "wait #2",
        action: "wait",
        startedAt: "2026-10-03T00:00:00.300Z",
        finishedAt: "2026-10-03T00:00:02.100Z",
        success: true,
      },
      {
        index: 2,
        label: "Show details",
        action: "scroll",
        startedAt: "2026-10-03T00:00:02.100Z",
        finishedAt: "2026-10-03T00:00:02.500Z",
        success: true,
      },
      {
        index: 3,
        label: "Let the viewer read",
        action: "wait",
        startedAt: "2026-10-03T00:00:02.500Z",
        finishedAt: "2026-10-03T00:00:03.700Z",
        success: true,
      },
    ],
    startedAt: "2026-10-03T00:00:00.000Z",
    finishedAt: "2026-10-03T00:00:03.700Z",
  });

  assert.equal(plan.qualityGate.passed, true);
  assert.ok(
    plan.qualityGate.metrics.editedDurationSeconds <=
      plan.qualityGate.metrics.sourceDurationSeconds - 0.8,
  );
  assert.ok(plan.scenes[0].sourceEnd <= 0.9);
  assert.ok(plan.scenes.at(-1)?.stepIndexes.includes(3));
});
