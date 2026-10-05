import { chromium, type Browser } from "playwright";

export type BrowserLeaseSource =
  | "shared-new"
  | "shared-reused"
  | "dedicated";

export type BrowserLease = {
  browser: Browser;
  source: BrowserLeaseSource;
  release: () => Promise<void>;
};

type BrowserPoolStats = {
  sharedLaunches: number;
  sharedLeases: number;
  sharedReuses: number;
  dedicatedLaunches: number;
};

let sharedBrowser: Browser | undefined;
let sharedLaunch: Promise<Browser> | undefined;

const stats: BrowserPoolStats = {
  sharedLaunches: 0,
  sharedLeases: 0,
  sharedReuses: 0,
  dedicatedLaunches: 0,
};

export function browserReuseEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.DEMO_STUDIO_REUSE_BROWSER?.trim().toLowerCase();
  return ["1", "true", "on", "yes"].includes(raw ?? "");
}

async function getSharedBrowser(): Promise<{
  browser: Browser;
  source: "shared-new" | "shared-reused";
}> {
  if (sharedBrowser?.isConnected()) {
    stats.sharedLeases += 1;
    stats.sharedReuses += 1;
    return { browser: sharedBrowser, source: "shared-reused" };
  }

  if (sharedLaunch) {
    const browser = await sharedLaunch;
    stats.sharedLeases += 1;
    stats.sharedReuses += 1;
    return { browser, source: "shared-reused" };
  }

  const launch = chromium.launch({ headless: true });
  sharedLaunch = launch;

  try {
    const browser = await launch;
    sharedBrowser = browser;
    stats.sharedLaunches += 1;
    stats.sharedLeases += 1;

    browser.on("disconnected", () => {
      if (sharedBrowser === browser) {
        sharedBrowser = undefined;
      }
    });

    return { browser, source: "shared-new" };
  } finally {
    if (sharedLaunch === launch) {
      sharedLaunch = undefined;
    }
  }
}

export async function acquireBrowser(
  options: {
    headless: boolean;
    env?: NodeJS.ProcessEnv;
  },
): Promise<BrowserLease> {
  const useShared =
    options.headless &&
    browserReuseEnabled(options.env ?? process.env);

  if (!useShared) {
    const browser = await chromium.launch({
      headless: options.headless,
    });
    stats.dedicatedLaunches += 1;

    let released = false;
    return {
      browser,
      source: "dedicated",
      release: async () => {
        if (released) return;
        released = true;
        await browser.close().catch(() => undefined);
      },
    };
  }

  const shared = await getSharedBrowser();
  return {
    browser: shared.browser,
    source: shared.source,
    release: async () => undefined,
  };
}

export function browserPoolStats(): BrowserPoolStats {
  return { ...stats };
}

export function resetBrowserPoolStats(): void {
  stats.sharedLaunches = 0;
  stats.sharedLeases = 0;
  stats.sharedReuses = 0;
  stats.dedicatedLaunches = 0;
}

export async function closeSharedBrowser(): Promise<void> {
  const active = sharedBrowser;
  sharedBrowser = undefined;

  if (active?.isConnected()) {
    await active.close().catch(() => undefined);
  }

  const pending = sharedLaunch;
  sharedLaunch = undefined;
  if (pending) {
    try {
      const browser = await pending;
      if (browser !== active && browser.isConnected()) {
        await browser.close().catch(() => undefined);
      }
    } catch {
      // Failed launch has nothing to close.
    }
  }
}
