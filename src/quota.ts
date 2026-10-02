import { createHash } from "node:crypto";

type Usage = {
  day: string;
  count: number;
};

function currentDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export function identityHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export class DailyQuota {
  private readonly usage = new Map<string, Usage>();

  constructor(
    private readonly limit = Number(process.env.DEMO_STUDIO_DAILY_JOB_LIMIT ?? "50"),
  ) {}

  consume(identity: string): { used: number; limit: number; remaining: number } {
    if (!Number.isFinite(this.limit) || this.limit <= 0) {
      return { used: 0, limit: 0, remaining: Number.POSITIVE_INFINITY };
    }

    const key = identityHash(identity);
    const day = currentDay();
    const current = this.usage.get(key);
    const state = current?.day === day ? current : { day, count: 0 };

    if (state.count >= this.limit) {
      throw new Error("Daily demo-generation quota exceeded.");
    }

    state.count += 1;
    this.usage.set(key, state);

    return {
      used: state.count,
      limit: this.limit,
      remaining: Math.max(0, this.limit - state.count),
    };
  }
}
