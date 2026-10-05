import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditUxDesign } from "../src/ux-design-brain.js";

process.env.ALLOW_PRIVATE_TARGETS = "true";
process.env.DEMO_STUDIO_UX_CACHE_TTL_MS = "600000";

const url =
  process.argv[2] ??
  "http://127.0.0.1:4173/fixtures/smoke.html";

const firstDir = await mkdtemp(path.join(os.tmpdir(), "demo-ux-cache-a-"));
const secondDir = await mkdtemp(path.join(os.tmpdir(), "demo-ux-cache-b-"));

const first = await auditUxDesign(url, { outputDir: firstDir });
const second = await auditUxDesign(url, { outputDir: secondDir });

assert.equal(first.cacheSource, "fresh");
assert.equal(second.cacheSource, "cache");
assert.deepEqual(second.preflight, first.preflight);
assert.deepEqual(second.profile, first.profile);
assert.deepEqual(second.contract, first.contract);

for (const dir of [firstDir, secondDir]) {
  for (const file of [
    "ux_preflight.json",
    "design_profile.json",
    "design_contract.json",
    "ux_desktop.png",
    "ux_mobile.png",
  ]) {
    const info = await stat(path.join(dir, file));
    assert.ok(info.size > 0, dir + "/" + file + " must be non-empty");
  }
}

console.log(
  JSON.stringify({
    ok: true,
    first: first.cacheSource,
    second: second.cacheSource,
    firstDir,
    secondDir,
  }),
);
