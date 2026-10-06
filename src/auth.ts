import {
  createHash,
  createPublicKey,
  createVerify,
  timingSafeEqual,
} from "node:crypto";

export type AuthMode = "oauth" | "api-key" | "development";

export type AuthProfile = {
  id: string;
  name?: string;
  email?: string;
  nickname?: string;
};

export type AuthResult = {
  identity: string;
  authenticated: boolean;
  mode: AuthMode;
  subject?: string;
  scopes: string[];
  bearerToken?: string;
  profile: AuthProfile;
};

type JwtHeader = {
  alg?: unknown;
  kid?: unknown;
  typ?: unknown;
};

type JwtClaims = {
  iss?: unknown;
  sub?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  scope?: unknown;
  scp?: unknown;
  name?: unknown;
  email?: unknown;
  nickname?: unknown;
};

type JsonWebKeySet = {
  keys?: Array<Record<string, unknown>>;
};

type CachedJwks = {
  expiresAt: number;
  keys: Array<Record<string, unknown>>;
};

const jwksCache = new Map<string, CachedJwks>();
const JWKS_TTL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 30;

function truthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function envValue(
  env: NodeJS.ProcessEnv,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function publicResource(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    envValue(env, "DEMO_STUDIO_OAUTH_AUDIENCE") ??
    envValue(env, "PUBLIC_BASE_URL") ??
    "https://demostudio.viiversion.com"
  ).replace(/\/$/, "");
}

export function oauthIssuer(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return envValue(env, "DEMO_STUDIO_OAUTH_ISSUER")?.replace(/\/$/, "");
}

export function oauthScopes(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = envValue(env, "DEMO_STUDIO_OAUTH_SCOPES");
  const values = configured
    ? configured.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean)
    : ["demo.inspect", "demo.generate", "demo.read"];
  return [...new Set(values)];
}

export function authenticationMode(
  env: NodeJS.ProcessEnv = process.env,
): AuthMode | "anonymous" {
  if (oauthIssuer(env)) return "oauth";
  if (envValue(env, "DEMO_STUDIO_API_KEY")) return "api-key";
  if (truthy(env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED)) return "development";
  return "anonymous";
}

export function protectedResourceMetadata(
  env: NodeJS.ProcessEnv = process.env,
) {
  const resource = publicResource(env);
  const issuer = oauthIssuer(env);
  if (!issuer) {
    throw new Error(
      "DEMO_STUDIO_OAUTH_ISSUER is required for public OAuth metadata.",
    );
  }

  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: oauthScopes(env),
    resource_documentation: resource + "/support",
    resource_policy_uri: resource + "/privacy",
    resource_tos_uri: resource + "/terms",
  };
}

export function oauthChallenge(
  requiredScopes: string[] = [],
  options: {
    error?: string;
    description?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): string {
  const env = options.env ?? process.env;
  const resource = publicResource(env);
  const scopes = requiredScopes.length ? requiredScopes : oauthScopes(env);
  const parts = [
    `Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource"`,
  ];
  if (scopes.length) {
    parts.push(`scope="${scopes.join(" ")}"`);
  }
  parts.push(`error="${options.error ?? "invalid_token"}"`);
  parts.push(
    `error_description="${(options.description ?? "Authentication required.").replace(/"/g, "'")}"`,
  );
  return parts.join(", ");
}

function decodeJson<T>(part: string, label: string): T {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
  } catch {
    throw new Error("Invalid OAuth access token " + label + ".");
  }
}

function parseScopes(claims: JwtClaims): string[] {
  const values: string[] = [];

  if (typeof claims.scope === "string") {
    values.push(...claims.scope.split(/\s+/).filter(Boolean));
  }
  if (typeof claims.scp === "string") {
    values.push(...claims.scp.split(/\s+/).filter(Boolean));
  }
  if (Array.isArray(claims.scp)) {
    for (const value of claims.scp) {
      if (typeof value === "string" && value.trim()) values.push(value.trim());
    }
  }

  return [...new Set(values)];
}

function audienceMatches(
  claim: unknown,
  expected: string,
): boolean {
  if (typeof claim === "string") return claim === expected;
  if (Array.isArray(claim)) {
    return claim.some((value) => typeof value === "string" && value === expected);
  }
  return false;
}

async function fetchJwks(
  uri: string,
): Promise<Array<Record<string, unknown>>> {
  const now = Date.now();
  const cached = jwksCache.get(uri);
  if (cached && cached.expiresAt > now) return cached.keys;

  const response = await fetch(uri, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(
      "OAuth JWKS endpoint returned HTTP " + response.status + ".",
    );
  }

  const payload = (await response.json()) as JsonWebKeySet;
  const keys = Array.isArray(payload.keys) ? payload.keys : [];
  if (!keys.length) throw new Error("OAuth JWKS endpoint returned no keys.");

  jwksCache.set(uri, {
    expiresAt: now + JWKS_TTL_MS,
    keys,
  });
  return keys;
}

async function verifyOAuthToken(
  token: string,
  requiredScopes: string[],
  env: NodeJS.ProcessEnv,
): Promise<AuthResult> {
  const issuer = oauthIssuer(env);
  const jwksUri = envValue(env, "DEMO_STUDIO_OAUTH_JWKS_URI");
  const audience = publicResource(env);

  if (!issuer || !jwksUri) {
    throw new Error(
      "OAuth is enabled but DEMO_STUDIO_OAUTH_ISSUER or DEMO_STUDIO_OAUTH_JWKS_URI is missing.",
    );
  }

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid OAuth access token.");

  const header = decodeJson<JwtHeader>(parts[0], "header");
  const claims = decodeJson<JwtClaims>(parts[1], "claims");
  if (header.alg !== "RS256") {
    throw new Error("OAuth access token must use RS256.");
  }
  if (typeof header.kid !== "string" || !header.kid) {
    throw new Error("OAuth access token is missing kid.");
  }

  const keys = await fetchJwks(jwksUri);
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("OAuth signing key was not found.");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(parts[0] + "." + parts[1]);
  verifier.end();
  const key = createPublicKey({ key: jwk as never, format: "jwk" });
  const valid = verifier.verify(key, Buffer.from(parts[2], "base64url"));
  if (!valid) throw new Error("OAuth access token signature is invalid.");

  if (claims.iss !== issuer) {
    throw new Error("OAuth access token issuer is invalid.");
  }
  if (!audienceMatches(claims.aud, audience)) {
    throw new Error("OAuth access token audience is invalid.");
  }
  if (typeof claims.sub !== "string" || !claims.sub.trim()) {
    throw new Error("OAuth access token subject is missing.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    typeof claims.exp !== "number" ||
    claims.exp < now - CLOCK_SKEW_SECONDS
  ) {
    throw new Error("OAuth access token is expired.");
  }
  if (
    typeof claims.nbf === "number" &&
    claims.nbf > now + CLOCK_SKEW_SECONDS
  ) {
    throw new Error("OAuth access token is not active yet.");
  }

  const scopes = parseScopes(claims);
  const missing = requiredScopes.filter((scope) => !scopes.includes(scope));
  if (missing.length) {
    throw new Error(
      "OAuth access token is missing required scope: " + missing.join(", "),
    );
  }

  const subject = claims.sub.trim();
  const identity = "oauth:" + issuer + ":" + subject;
  const profileId = createHash("sha256")
    .update(identity)
    .digest("hex")
    .slice(0, 24);

  return {
    identity,
    authenticated: true,
    mode: "oauth",
    subject,
    scopes,
    bearerToken: token,
    profile: {
      id: "prf_" + profileId,
      ...(typeof claims.name === "string" ? { name: claims.name } : {}),
      ...(typeof claims.email === "string" ? { email: claims.email } : {}),
      ...(typeof claims.nickname === "string"
        ? { nickname: claims.nickname }
        : {}),
    },
  };
}

export async function authenticateBearer(
  header: string | undefined,
  requiredScopes: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): Promise<AuthResult> {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  if (oauthIssuer(env)) {
    if (!token) throw new Error("Invalid or missing OAuth bearer token.");
    return verifyOAuthToken(token, requiredScopes, env);
  }

  const configured = envValue(env, "DEMO_STUDIO_API_KEY");
  if (configured) {
    if (!token || !secureEqual(token, configured)) {
      throw new Error("Invalid or missing bearer token.");
    }
    const id = createHash("sha256").update(token).digest("hex").slice(0, 24);
    return {
      identity: "api-key:" + id,
      authenticated: true,
      mode: "api-key",
      scopes: [],
      bearerToken: token,
      profile: { id: "prf_" + id },
    };
  }

  if (truthy(env.DEMO_STUDIO_ALLOW_UNAUTHENTICATED)) {
    return {
      identity: "development",
      authenticated: false,
      mode: "development",
      scopes: [],
      profile: { id: "development" },
    };
  }

  throw new Error(
    "Authentication is not configured. Set OAuth, DEMO_STUDIO_API_KEY, or explicitly enable DEMO_STUDIO_ALLOW_UNAUTHENTICATED for development.",
  );
}

export function clearAuthCachesForTests(): void {
  jwksCache.clear();
}
