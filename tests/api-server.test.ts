import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createDemoStudioHttpServer } from "../src/api-server.js";

const original = {
  base: process.env.PUBLIC_BASE_URL,
  apiKey: process.env.DEMO_STUDIO_API_KEY,
  allowDev: process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED,
};

function restore() {
  if (original.base === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = original.base;

  if (original.apiKey === undefined) delete process.env.DEMO_STUDIO_API_KEY;
  else process.env.DEMO_STUDIO_API_KEY = original.apiKey;

  if (original.allowDev === undefined) delete process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED;
  else process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED = original.allowDev;
}

test("serves health, OpenAPI and authenticated job status", { concurrency: false }, async () => {
  process.env.PUBLIC_BASE_URL = "http://127.0.0.1:8787";
  process.env.DEMO_STUDIO_API_KEY = "api-test-token";
  delete process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED;

  const server = createDemoStudioHttpServer();

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const port = (server.address() as AddressInfo).port;
    const base = "http://127.0.0.1:" + port;

    const health = await fetch(base + "/health");
    assert.equal(health.status, 200);
    assert.equal((await health.json() as { ok: boolean }).ok, true);

    const openapi = await fetch(base + "/openapi.json");
    assert.equal(openapi.status, 200);
    const spec = await openapi.json() as { openapi: string };
    assert.equal(spec.openapi, "3.1.0");

    const missingAuth = await fetch(
      base + "/v1/jobs/00000000-0000-0000-0000-000000000000",
    );
    assert.equal(missingAuth.status, 401);

    const unknown = await fetch(
      base + "/v1/jobs/00000000-0000-0000-0000-000000000000",
      { headers: { Authorization: "Bearer api-test-token" } },
    );
    assert.equal(unknown.status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    restore();
  }
});
