import assert from "node:assert/strict";
import test from "node:test";
import { browserReuseEnabled } from "../src/browser-pool.js";

test("browser reuse is opt-in for long-lived server processes", () => {
  assert.equal(browserReuseEnabled({}), false);
  for (const value of ["1", "true", "on", "yes"]) {
    assert.equal(
      browserReuseEnabled({ DEMO_STUDIO_REUSE_BROWSER: value }),
      true,
    );
  }
});

test("browser reuse has an immediate runtime fallback", () => {
  for (const value of ["0", "false", "off", "no", ""]) {
    assert.equal(
      browserReuseEnabled({ DEMO_STUDIO_REUSE_BROWSER: value }),
      false,
    );
  }
});
