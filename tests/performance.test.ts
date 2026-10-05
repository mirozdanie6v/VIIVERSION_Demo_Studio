import assert from "node:assert/strict";
import test from "node:test";
import {
  navigationSettleTimeoutMs,
  settleAfterNavigation,
} from "../src/performance.js";

test("navigation settle defaults to a short bounded window", () => {
  assert.equal(navigationSettleTimeoutMs({}), 1500);
  assert.equal(
    navigationSettleTimeoutMs({ DEMO_STUDIO_NAVIGATION_SETTLE_MS: "2400" }),
    2400,
  );
  assert.equal(
    navigationSettleTimeoutMs({ DEMO_STUDIO_NAVIGATION_SETTLE_MS: "9000" }),
    5000,
  );
});

test("navigation settle accepts zero and rejects invalid values", () => {
  assert.equal(
    navigationSettleTimeoutMs({ DEMO_STUDIO_NAVIGATION_SETTLE_MS: "0" }),
    0,
  );
  assert.equal(
    navigationSettleTimeoutMs({ DEMO_STUDIO_NAVIGATION_SETTLE_MS: "-1" }),
    1500,
  );
  assert.equal(
    navigationSettleTimeoutMs({ DEMO_STUDIO_NAVIGATION_SETTLE_MS: "abc" }),
    1500,
  );
});

test("settleAfterNavigation never turns network-idle timeout into a capture failure", async () => {
  const calls: Array<{ state: string; timeout: number }> = [];
  await settleAfterNavigation(
    {
      async waitForLoadState(state, options) {
        calls.push({ state, timeout: options.timeout });
        throw new Error("network never became idle");
      },
    },
    1250,
  );

  assert.deepEqual(calls, [{ state: "networkidle", timeout: 1250 }]);
});

test("settleAfterNavigation can be disabled explicitly", async () => {
  let called = false;
  await settleAfterNavigation(
    {
      async waitForLoadState() {
        called = true;
      },
    },
    0,
  );

  assert.equal(called, false);
});
