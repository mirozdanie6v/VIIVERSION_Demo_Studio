import assert from "node:assert/strict";
import test from "node:test";
import { evaluateJobWatchdog } from "../cloudflare/watchdog-policy.js";

const now = Date.parse("2026-10-04T12:00:00.000Z");

test("watchdog waits while a stage is still inside its timeout", () => {
  const result = evaluateJobWatchdog({
    status: "capturing",
    stageStartedAt: "2026-10-04T11:59:30.000Z",
    stageTimeoutSeconds: 120,
    attempt: 1,
    maxAttempts: 3,
  }, now, 15_000);

  assert.equal(result.action, "wait");
});

test("watchdog restarts a stalled job when attempts remain", () => {
  const result = evaluateJobWatchdog({
    status: "rendering",
    stageStartedAt: "2026-10-04T11:50:00.000Z",
    stageTimeoutSeconds: 120,
    attempt: 1,
    maxAttempts: 3,
  }, now, 15_000);

  assert.equal(result.action, "restart");
  assert.equal(result.nextAttempt, 2);
});

test("watchdog fails explicitly after recovery limit", () => {
  const result = evaluateJobWatchdog({
    status: "rendering",
    stageStartedAt: "2026-10-04T11:50:00.000Z",
    stageTimeoutSeconds: 120,
    attempt: 3,
    maxAttempts: 3,
  }, now, 15_000);

  assert.equal(result.action, "fail");
  assert.equal(result.reason, "recovery-limit");
});

test("watchdog ignores terminal jobs", () => {
  const result = evaluateJobWatchdog({
    status: "completed",
    stageStartedAt: "2026-10-04T11:00:00.000Z",
    stageTimeoutSeconds: 30,
    attempt: 1,
    maxAttempts: 3,
  }, now, 15_000);

  assert.equal(result.action, "ignore");
});
