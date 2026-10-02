import assert from "node:assert/strict";
import test from "node:test";
import { DailyQuota } from "../src/quota.js";

test("tracks and enforces a per-identity daily quota", () => {
  const quota = new DailyQuota(2);

  assert.deepEqual(quota.consume("user-a"), {
    used: 1,
    limit: 2,
    remaining: 1,
  });

  assert.deepEqual(quota.consume("user-a"), {
    used: 2,
    limit: 2,
    remaining: 0,
  });

  assert.throws(() => quota.consume("user-a"), /quota exceeded/i);

  assert.deepEqual(quota.consume("user-b"), {
    used: 1,
    limit: 2,
    remaining: 1,
  });
});
