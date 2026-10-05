import assert from "node:assert/strict";
import test from "node:test";
import { browserReuseEnabled } from "../src/browser-pool.js";

test("browser reuse is enabled by default", () => {
  assert.equal(browserReuseEnabled({}), true);
  assert.equal(
    browserReuseEnabled({ DEMO_STUDIO_REUSE_BROWSER: "true" }),
    true,
  );
});

test("browser reuse has an immediate runtime fallback", () => {
  for (const value of ["0", "false", "off", "no"]) {
    assert.equal(
      browserReuseEnabled({ DEMO_STUDIO_REUSE_BROWSER: value }),
      false,
    );
  }
});
