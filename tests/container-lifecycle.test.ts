import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_CONTAINER_INACTIVITY_MS,
  IDLE_CONTAINER_INACTIVITY_MS,
  edgeHealthPayload,
  inactivityTimeoutForActiveJobCount,
  isTerminalJobStatus,
} from "../cloudflare/container-lifecycle.js";

test("inactive Demo Studio stops after ten minutes", () => {
  assert.equal(inactivityTimeoutForActiveJobCount(0), 10 * 60 * 1000);
  assert.equal(IDLE_CONTAINER_INACTIVITY_MS, 10 * 60 * 1000);
});

test("tracked active jobs retain original one-hour safety window", () => {
  assert.equal(inactivityTimeoutForActiveJobCount(1), 60 * 60 * 1000);
  assert.equal(inactivityTimeoutForActiveJobCount(3), 60 * 60 * 1000);
  assert.equal(ACTIVE_CONTAINER_INACTIVITY_MS, 60 * 60 * 1000);
});

test("only completed and failed jobs are terminal", () => {
  for (const state of ["queued", "rendering", "capturing", "retrying", "unknown"]) {
    assert.equal(isTerminalJobStatus(state), false);
  }
  assert.equal(isTerminalJobStatus("completed"), true);
  assert.equal(isTerminalJobStatus("failed"), true);
});

test("edge health reports readiness scope without claiming to inspect container", () => {
  const healthy = edgeHealthPayload({
    version: "0.14.2",
    productionHybrid: "false",
    apiKeyPresent: true,
  });
  assert.deepEqual(healthy, {
    ok: true,
    service: "viiversion-demo-studio",
    version: "0.14.2",
    generationMode: "standard",
    accessMode: "authenticated",
    healthScope: "edge",
    containerChecked: false,
  });
  const anonymous = edgeHealthPayload({
    version: "0.14.2",
    apiKeyPresent: false,
  });
  assert.equal(anonymous.generationMode, "hybrid");
  assert.equal(anonymous.accessMode, "anonymous");
});
