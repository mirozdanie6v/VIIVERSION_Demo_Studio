import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenApiDocument } from "../src/openapi.js";

test("publishes REST endpoints for jobs and artifacts", () => {
  const document = buildOpenApiDocument("https://demo.viiversion.com");

  assert.equal(document.openapi, "3.1.0");
  assert.equal(document.servers[0].url, "https://demo.viiversion.com");
  assert.ok(document.paths["/v1/jobs"]);
  assert.ok(document.paths["/v1/jobs/{jobId}"]);
  assert.ok(document.paths["/v1/jobs/{jobId}/artifact"]);
});
