import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScenePlan,
  editedDuration,
  mapSourceTimeToOutput,
} from "../src/scenes.js";

const manifest = {
  scenario: {
    name: "Demo",
    steps: [
      { action: "goto", label: "Open" },
      { action: "wait", label: "Pause" },
      { action: "click", label: "Choose" },
    ],
  },
  timeline: [
    {
      index: 0,
      label: "Open",
      action: "goto",
      startedAt: "2026-10-02T00:00:00.000Z",
      finishedAt: "2026-10-02T00:00:01.000Z",
      success: true,
    },
    {
      index: 1,
      label: "Pause",
      action: "wait",
      startedAt: "2026-10-02T00:00:01.000Z",
      finishedAt: "2026-10-02T00:00:05.000Z",
      success: true,
    },
    {
      index: 2,
      label: "Choose",
      action: "click",
      startedAt: "2026-10-02T00:00:05.000Z",
      finishedAt: "2026-10-02T00:00:06.000Z",
      success: true,
    },
  ],
  startedAt: "2026-10-02T00:00:00.000Z",
  finishedAt: "2026-10-02T00:00:06.000Z",
};

test("removes dead wait time between presentation scenes", () => {
  const scenes = buildScenePlan(manifest);

  assert.equal(scenes.length, 2);
  assert.ok(editedDuration(manifest, scenes) < 3);
  assert.ok(editedDuration(manifest, scenes) < 6);
});

test("maps source timestamps into the edited timeline", () => {
  const scenes = buildScenePlan(manifest);
  const mapped = mapSourceTimeToOutput(5.2, scenes);

  assert.equal(typeof mapped, "number");
  assert.ok((mapped ?? 99) < 3);
});
