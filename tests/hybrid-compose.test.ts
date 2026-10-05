import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHybridCompositionPlan,
  syntheticKeyframeDuration,
} from "../src/hybrid-compose.js";
import type { DemoScenario } from "../src/types.js";

const scenario: DemoScenario = {
  name: "Hybrid composition",
  defaultPauseMs: 450,
  viewport: { width: 430, height: 932 },
  steps: [
    { action: "goto", url: "/", label: "Open" },
    { action: "waitFor", target: "#app", label: "Ready" },
    { action: "click", target: "#book", label: "Book", pauseAfterMs: 800 },
    { action: "assert", target: "#done", assertion: "visible", label: "Done" },
  ],
};

const run = {
  scenario,
  startedAt: "2026-10-05T00:00:00.000Z",
  finishedAt: "2026-10-05T00:00:04.000Z",
  videoPath: "/tmp/source.webm",
  success: true,
  timeline: [
    {
      index: 0,
      label: "Open",
      action: "goto" as const,
      startedAt: "2026-10-05T00:00:00.000Z",
      finishedAt: "2026-10-05T00:00:00.200Z",
      success: true,
    },
    {
      index: 1,
      label: "Ready",
      action: "waitFor" as const,
      startedAt: "2026-10-05T00:00:00.200Z",
      finishedAt: "2026-10-05T00:00:01.200Z",
      success: true,
    },
    {
      index: 2,
      label: "Book",
      action: "click" as const,
      startedAt: "2026-10-05T00:00:01.200Z",
      finishedAt: "2026-10-05T00:00:02.700Z",
      success: true,
    },
    {
      index: 3,
      label: "Done",
      action: "assert" as const,
      startedAt: "2026-10-05T00:00:02.700Z",
      finishedAt: "2026-10-05T00:00:02.800Z",
      success: true,
    },
  ],
};

const hybrid = {
  version: 1,
  experimental: true,
  scenarioName: scenario.name,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  realtimeSourceVideoPath: "/tmp/source.webm",
  plan: [
    {
      index: 0,
      action: "goto" as const,
      label: "Open",
      mode: "keyframe" as const,
      reason: "stable",
    },
    {
      index: 1,
      action: "waitFor" as const,
      label: "Ready",
      mode: "realtime" as const,
      reason: "async",
    },
    {
      index: 2,
      action: "click" as const,
      label: "Book",
      mode: "keyframe" as const,
      reason: "stable",
    },
    {
      index: 3,
      action: "assert" as const,
      label: "Done",
      mode: "passive" as const,
      reason: "passive",
    },
  ],
  keyframes: [
    {
      stepIndex: 0,
      action: "goto" as const,
      mode: "keyframe" as const,
      path: "/tmp/open.png",
      capturedAt: run.timeline[0].finishedAt,
    },
    {
      stepIndex: 2,
      action: "click" as const,
      mode: "keyframe" as const,
      path: "/tmp/book.png",
      capturedAt: run.timeline[2].finishedAt,
    },
  ],
};

test("synthetic keyframe duration preserves intended hold without browser animation delay", () => {
  assert.equal(syntheticKeyframeDuration(scenario.steps[0], scenario), 0.85);
  assert.equal(syntheticKeyframeDuration(scenario.steps[2], scenario), 1.2);
});

test("builds sequential hybrid segments and synthetic timeline", () => {
  const plan = buildHybridCompositionPlan(run, hybrid);

  assert.equal(plan.viewport.width, 430);
  assert.equal(plan.segments.length, 3);
  assert.deepEqual(
    plan.segments.map((segment) => segment.mode),
    ["keyframe", "realtime", "keyframe"],
  );
  assert.equal(plan.segments[0].durationSeconds, 0.85);
  assert.equal(plan.segments[1].durationSeconds, 1);
  assert.equal(plan.segments[2].durationSeconds, 1.2);
  assert.equal(Number(plan.durationSeconds.toFixed(2)), 3.05);
  assert.equal(
    plan.timeline[3].startedAt,
    plan.timeline[3].finishedAt,
  );
  assert.equal(
    plan.timeline[1].startedAt,
    plan.timeline[0].finishedAt,
  );
});

test("requires a keyframe for every keyframe-planned step", () => {
  assert.throws(
    () =>
      buildHybridCompositionPlan(run, {
        ...hybrid,
        keyframes: hybrid.keyframes.filter(
          (frame) => frame.stepIndex !== 2,
        ),
      }),
    /missing for step 2/i,
  );
});
