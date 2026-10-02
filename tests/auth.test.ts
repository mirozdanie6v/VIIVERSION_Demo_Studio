import assert from "node:assert/strict";
import test from "node:test";
import { authenticateBearer } from "../src/auth.js";

const originalKey = process.env.DEMO_STUDIO_API_KEY;
const originalDev = process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED;

test("accepts the configured bearer token", { concurrency: false }, () => {
  process.env.DEMO_STUDIO_API_KEY = "secret-token";
  delete process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED;

  try {
    const auth = authenticateBearer("Bearer secret-token");
    assert.equal(auth.authenticated, true);
    assert.equal(auth.identity, "secret-token");
  } finally {
    if (originalKey === undefined) delete process.env.DEMO_STUDIO_API_KEY;
    else process.env.DEMO_STUDIO_API_KEY = originalKey;

    if (originalDev === undefined) delete process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED;
    else process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED = originalDev;
  }
});

test("rejects an invalid bearer token", { concurrency: false }, () => {
  process.env.DEMO_STUDIO_API_KEY = "secret-token";
  delete process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED;

  try {
    assert.throws(
      () => authenticateBearer("Bearer wrong-token"),
      /Invalid or missing bearer token/,
    );
  } finally {
    if (originalKey === undefined) delete process.env.DEMO_STUDIO_API_KEY;
    else process.env.DEMO_STUDIO_API_KEY = originalKey;
  }
});
