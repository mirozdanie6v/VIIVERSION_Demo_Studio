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

    const landing = await fetch(base + "/");
    assert.equal(landing.status, 200);
    assert.match(
      landing.headers.get("content-type") ?? "",
      /text\/html/,
    );
    assert.match(await landing.text(), /VIIVERSION Demo Studio/);

    const favicon = await fetch(base + "/favicon.svg");
    assert.equal(favicon.status, 200);
    assert.match(
      favicon.headers.get("content-type") ?? "",
      /image\/svg\+xml/,
    );

    const health = await fetch(base + "/health");
    assert.equal(health.status, 200);
    const healthBody = await health.json() as {
      ok: boolean;
      version: string;
      generationMode: string;
      accessMode: string;
    };
    assert.equal(healthBody.ok, true);
    assert.equal(healthBody.version, "0.14.2");
    assert.equal(healthBody.generationMode, "hybrid");
    assert.equal(healthBody.accessMode, "api-key");

    const statusPage = await fetch(
      base + "/jobs/00000000-0000-0000-0000-000000000000",
    );
    assert.equal(statusPage.status, 200);
    assert.match(
      statusPage.headers.get("content-type") ?? "",
      /text\/html/,
    );
    const statusHtml = await statusPage.text();
    assert.match(statusHtml, /Generation progress/);
    assert.match(statusHtml, /Automatic recovery/);

    const openapi = await fetch(base + "/openapi.json");
    assert.equal(openapi.status, 200);
    const spec = await openapi.json() as {
      openapi: string;
      info: { version: string };
    };
    assert.equal(spec.openapi, "3.1.0");
    assert.equal(spec.info.version, "0.14.2");

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
