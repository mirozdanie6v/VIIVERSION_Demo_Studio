export type RequestSecurityHeaders = {
  host?: string;
  origin?: string;
};

function truthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());
}

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function hostnameOnly(value: string): string {
  try {
    return new URL("http://" + value).hostname.toLowerCase();
  } catch {
    return value.split(":")[0].toLowerCase();
  }
}

function allowedApiHosts(): Set<string> {
  const hosts = new Set(csv(process.env.DEMO_STUDIO_ALLOWED_API_HOSTS));
  const publicBase = process.env.PUBLIC_BASE_URL?.trim();

  if (publicBase) {
    try {
      hosts.add(new URL(publicBase).hostname.toLowerCase());
    } catch {
      throw new Error("PUBLIC_BASE_URL must be a valid URL.");
    }
  }

  if (truthy(process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED)) {
    hosts.add("localhost");
    hosts.add("127.0.0.1");
    hosts.add("::1");
  }

  return hosts;
}

function allowedOrigins(): Set<string> {
  const origins = new Set(csv(process.env.DEMO_STUDIO_ALLOWED_ORIGINS));
  const publicBase = process.env.PUBLIC_BASE_URL?.trim();

  if (publicBase) {
    try {
      origins.add(new URL(publicBase).origin.toLowerCase());
    } catch {
      throw new Error("PUBLIC_BASE_URL must be a valid URL.");
    }
  }

  if (truthy(process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED)) {
    origins.add("http://localhost:8787");
    origins.add("http://127.0.0.1:8787");
  }

  return origins;
}

export function assertTrustedHttpRequest(
  headers: RequestSecurityHeaders,
): void {
  const host = headers.host?.trim();
  if (!host) throw new Error("Missing Host header.");

  const allowedHosts = allowedApiHosts();
  if (allowedHosts.size > 0 && !allowedHosts.has(hostnameOnly(host))) {
    throw new Error("Host header is not allowed.");
  }

  const origin = headers.origin?.trim().toLowerCase();
  if (!origin) return;

  const origins = allowedOrigins();
  if (origins.size > 0 && !origins.has(origin)) {
    throw new Error("Origin is not allowed.");
  }
}
