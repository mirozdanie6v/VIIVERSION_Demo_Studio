import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeHttpUrl } from "../src/security.js";

test("rejects non-http protocols", async () => {
  await assert.rejects(() => assertSafeHttpUrl("ftp://example.com"), /Only http/);
});

test("rejects embedded target credentials", async () => {
  await assert.rejects(
    () => assertSafeHttpUrl("https://user:secret@example.com"),
    /embedded credentials/,
  );
});

test("rejects localhost by default", async () => {
  const original = process.env.ALLOW_PRIVATE_TARGETS;
  delete process.env.ALLOW_PRIVATE_TARGETS;

  try {
    await assert.rejects(
      () => assertSafeHttpUrl("http://localhost:3000"),
      /not allowed/,
    );
  } finally {
    if (original === undefined) delete process.env.ALLOW_PRIVATE_TARGETS;
    else process.env.ALLOW_PRIVATE_TARGETS = original;
  }
});
