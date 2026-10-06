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

test("emits optional UI accent metadata from semantic editor scenes", () => {
  const scenes = [
    {
      sourceStart: 0,
      sourceEnd: 1.2,
      outputStart: 0,
      outputEnd: 1.2,
      stepIndexes: [0],
      shotIntents: ["continuity_action"],
      importance: 0.95,
    },
    {
      sourceStart: 1.2,
      sourceEnd: 2.4,
      outputStart: 1.2,
      outputEnd: 2.4,
      stepIndexes: [1],
      shotIntents: ["reaction"],
      importance: 0.8,
    },
  ];

  const plan = alignScenesToBeatGrid(scenes);

  assert.deepEqual(
    plan.accents.map(({ kind, strength }) => ({ kind, strength })),
    [
      { kind: "ui_click", strength: "normal" },
      { kind: "ui_result", strength: "subtle" },
    ],
  );
  assert.ok(plan.accents[0].timeSeconds >= plan.scenes[0].outputStart);
  assert.ok(plan.accents[1].timeSeconds <= plan.scenes[1].outputEnd);
});
