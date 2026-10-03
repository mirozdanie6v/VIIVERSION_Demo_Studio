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
});
