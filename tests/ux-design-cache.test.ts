import assert from "node:assert/strict";
import test from "node:test";
import {
  ExpiringPromiseCache,
  uxCacheTtlMs,
} from "../src/ux-design-cache.js";

test("UX cache TTL defaults to ten minutes and is bounded", () => {
  assert.equal(uxCacheTtlMs({}), 600_000);
  assert.equal(
    uxCacheTtlMs({ DEMO_STUDIO_UX_CACHE_TTL_MS: "120000" }),
    120_000,
  );
  assert.equal(
    uxCacheTtlMs({ DEMO_STUDIO_UX_CACHE_TTL_MS: "7200000" }),
    3_600_000,
  );
});

test("UX cache can be disabled with a zero TTL", () => {
  assert.equal(
    uxCacheTtlMs({ DEMO_STUDIO_UX_CACHE_TTL_MS: "0" }),
    0,
  );
  assert.equal(
    uxCacheTtlMs({ DEMO_STUDIO_UX_CACHE_TTL_MS: "-10" }),
    600_000,
  );
});

test("completed value is reused while valid", async () => {
  const cache = new ExpiringPromiseCache<number>();
  let calls = 0;

  const first = await cache.getOrCreate("a", 60_000, async () => ++calls);
  const second = await cache.getOrCreate("a", 60_000, async () => ++calls);

  assert.deepEqual(first, { value: 1, source: "fresh" });
  assert.deepEqual(second, { value: 1, source: "cache" });
  assert.equal(calls, 1);
});

test("concurrent callers share the same in-flight work", async () => {
  const cache = new ExpiringPromiseCache<number>();
  let release!: (value: number) => void;
  let calls = 0;
  const pending = new Promise<number>((resolve) => {
    release = resolve;
  });

  const first = cache.getOrCreate("a", 60_000, async () => {
    calls += 1;
    return pending;
  });
  const second = cache.getOrCreate("a", 60_000, async () => {
    calls += 1;
    return 99;
  });

  await Promise.resolve();
  assert.equal(calls, 1);
  release(7);

  assert.deepEqual(await first, { value: 7, source: "fresh" });
  assert.deepEqual(await second, { value: 7, source: "inflight" });
});

test("non-cacheable results are shared in-flight but not stored", async () => {
  const cache = new ExpiringPromiseCache<number>();
  let calls = 0;

  const first = await cache.getOrCreate(
    "a",
    60_000,
    async () => ++calls,
    () => false,
  );
  const second = await cache.getOrCreate(
    "a",
    60_000,
    async () => ++calls,
    () => false,
  );

  assert.equal(first.source, "fresh");
  assert.equal(second.source, "fresh");
  assert.equal(calls, 2);
});


test("cache evicts oldest completed values beyond its memory bound", async () => {
  const cache = new ExpiringPromiseCache<number>(2);
  let calls = 0;

  await cache.getOrCreate("a", 60_000, async () => ++calls);
  await cache.getOrCreate("b", 60_000, async () => ++calls);
  await cache.getOrCreate("c", 60_000, async () => ++calls);

  const a = await cache.getOrCreate("a", 60_000, async () => ++calls);
  const c = await cache.getOrCreate("c", 60_000, async () => ++calls);

  assert.equal(a.source, "fresh");
  assert.equal(c.source, "cache");
  assert.equal(calls, 4);
});
