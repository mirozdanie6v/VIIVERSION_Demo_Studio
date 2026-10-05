import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHybridCompositionPlan,
  hybridRenderEnabled,
  hybridRenderStrictEnabled,
  type HybridCaptureManifest,
  type HybridRenderManifest,
} from "../src/hybrid-compose.js";

const manifest: HybridRenderManifest = {
  scenario: {
    name: "Hybrid compose",
    defaultPauseMs: 600,
    steps: [
      { action: "goto", label: "Open" },
      { action: "waitFor", label: "Ready" },
      { action: "fill", label: "Name", narration: "Enter a customer name." },
      { action: "assert", label: "Done" },
    ],
  },
  timeline: [
    {
      index: 0,
      label: "Open",
      action: "goto",
      startedAt: "2026-10-05T10:00:00.000Z",
      finishedAt: "2026-10-05T10:00:00.120Z",
      success: true,
    },
    {
      index: 1,
      label: "Ready",
      action: "waitFor",
      startedAt: "2026-10-05T10:00:00.120Z",
      finishedAt: "2026-10-05T10:00:00.420Z",
      success: true,
    },
    {
      index: 2,
      label: "Name",
      action: "fill",
      startedAt: "2026-10-05T10:00:00.420Z",
      finishedAt: "2026-10-05T10:00:00.510Z",
      success: true,
    },
    {
      index: 3,
      label: "Done",
      action: "assert",
      startedAt: "2026-10-05T10:00:00.510Z",
      finishedAt: "2026-10-05T10:00:00.550Z",
      success: true,
    },
  ],
  startedAt: "2026-10-05T10:00:00.000Z",
  finishedAt: "2026-10-05T10:00:00.550Z",
  success: true,
  captureMode: "hybrid-prototype",
  videoPath: "/tmp/run/capture.webm",
  hybridManifestPath: "/tmp/run/hybrid_capture.json",
};

const hybrid: HybridCaptureManifest = {
  version: 1,
  experimental: true,
  scenarioName: "Hybrid compose",
  startedAt: manifest.startedAt,
  finishedAt: manifest.finishedAt!,
  realtimeSourceVideoPath: "/tmp/run/capture.webm",
  plan: [
    {
      index: 0,
      action: "goto",
      label: "Open",
      mode: "keyframe",
      reason: "stable",
    },
    {
      index: 1,
      action: "waitFor",
      label: "Ready",
      mode: "realtime",
      reason: "async",
    },
    {
      index: 2,
      action: "fill",
      label: "Name",
      mode: "keyframe",
      reason: "stable",
    },
    {
      index: 3,
      action: "assert",
      label: "Done",
      mode: "passive",
      reason: "passive",
    },
  ],
  keyframes: [
    {
      stepIndex: 0,
      action: "goto",
      mode: "keyframe",
      path: "/tmp/run/hybrid-keyframes/000-goto.png",
      capturedAt: "2026-10-05T10:00:00.120Z",
    },
    {
      stepIndex: 2,
      action: "fill",
      mode: "keyframe",
      path: "/tmp/run/hybrid-keyframes/002-fill.png",
      capturedAt: "2026-10-05T10:00:00.510Z",
    },
  ],
};

test("hybrid render is opt-in and strictness is independent", () => {
  assert.equal(hybridRenderEnabled({}), false);
  assert.equal(hybridRenderEnabled({ DEMO_STUDIO_HYBRID_RENDER: "true" }), true);
  assert.equal(hybridRenderStrictEnabled({}), false);
  assert.equal(
    hybridRenderStrictEnabled({ DEMO_STUDIO_HYBRID_RENDER_STRICT: "1" }),
    true,
  );
});

test("composition replaces static capture time with synthetic holds", () => {
  const plan = buildHybridCompositionPlan("/tmp/run", manifest, hybrid);

  assert.equal(plan.version, "hybrid-composition-v1");
  assert.equal(plan.segments.length, 3);
  assert.equal(plan.segments[0].kind, "keyframe");
  assert.equal(plan.segments[1].kind, "realtime");
  assert.equal(plan.segments[2].kind, "keyframe");

  const first = plan.segments[0];
  assert.equal(first.kind, "keyframe");
  if (first.kind === "keyframe") {
    assert.ok(first.duration >= 0.72);
  }

  const realtime = plan.segments[1];
  assert.equal(realtime.kind, "realtime");
  if (realtime.kind === "realtime") {
    assert.equal(Number(realtime.sourceStart.toFixed(3)), 0.12);
    assert.equal(Number(realtime.sourceEnd.toFixed(3)), 0.42);
    assert.equal(Number(realtime.duration.toFixed(3)), 0.3);
  }

  assert.ok(
    Date.parse(plan.syntheticTimeline[2].finishedAt) >
      Date.parse(plan.syntheticTimeline[2].startedAt),
  );
  assert.equal(
    plan.syntheticTimeline[3].startedAt,
    plan.syntheticTimeline[3].finishedAt,
  );
  assert.ok(plan.totalDurationSeconds > 1.4);
  assert.equal(
    plan.manifest.finishedAt,
    new Date(
      Date.parse(manifest.startedAt) +
        Math.round(plan.totalDurationSeconds * 1000),
    ).toISOString(),
  );
});

test("composition refuses incomplete hybrid artifacts", () => {
  assert.throws(
    () =>
      buildHybridCompositionPlan(
        "/tmp/run",
        manifest,
        {
          ...hybrid,
          keyframes: hybrid.keyframes.filter((frame) => frame.stepIndex !== 2),
        },
      ),
    /has no captured frame/,
  );
});
