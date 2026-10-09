import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaptions,
  buildMainVideoFilters,
  buildNarration,
  resolveRenderEncoderPreset,
} from "../src/render.js";
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

function toMs(value: string): number {
  const [clock, millis] = value.split(",");
  const [hours, minutes, seconds] = clock.split(":").map(Number);
  return (((hours * 60 + minutes) * 60 + seconds) * 1000) + Number(millis);
}

test("builds narration from explicit step narration", () => {
  assert.equal(
    buildNarration(manifest),
    "Welcome to the product. Open the catalog.",
  );
});

test("builds sequential SRT captions against edited scenes", () => {
  const scenes = buildScenePlan(manifest);
  const srt = buildCaptions(manifest, scenes);

  assert.match(srt, /Welcome to the product\./);
  assert.match(srt, /Open the catalog\./);

  const ranges = [...srt.matchAll(
    /(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/g,
  )].map((match) => ({
    start: toMs(match[1]),
    end: toMs(match[2]),
  }));

  assert.equal(ranges.length, 2);
  assert.ok(ranges[0].end < ranges[1].start);
});


test("render encoder preset defaults to measured veryfast and allows rollback overrides", () => {
  assert.equal(resolveRenderEncoderPreset(undefined, {}), "veryfast");
  assert.equal(
    resolveRenderEncoderPreset(undefined, { DEMO_STUDIO_FFMPEG_PRESET: "veryfast" }),
    "veryfast",
  );
  assert.equal(
    resolveRenderEncoderPreset(undefined, { DEMO_STUDIO_FFMPEG_PRESET: "invalid" }),
    "veryfast",
  );
  assert.equal(
    resolveRenderEncoderPreset("faster", { DEMO_STUDIO_FFMPEG_PRESET: "veryfast" }),
    "faster",
  );
});

test("vertical golden video fills 1080x1920 without shrinking the UI into a padded inset", () => {
  const filters = buildMainVideoFilters(1080, 1920, []);
  const output = filters.join(";");
  assert.match(output, /scale=1080:1920:force_original_aspect_ratio=increase/);
  assert.match(output, /crop=1080:1920:\(iw-ow\)\/2:\(ih-oh\)\/2/);
  assert.doesNotMatch(output, /pad=1080:1920|scale=900:1480/);
});

test("landscape presentation retains its existing aspect-preserving framing", () => {
  const filters = buildMainVideoFilters(1920, 1080, []);
  const output = filters.join(";");
  assert.match(output, /scale=1920:1080:force_original_aspect_ratio=decrease/);
  assert.match(output, /pad=1920:1080/);
});
