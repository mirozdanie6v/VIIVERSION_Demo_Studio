import assert from "node:assert/strict";
import test from "node:test";
import { assertTrustedHttpRequest } from "../src/http-security.js";

const originalBase = process.env.PUBLIC_BASE_URL;
const originalHosts = process.env.DEMO_STUDIO_ALLOWED_API_HOSTS;
const originalOrigins = process.env.DEMO_STUDIO_ALLOWED_ORIGINS;
const originalDev = process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED;

function restore() {
  if (originalBase === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = originalBase;

  if (originalHosts === undefined) delete process.env.DEMO_STUDIO_ALLOWED_API_HOSTS;
  else process.env.DEMO_STUDIO_ALLOWED_API_HOSTS = originalHosts;

  if (originalOrigins === undefined) delete process.env.DEMO_STUDIO_ALLOWED_ORIGINS;
  else process.env.DEMO_STUDIO_ALLOWED_ORIGINS = originalOrigins;

  if (originalDev === undefined) delete process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED;
  else process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED = originalDev;
}

test("allows the configured public host and origin", { concurrency: false }, () => {
  process.env.PUBLIC_BASE_URL = "https://demo.viiversion.com";
  delete process.env.DEMO_STUDIO_ALLOWED_API_HOSTS;
  delete process.env.DEMO_STUDIO_ALLOWED_ORIGINS;
  delete process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED;

  try {
    assert.doesNotThrow(() =>
      assertTrustedHttpRequest({
        host: "demo.viiversion.com",
        origin: "https://demo.viiversion.com",
      }),
    );
  } finally {
    restore();
  }
});

test("rejects an unexpected host", { concurrency: false }, () => {
  process.env.PUBLIC_BASE_URL = "https://demo.viiversion.com";
  delete process.env.DEMO_STUDIO_ALLOWED_API_HOSTS;
  delete process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED;

  try {
    assert.throws(
      () => assertTrustedHttpRequest({ host: "evil.example" }),
      /Host header is not allowed/,
    );
  } finally {
    restore();
  }
});
