import assert from "node:assert/strict";
import test from "node:test";
import { recoveryCandidates } from "../src/targets.js";

test("role target falls back to relaxed role and text", () => {
  const candidates = recoveryCandidates({
    by: "role",
    value: "button",
    name: "Open catalog",
    exact: true,
  });

  assert.deepEqual(candidates[0], {
    by: "role",
    value: "button",
    name: "Open catalog",
    exact: false,
  });
  assert.ok(
    candidates.some(
      (target) =>
        typeof target !== "string" &&
        target.by === "text" &&
        target.value === "Open catalog",
    ),
  );
});

test("test id target gets both common attribute fallbacks", () => {
  const candidates = recoveryCandidates({ by: "testId", value: "catalog" });
  assert.deepEqual(candidates, [
    { by: "css", value: '[data-testid="catalog"]' },
    { by: "css", value: '[data-test-id="catalog"]' },
  ]);
});
