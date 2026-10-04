export function evaluateJobWatchdog(
  snapshot,
  nowMs = Date.now(),
  graceMs = 15_000,
) {
  if (
    snapshot?.status === "completed" ||
    snapshot?.status === "failed"
  ) {
    return { action: "ignore", reason: "terminal" };
  }

  const stageStarted = Date.parse(
    snapshot?.stageStartedAt ??
      snapshot?.updatedAt ??
      snapshot?.createdAt ??
      "",
  );
  const timeoutMs =
    Math.max(30, Number(snapshot?.stageTimeoutSeconds ?? 300)) * 1000;

  if (
    Number.isFinite(stageStarted) &&
    nowMs - stageStarted <= timeoutMs + graceMs
  ) {
    return { action: "wait", reason: "within-timeout" };
  }

  const attempt = Math.max(1, Number(snapshot?.attempt ?? 1));
  const maxAttempts = Math.max(
    attempt,
    Number(snapshot?.maxAttempts ?? 3),
  );

  if (attempt >= maxAttempts) {
    return {
      action: "fail",
      reason: "recovery-limit",
      attempt,
      maxAttempts,
    };
  }

  return {
    action: "restart",
    reason: "stage-timeout",
    attempt,
    maxAttempts,
    nextAttempt: attempt + 1,
  };
}
