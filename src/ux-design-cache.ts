export type CacheSource = "fresh" | "cache" | "inflight";

export type CacheResult<T> = {
  value: T;
  source: CacheSource;
};

const DEFAULT_UX_CACHE_TTL_MS = 600_000;
const MAX_UX_CACHE_TTL_MS = 3_600_000;

export function uxCacheTtlMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.DEMO_STUDIO_UX_CACHE_TTL_MS;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_UX_CACHE_TTL_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_UX_CACHE_TTL_MS;
  }

  return Math.min(MAX_UX_CACHE_TTL_MS, Math.floor(parsed));
}

export class ExpiringPromiseCache<T> {
  private readonly values = new Map<
    string,
    { expiresAt: number; value: T }
  >();
  private readonly inflight = new Map<string, Promise<T>>();

  async getOrCreate(
    key: string,
    ttlMs: number,
    create: () => Promise<T>,
    shouldCache: (value: T) => boolean = () => true,
  ): Promise<CacheResult<T>> {
    const now = Date.now();
    const existing = this.values.get(key);

    if (ttlMs > 0 && existing && existing.expiresAt > now) {
      return { value: existing.value, source: "cache" };
    }

    if (existing) this.values.delete(key);

    const current = this.inflight.get(key);
    if (current) {
      return { value: await current, source: "inflight" };
    }

    const task = create();
    this.inflight.set(key, task);

    try {
      const value = await task;
      if (ttlMs > 0 && shouldCache(value)) {
        this.values.set(key, {
          value,
          expiresAt: Date.now() + ttlMs,
        });
      }
      return { value, source: "fresh" };
    } finally {
      if (this.inflight.get(key) === task) {
        this.inflight.delete(key);
      }
    }
  }

  clear(): void {
    this.values.clear();
    this.inflight.clear();
  }
}
