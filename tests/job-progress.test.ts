import assert from "node:assert/strict";
import test from "node:test";
import {
  toPublicDemoJob,
  type DemoJob,
} from "../src/job-manager.js";
import { buildJobStatusPage } from "../src/job-status-page.js";

test("public job exposes stage, attempts, heartbeat and stalled state", () => {
  const now = Date.now();
  const createdAt = new Date(now - 180_000).toISOString();
  const stageStartedAt = new Date(now - 120_000).toISOString();
  const heartbeatAt = new Date(now - 15_000).toISOString();

  const job: DemoJob = {
    id: "00000000-0000-0000-0000-000000000001",
    ownerIdentity: "oauth:https://issuer.example:user-123",
    statusToken: "status-token-for-test-000000000001",
    status: "capturing",
    stage: "capture",
    stageLabel: "Browser capture",
    progress: 42,
    message: "Executing customer journey.",
    request: {
      url: "https://example.com",
      scenario: {
        name: "Test",
        steps: [{ action: "goto", url: "/" }],
      },
    },
    createdAt,
    updatedAt: heartbeatAt,
    heartbeatAt,
    stageStartedAt,
    stageTimeoutSeconds: 60,
    attempt: 2,
    maxAttempts: 3,
    retryReason: "Previous capture timed out.",
    history: [{
      at: stageStartedAt,
      status: "capturing",
      stage: "capture",
      progress: 30,
      message: "Capture started.",
      attempt: 2,
    }],
  };

  const publicJob = toPublicDemoJob(job);

  assert.equal(publicJob.stage, "capture");
  assert.equal(publicJob.attempt, 2);
  assert.equal(publicJob.maxAttempts, 3);
  assert.equal(publicJob.stalled, true);
  assert.ok(publicJob.stageElapsedSeconds >= 119);
  assert.ok(publicJob.heartbeatAgeSeconds >= 14);
  assert.equal(publicJob.history.length, 1);
});

test("status page contains live progress and retry UI", () => {
  const html = buildJobStatusPage(
    "00000000-0000-0000-0000-000000000001",
  );

  assert.match(html, /Generation progress/);
  assert.match(html, /Automatic recovery/);
  assert.match(html, /v1\/jobs/);
  assert.match(html, /status_token/);
  assert.match(html, /Return to ChatGPT to open the final MP4/);
  assert.match(html, /setTimeout\(poll,\s*2000\)/);
});
