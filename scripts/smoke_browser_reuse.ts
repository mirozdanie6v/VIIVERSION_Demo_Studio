import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  browserPoolStats,
  closeSharedBrowser,
  resetBrowserPoolStats,
} from "../src/browser-pool.js";
import { inspectApplication } from "../src/inspector.js";
import { runScenario } from "../src/runner.js";
import type { DemoScenario } from "../src/types.js";
import { auditUxDesign } from "../src/ux-design-brain.js";

process.env.ALLOW_PRIVATE_TARGETS = "true";
process.env.DEMO_STUDIO_REUSE_BROWSER = "true";
process.env.DEMO_STUDIO_UX_CACHE_TTL_MS = "0";

const url =
  process.argv[2] ??
  "http://127.0.0.1:4173/fixtures/smoke.html";
const root = await mkdtemp(
  path.join(os.tmpdir(), "demo-browser-reuse-"),
);

await closeSharedBrowser();
resetBrowserPoolStats();

try {
  await auditUxDesign(url, {
    outputDir: path.join(root, "ux"),
    cache: false,
  });

  await inspectApplication(url);

  const scenario = JSON.parse(
    await readFile("examples/smoke.json", "utf8"),
  ) as DemoScenario;

  await runScenario(scenario, {
    artifactsRoot: path.join(root, "captures"),
  });

  const stats = browserPoolStats();
  assert.equal(stats.sharedLaunches, 1);
  assert.equal(stats.sharedLeases, 3);
  assert.ok(stats.sharedReuses >= 2);
  assert.equal(stats.dedicatedLaunches, 0);

  console.log(JSON.stringify({ ok: true, root, stats }));
} finally {
  await closeSharedBrowser();
}
