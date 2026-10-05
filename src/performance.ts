export type NetworkIdlePage = {
  waitForLoadState(
    state: "networkidle",
    options: { timeout: number },
  ): Promise<unknown>;
};

const DEFAULT_NAVIGATION_SETTLE_MS = 1_500;
const MAX_NAVIGATION_SETTLE_MS = 5_000;

export function navigationSettleTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.DEMO_STUDIO_NAVIGATION_SETTLE_MS;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_NAVIGATION_SETTLE_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_NAVIGATION_SETTLE_MS;
  }

  return Math.min(MAX_NAVIGATION_SETTLE_MS, Math.floor(parsed));
}

export async function settleAfterNavigation(
  page: NetworkIdlePage,
  timeoutMs = navigationSettleTimeoutMs(),
): Promise<void> {
  if (timeoutMs <= 0) return;

  await page
    .waitForLoadState("networkidle", { timeout: timeoutMs })
    .catch(() => undefined);
}
