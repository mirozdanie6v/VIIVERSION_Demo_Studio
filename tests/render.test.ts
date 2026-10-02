import assert from "node:assert/strict";
import test from "node:test";
import { buildCaptions, buildNarration } from "../src/render.js";
import { buildScenePlan } from "../src/scenes.js";

const manifest = {
  scenario: {
    name: "Catalog demo",
    steps: [
      { action: "goto", label: "Open app", narration: "Welcome to the product." },
      { action: "click", label: "Open catalog", narration: "Open the catalog." },
    ],
  },
  timeline: [
    {
      index: 0,
      label: "Open app",
      action: "goto",
      startedAt: "2026-10-02T00:00:00.000Z",
      finishedAt: "2026-10-02T00:00:00.500Z",
      success: true,
    },
    {
      index: 1,
      label: "Open catalog",
      action: "click",
      startedAt: "2026-10-02T00:00:01.000Z",
      finishedAt: "2026-10-02T00:00:02.000Z",
      success: true,
    },
  ],
  startedAt: "2026-10-02T00:00:00.000Z",
  finishedAt: "2026-10-02T00:00:02.000Z",
  videoPath: "/tmp/capture.webm",
  success: true,
};

test("builds narration from explicit step narration", () => {
  assert.equal(
    buildNarration(manifest),
    "Welcome to the product. Open the catalog.",
  );
});

test("builds timed SRT captions against edited scenes", () => {
  const scenes = buildScenePlan(manifest);
  const srt = buildCaptions(manifest, scenes);

  assert.match(srt, /00:00:00,000 --> 00:00:01,200/);
  assert.match(srt, /Welcome to the product\./);
  assert.match(srt, /00:00:01,000 --> 00:00:02,000/);
});
