import { lookup } from "node:dns/promises";
import { BlockList } from "node:net";
import type { BrowserContext } from "playwright";

const blocked = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

const safeCache = new Map<string, Promise<void>>();

function boolEnv(name: string): boolean {
  return ["1", "true", "yes", "on"].includes((process.env[name] ?? "").toLowerCase());
}

function allowedHosts(): string[] {
  return (process.env.DEMO_STUDIO_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatchesAllowlist(hostname: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allowed.some((entry) => host === entry || host.endsWith("." + entry));
}

export async function assertSafeHttpUrl(input: string | URL): Promise<URL> {
  const url = input instanceof URL ? input : new URL(input);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http:// and https:// targets are allowed.");
  }

  if (url.username || url.password) {
    throw new Error("Target URLs must not contain embedded credentials.");
  }

  if (boolEnv("ALLOW_PRIVATE_TARGETS")) return url;

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) throw new Error("Target URL must contain a hostname.");

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    !hostMatchesAllowlist(hostname, allowedHosts())
  ) {
    throw new Error("Target host is not allowed.");
  }

  const key = hostname;
  let pending = safeCache.get(key);

  if (!pending) {
    pending = (async () => {
      const records = await lookup(hostname, { all: true, verbatim: true });
      if (records.length === 0) throw new Error("Target host did not resolve.");

      for (const record of records) {
        const type = record.family === 6 ? "ipv6" : "ipv4";
        if (blocked.check(record.address, type)) {
          throw new Error("Target resolves to a private, local, reserved or non-routable address.");
        }
      }
    })();

    safeCache.set(key, pending);
    pending.catch(() => safeCache.delete(key));
  }

  await pending;
  return url;
}

export async function attachNetworkGuard(context: BrowserContext): Promise<void> {
  await context.route("**/*", async (route) => {
    const raw = route.request().url();

    try {
      const url = new URL(raw);
      if (["data:", "blob:", "about:"].includes(url.protocol)) {
        await route.continue();
        return;
      }

      await assertSafeHttpUrl(url);
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
}
