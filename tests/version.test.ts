import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEMO_STUDIO_VERSION,
  demoStudioGenerationMode,
} from "../src/version.js";

function json(path: URL): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

test("package and plugin versions stay aligned", () => {
  const pkg = json(new URL("../package.json", import.meta.url));
  const plugin = json(new URL("../plugin/plugin.json", import.meta.url));

  assert.equal(DEMO_STUDIO_VERSION, "0.14.2");
  assert.equal(pkg.version, DEMO_STUDIO_VERSION);
  assert.equal(plugin.version, DEMO_STUDIO_VERSION);
});

test("production generation mode has an explicit rollback", () => {
  const previous = process.env.DEMO_STUDIO_PRODUCTION_HYBRID;

  try {
    delete process.env.DEMO_STUDIO_PRODUCTION_HYBRID;
    assert.equal(demoStudioGenerationMode(), "hybrid");

    process.env.DEMO_STUDIO_PRODUCTION_HYBRID = "false";
    assert.equal(demoStudioGenerationMode(), "standard");

    process.env.DEMO_STUDIO_PRODUCTION_HYBRID = "true";
    assert.equal(demoStudioGenerationMode(), "hybrid");
  } finally {
    if (previous === undefined) {
      delete process.env.DEMO_STUDIO_PRODUCTION_HYBRID;
    } else {
      process.env.DEMO_STUDIO_PRODUCTION_HYBRID = previous;
    }
  }
});
