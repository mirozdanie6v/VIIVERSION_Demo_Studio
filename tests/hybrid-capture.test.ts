import assert from "node:assert/strict";
import test from "node:test";
import {
  hybridCaptureEnabled,
  hybridScenarioForExecution,
  planHybridCapture,
  resolvedStepPauseMs,
} from "../src/hybrid-capture.js";
import type { DemoScenario } from "../src/types.js";

const scenario: DemoScenario = {
  name: "Hybrid plan",
  defaultPauseMs: 500,
  presentation: {
    smartZoom: { transitionMs: 420, settleMs: 120 },
    clickRipple: { durationMs: 360 },
    localeOverlay: {
      language: "en",
      replacements: { "Привет": "Hello" },
    },
  },
  steps: [
    { action: "goto", url: "/", label: "Open" },
    { action: "waitFor", target: "#app", label: "Ready" },
    { action: "click", target: "#book", label: "Book" },
    { action: "waitFor", target: "#form", label: "Form ready" },
    { action: "fill", target: "#name", value: "Demo", label: "Name" },
    { action: "hover", target: "#pay", label: "Hover pay", pauseAfterMs: 900 },
    { action: "scroll", y: 300, label: "Scroll" },
    { action: "waitForContentGrowth", target: "body", label: "AI answer" },
    { action: "assert", target: "#done", assertion: "visible", label: "Done" },
  ],
};

test("hybrid capture is opt-in only", () => {
  assert.equal(hybridCaptureEnabled({}), false);
  assert.equal(hybridCaptureEnabled({ DEMO_STUDIO_HYBRID_CAPTURE: "true" }), true);
  assert.equal(hybridCaptureEnabled({ DEMO_STUDIO_HYBRID_CAPTURE: "1" }), true);
  assert.equal(hybridCaptureEnabled({ DEMO_STUDIO_HYBRID_CAPTURE: "false" }), false);
});

test("hybrid planner keeps motion and async boundaries real-time", () => {
  const plan = planHybridCapture(scenario);
  assert.equal(plan[0].mode, "keyframe");
  assert.equal(plan[1].mode, "realtime");
  assert.equal(plan[2].mode, "keyframe");
  assert.equal(plan[3].mode, "realtime");
  assert.equal(plan[4].mode, "keyframe");
  assert.equal(plan[5].mode, "realtime");
  assert.equal(plan[6].mode, "realtime");
  assert.equal(plan[7].mode, "realtime");
  assert.equal(plan[8].mode, "passive");
});

test("click without a following readiness boundary stays real-time", () => {
  const plan = planHybridCapture({
    name: "Unsafe click",
    steps: [
      { action: "click", target: "#next", label: "Next" },
      { action: "fill", target: "#name", value: "Demo", label: "Name" },
    ],
  });
  assert.equal(plan[0].mode, "realtime");
});

test("hybrid execution disables presentation motion but preserves locale overlay", () => {
  const execution = hybridScenarioForExecution(scenario);
  assert.equal(execution.presentation?.enabled, false);
  assert.equal(execution.presentation?.smartZoom?.transitionMs, 0);
  assert.equal(execution.presentation?.smartZoom?.settleMs, 0);
  assert.equal(execution.presentation?.clickRipple?.durationMs, 0);
  assert.deepEqual(execution.presentation?.localeOverlay, scenario.presentation?.localeOverlay);
});

test("hybrid keyframes remove presentation pause while real-time steps keep it", () => {
  const plan = planHybridCapture(scenario);
  assert.equal(resolvedStepPauseMs(scenario.steps[0], scenario, plan[0]), 0);
  assert.equal(resolvedStepPauseMs(scenario.steps[1], scenario, plan[1]), 500);
  assert.equal(resolvedStepPauseMs(scenario.steps[5], scenario, plan[5]), 900);
});
