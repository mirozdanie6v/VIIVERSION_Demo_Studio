export const NARRATION_END_BREATHING_ROOM_SECONDS = 0.25;
export const MAX_AUTOMATIC_NARRATION_TAIL_HOLD_SECONDS = 12;

export function resolveNarrationTailHoldSeconds(
  finalNarrationEndSeconds: number,
  editorContentDurationSeconds: number,
  maxAutomaticHoldSeconds = MAX_AUTOMATIC_NARRATION_TAIL_HOLD_SECONDS,
): number {
  if (
    !Number.isFinite(finalNarrationEndSeconds) ||
    finalNarrationEndSeconds < 0 ||
    !Number.isFinite(editorContentDurationSeconds) ||
    editorContentDurationSeconds < 0
  ) {
    throw new Error("Narration timing values must be finite non-negative seconds.");
  }

  const requiredHold = Math.max(
    0,
    finalNarrationEndSeconds +
      NARRATION_END_BREATHING_ROOM_SECONDS -
      editorContentDurationSeconds,
  );

  if (requiredHold > maxAutomaticHoldSeconds + 1e-6) {
    throw new Error(
      `Narration requires ${requiredHold.toFixed(2)}s of additional visual hold, exceeding the ${maxAutomaticHoldSeconds.toFixed(2)}s automatic limit. Shorten narration or increase scenario visual holds.`,
    );
  }

  return Number(requiredHold.toFixed(3));
}
