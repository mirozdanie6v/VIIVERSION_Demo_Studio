import { timingSafeEqual } from "node:crypto";

export type AuthResult = {
  identity: string;
  authenticated: boolean;
};

function truthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function authenticateBearer(header: string | undefined): AuthResult {
  const configured = process.env.DEMO_STUDIO_API_KEY;

  if (!configured) {
    if (truthy(process.env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED)) {
      return { identity: "development", authenticated: false };
    }

    throw new Error(
      "DEMO_STUDIO_API_KEY is not configured. Set it or explicitly enable DEMO_STUDIO_ALLOW_UNAUTHENTICATED for development.",
    );
  }

  const match = header?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  if (!token || !secureEqual(token, configured)) {
    throw new Error("Invalid or missing bearer token.");
  }

  return { identity: token, authenticated: true };
}
