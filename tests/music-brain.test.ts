import assert from "node:assert/strict";
import test from "node:test";
import { alignScenesToBeatGrid } from "../src/music-brain.js";

test("snaps eligible cut boundaries to nearby beats", () => {
  const scenes = [
    {
      sourceStart: 0,
      sourceEnd: 0.96,
      outputStart: 0,
      outputEnd: 0.96,
      stepIndexes: [0],
    },
    {
      sourceStart: 1.2,
      sourceEnd: 2.1,
      outputStart: 0.96,
      outputEnd: 1.86,
      stepIndexes: [1],
    },
  ];

  const plan = alignScenesToBeatGrid(scenes, {
    bpm: 120,
    maxShiftSeconds: 0.08,
  });

  assert.equal(plan.aligned, true);
  assert.equal(plan.adjustments.length, 1);
  assert.equal(plan.scenes[0].outputEnd, 1);
  assert.equal(plan.scenes[1].outputStart, 1);
});
