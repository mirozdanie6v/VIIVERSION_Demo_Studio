import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_AUTOMATIC_NARRATION_TAIL_HOLD_SECONDS,
  NARRATION_END_BREATHING_ROOM_SECONDS,
  resolveNarrationTailHoldSeconds,
} from "../src/narration-timing.js";

test("narration timing adds no hold when the editor timeline has enough breathing room", () => {
  assert.equal(resolveNarrationTailHoldSeconds(98, 100), 0);
});

test("narration timing extends the final visual state through premium voice completion", () => {
  assert.equal(
    resolveNarrationTailHoldSeconds(104.85, 98.13),
    Number((104.85 + NARRATION_END_BREATHING_ROOM_SECONDS - 98.13).toFixed(3)),
  );
});

test("narration timing keeps automatic recovery bounded", () => {
  assert.throws(
    () =>
      resolveNarrationTailHoldSeconds(
        100 + MAX_AUTOMATIC_NARRATION_TAIL_HOLD_SECONDS + 1,
        100,
      ),
    /automatic limit/,
  );
});
