import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaptionPlan,
  captionPlanToSrt,
  splitCaptionText,
  subtitleAlignmentForPlacement,
} from "../src/caption-brain.js";

test("splits long narration into readable semantic chunks", () => {
  const chunks = splitCaptionText(
    "Choose the tour, confirm the date, and continue to the booking summary with the final price visible.",
    { maxWords: 6, maxChars: 32 },
  );

  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.split(/\s+/).length <= 6));
});

test("keeps cues sequential and uses a larger vertical safe zone", () => {
  const manifest = {
    scenario: {
      name: "Demo",
      steps: [
        {
          action: "click",
          label: "Open tour",
          narration:
            "Open the selected tour and review the live price before continuing.",
        },
      ],
    },
    timeline: [
      {
        index: 0,
        label: "Open tour",
        action: "click",
        startedAt: "2026-10-03T00:00:00.200Z",
        finishedAt: "2026-10-03T00:00:01.200Z",
        success: true,
      },
    ],
    startedAt: "2026-10-03T00:00:00.000Z",
    finishedAt: "2026-10-03T00:00:02.000Z",
  };

  const scenes = [{
    sourceStart: 0,
    sourceEnd: 2,
    outputStart: 0,
    outputEnd: 2,
    stepIndexes: [0],
  }];

  const plan = buildCaptionPlan(manifest, scenes, "9:16");
  assert.ok(plan.cues.length >= 2);
  assert.ok(plan.safeZone.marginV >= 90);

  for (let i = 1; i < plan.cues.length; i += 1) {
    assert.ok(plan.cues[i].start > plan.cues[i - 1].end);
  }

  assert.match(captionPlanToSrt(plan), /Open the selected tour/);
});


test("maps Design Brain top/bottom placement to libass coordinates", () => {
  assert.equal(subtitleAlignmentForPlacement("top"), 6);
  assert.equal(subtitleAlignmentForPlacement("bottom"), 2);

  const manifest = {
    scenario: {
      name: "Vertical",
      steps: [{
        action: "click",
        narration: "Readable caption.",
      }],
    },
    timeline: [{
      index: 0,
      label: "click",
      action: "click",
      startedAt: "2026-10-03T00:00:00.100Z",
      finishedAt: "2026-10-03T00:00:00.900Z",
      success: true,
    }],
    startedAt: "2026-10-03T00:00:00.000Z",
    finishedAt: "2026-10-03T00:00:01.200Z",
  };
  const scenes = [{
    sourceStart: 0,
    sourceEnd: 1.2,
    outputStart: 0,
    outputEnd: 1.2,
    stepIndexes: [0],
  }];

  assert.equal(
    buildCaptionPlan(manifest, scenes, "9:16").safeZone.alignment,
    6,
  );
});
