import assert from "node:assert/strict";
import {
  createSign,
  generateKeyPairSync,
} from "node:crypto";
import test from "node:test";
import {
  authenticateBearer,
  clearAuthCachesForTests,
  protectedResourceMetadata,
} from "../src/auth.js";

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signJwt(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  claims: Record<string, unknown>,
): string {
  const header = { alg: "RS256", typ: "JWT", kid: "test-key" };
  const input = base64url(header) + "." + base64url(claims);
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  return input + "." + signer.sign(privateKey).toString("base64url");
}

test("accepts configured API-key bearer in beta mode", async () => {
  const auth = await authenticateBearer(
    "Bearer secret-token",
    [],
    { DEMO_STUDIO_API_KEY: "secret-token" },
  );

  assert.equal(auth.authenticated, true);
  assert.equal(auth.mode, "api-key");
  assert.match(auth.identity, /^api-key:/);
  assert.equal(auth.bearerToken, "secret-token");
});

test("rejects invalid API-key bearer", async () => {
  await assert.rejects(
    authenticateBearer(
      "Bearer wrong-token",
      [],
      { DEMO_STUDIO_API_KEY: "secret-token" },
    ),
    /Invalid or missing bearer token/,
  );
});

test("verifies OAuth JWT and preserves stable identity across refresh", async () => {
  clearAuthCachesForTests();
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const issuer = "https://issuer.example";
  const audience = "https://demostudio.viiversion.com";
  const env = {
    DEMO_STUDIO_OAUTH_ISSUER: issuer,
    DEMO_STUDIO_OAUTH_JWKS_URI: "https://issuer.example/.well-known/jwks.json",
    DEMO_STUDIO_OAUTH_AUDIENCE: audience,
  };
  const now = Math.floor(Date.now() / 1000);

  try {
    const first = signJwt(privateKey, {
      iss: issuer,
      sub: "user-123",
      aud: audience,
      exp: now + 300,
      scope: "demo.inspect demo.generate demo.read",
      jti: "token-a",
      email: "user@example.com",
    });
    const refreshed = signJwt(privateKey, {
      iss: issuer,
      sub: "user-123",
      aud: audience,
      exp: now + 600,
      scope: "demo.inspect demo.generate demo.read",
      jti: "token-b",
      email: "new-label@example.com",
    });

    const a = await authenticateBearer(
      "Bearer " + first,
      ["demo.generate"],
      env,
    );
    const b = await authenticateBearer(
      "Bearer " + refreshed,
      ["demo.generate"],
      env,
    );

    assert.equal(a.mode, "oauth");
    assert.equal(a.identity, b.identity);
    assert.equal(a.profile.id, b.profile.id);
    assert.equal(a.subject, "user-123");
    assert.equal(a.bearerToken, first);
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthCachesForTests();
  }
});

test("OAuth verifier rejects wrong audience and missing scope", async () => {
  clearAuthCachesForTests();
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  jwk.kid = "test-key";
  jwk.alg = "RS256";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });

  const issuer = "https://issuer.example";
  const audience = "https://demostudio.viiversion.com";
  const env = {
    DEMO_STUDIO_OAUTH_ISSUER: issuer,
    DEMO_STUDIO_OAUTH_JWKS_URI: "https://issuer.example/jwks",
    DEMO_STUDIO_OAUTH_AUDIENCE: audience,
  };
  const now = Math.floor(Date.now() / 1000);

  try {
    const wrongAudience = signJwt(privateKey, {
      iss: issuer,
      sub: "user-123",
      aud: "https://other.example",
      exp: now + 300,
      scope: "demo.read",
    });
    await assert.rejects(
      authenticateBearer("Bearer " + wrongAudience, ["demo.read"], env),
      /audience is invalid/,
    );

    const missingScope = signJwt(privateKey, {
      iss: issuer,
      sub: "user-123",
      aud: audience,
      exp: now + 300,
      scope: "demo.read",
    });
    await assert.rejects(
      authenticateBearer(
        "Bearer " + missingScope,
        ["demo.generate"],
        env,
      ),
      /missing required scope/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthCachesForTests();
  }
});

test("protected resource metadata binds OAuth to the canonical resource", () => {
  const metadata = protectedResourceMetadata({
    PUBLIC_BASE_URL: "https://demostudio.viiversion.com",
    DEMO_STUDIO_OAUTH_ISSUER: "https://issuer.example/",
  });

  assert.equal(metadata.resource, "https://demostudio.viiversion.com");
  assert.deepEqual(metadata.authorization_servers, ["https://issuer.example"]);
  assert.deepEqual(metadata.scopes_supported, [
    "demo.inspect",
    "demo.generate",
    "demo.read",
  ]);
});
