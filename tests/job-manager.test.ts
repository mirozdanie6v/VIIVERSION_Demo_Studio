import assert from "node:assert/strict";
import test from "node:test";
import { toPublicDemoJob, type DemoJob } from "../src/job-manager.js";

test("public job metadata does not expose the source request or local paths", () => {
  const job: DemoJob = {
    id: "00000000-0000-0000-0000-000000000001",
    status: "completed",
    progress: 100,
    message: "Presentation video is ready.",
    request: {
      url: "https://example.com",
      goal: "Sensitive demo goal",
      scenario: {
        name: "Private scenario",
        steps: [{ action: "wait", ms: 10 }],
      },
    },
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:01:00.000Z",
    completedAt: "2026-10-03T00:01:00.000Z",
    scenarioPath: "/tmp/scenario.json",
    storyboardPath: "/tmp/storyboard.md",
    runDir: "/tmp/run",
    artifactPath: "/tmp/final.mp4",
  };

  const publicJob = toPublicDemoJob(job);

  assert.equal(publicJob.artifactReady, true);
  assert.equal("request" in publicJob, false);
  assert.equal("artifactPath" in publicJob, false);
  assert.equal("scenarioPath" in publicJob, false);
  assert.equal("runDir" in publicJob, false);
});
