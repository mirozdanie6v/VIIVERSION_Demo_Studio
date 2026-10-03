import { DurableObject } from "cloudflare:workers";

const PUBLIC_HOST = "demostudio.viiversion.com";
const CONTAINER_PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;
const ACTIVE_IMAGE_KEY = "active-container-image";
const INTERNAL_TOKEN_KEY = "internal-storage-token";
const GENERATION_DAILY_LIMIT = 10;
const INSPECTION_DAILY_LIMIT = 30;

function staticPage(title, body) {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} · VIIVERSION Demo Studio</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #090b10; color: #f5f7fb; }
    main { max-width: 820px; margin: 0 auto; padding: 72px 28px 96px; }
    a { color: #b7c9ff; }
    h1 { font-size: clamp(38px, 7vw, 72px); line-height: .98; margin: 18px 0 28px; }
    h2 { margin-top: 38px; }
    p, li { color: #c9ced8; line-height: 1.65; }
    .eyebrow { letter-spacing: .16em; text-transform: uppercase; color: #8f98aa; font-size: 12px; }
    .card { margin-top: 34px; padding: 22px 24px; border: 1px solid #282d38; border-radius: 18px; background: #11151d; }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">VIIVERSION · Demo Studio</div>
    ${body}
  </main>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function publicStaticResponse(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  const url = new URL(request.url);

  if (url.pathname === "/") {
    return staticPage(
      "Web app presentation videos",
      `<h1>Turn web apps into polished demo videos.</h1>
<p>VIIVERSION Demo Studio inspects a web interface, records an authorized walkthrough, and renders a presentation-ready MP4 with motion, captions, branding, and multiple aspect ratios.</p>
<div class="card"><strong>MCP endpoint</strong><p><code>https://demostudio.viiversion.com/mcp</code></p></div>
<p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>`,
    );
  }

  if (url.pathname === "/privacy") {
    return staticPage(
      "Privacy Policy",
      `<h1>Privacy Policy</h1>
<p>Effective October 3, 2026.</p>
<h2>What Demo Studio processes</h2>
<p>When you create a demonstration, the service processes the target URL, the demo scenario or goal, relevant interface information collected from the target application, and the browser recording needed to render the requested video.</p>
<h2>Storage and retention</h2>
<p>Working files are created inside the rendering environment while a job runs. Completed job metadata and the final MP4 may be stored in private Cloudflare R2 storage for up to 7 days so the result can be retrieved. The service automatically expires these stored artifacts after the retention period.</p>
<h2>Credentials and sensitive data</h2>
<p>Externally generated scenarios are blocked from referencing server environment variables. Users should avoid placing passwords, private keys, access tokens, payment data, or other sensitive information in demo scenarios. Only applications the user is authorized to access should be inspected or recorded.</p>
<h2>Service providers</h2>
<p>Cloudflare infrastructure is used to run the service and store temporary result artifacts. Optional server-generated AI narration or server-side AI planning may use configured AI providers when those features are enabled.</p>
<h2>Use of data</h2>
<p>VIIVERSION does not sell Demo Studio user data or use submitted demo content for advertising targeting.</p>
<h2>Operational information</h2>
<p>Operational logs may contain request metadata, status codes, performance information, and error messages needed to operate and secure the service.</p>
<h2>Contact</h2>
<p>Questions about this policy can be directed to VIIVERSION through <a href="https://viiversion.com">viiversion.com</a>.</p>`,
    );
  }

  if (url.pathname === "/terms") {
    return staticPage(
      "Terms of Service",
      `<h1>Terms of Service</h1>
<p>Effective October 3, 2026.</p>
<h2>Authorized use</h2>
<p>You may use Demo Studio only with websites and applications you are authorized to inspect, access, and record. You are responsible for the actions included in a demo scenario and for complying with applicable law and third-party terms.</p>
<h2>Consequential actions</h2>
<p>Demo Studio is designed primarily for presentation and test workflows. Avoid real purchases, payments, bookings, destructive changes, account deletion, irreversible submissions, or other consequential actions unless you intentionally configured an authorized test environment for that purpose.</p>
<h2>Service limits</h2>
<p>The service may apply rate limits, daily generation limits, inspection limits, file-retention limits, and other safeguards to protect availability and control abusive or excessive use.</p>
<h2>Generated outputs</h2>
<p>Generated videos are provided as-is. You are responsible for reviewing the output before publishing or distributing it and for ensuring you have rights to the recorded interface, trademarks, images, text, and other material appearing in the video.</p>
<h2>Retention</h2>
<p>Generated artifacts are temporary and may be automatically deleted after 7 days. Keep your own copy of any output you need to retain.</p>
<h2>Changes and availability</h2>
<p>VIIVERSION may update the service, these terms, usage limits, or supported features as the product evolves.</p>
<h2>Contact</h2>
<p>Questions about these terms can be directed to VIIVERSION through <a href="https://viiversion.com">viiversion.com</a>.</p>`,
    );
  }

  return undefined;
}

function bearerToken(request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}


async function quotaIdentity(request) {
  const token = bearerToken(request);
  if (!token) return "anonymous-global";

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );

  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class DemoStudioContainer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.starting = undefined;

    if (ctx.container?.running) {
      void ctx.blockConcurrencyWhile(() =>
        ctx.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS),
      );
    }
  }

  async consumeDailyQuota(request, kind, limit) {
    const identity = await quotaIdentity(request);
    const day = new Date().toISOString().slice(0, 10);
    const key = "quota:" + day + ":" + kind + ":" + identity;

    return this.ctx.storage.transaction(async (txn) => {
      const used = Number((await txn.get(key)) ?? 0);

      if (used >= limit) {
        return { allowed: false, used, limit, remaining: 0 };
      }

      const next = used + 1;
      await txn.put(key, next);

      return {
        allowed: true,
        used: next,
        limit,
        remaining: Math.max(0, limit - next),
      };
    });
  }

  quotaErrorResponse(payload, kind, quota) {
    const message =
      "Daily " + kind + " quota exceeded. Try again after 00:00 UTC.";

    if (payload?.jsonrpc === "2.0") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id ?? null,
          error: {
            code: -32029,
            message,
            data: quota,
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return new Response(
      JSON.stringify({ error: message, quota }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  async enforceEdgeQuota(request, url) {
    if (request.method !== "POST") return undefined;

    if (url.pathname === "/v1/jobs") {
      const quota = await this.consumeDailyQuota(
        request,
        "generation",
        GENERATION_DAILY_LIMIT,
      );
      return quota.allowed
        ? undefined
        : this.quotaErrorResponse(undefined, "generation", quota);
    }

    if (url.pathname !== "/mcp") return undefined;

    let payload;
    try {
      payload = await request.clone().json();
    } catch {
      return undefined;
    }

    if (
      payload?.method !== "tools/call" ||
      typeof payload?.params?.name !== "string"
    ) {
      return undefined;
    }

    const tool = payload.params.name;
    if (
      tool === "create_demo_video" ||
      tool === "create_demo_video_from_scenario"
    ) {
      const quota = await this.consumeDailyQuota(
        request,
        "generation",
        GENERATION_DAILY_LIMIT,
      );
      return quota.allowed
        ? undefined
        : this.quotaErrorResponse(payload, "generation", quota);
    }

    if (tool === "inspect_web_app") {
      const quota = await this.consumeDailyQuota(
        request,
        "inspection",
        INSPECTION_DAILY_LIMIT,
      );
      return quota.allowed
        ? undefined
        : this.quotaErrorResponse(payload, "inspection", quota);
    }

    return undefined;
  }

  async getInternalToken() {
    let token = await this.ctx.storage.get(INTERNAL_TOKEN_KEY);

    if (!token) {
      token = crypto.randomUUID() + "-" + crypto.randomUUID();
      await this.ctx.storage.put(INTERNAL_TOKEN_KEY, token);
    }

    return token;
  }

  isPublicAuthorized(request) {
    const configured = this.env.DEMO_STUDIO_API_KEY;
    if (!configured) return true;
    return bearerToken(request) === configured;
  }

  async handleInternalRequest(request, url) {
    const artifactMatch = url.pathname.match(
      /^\/__internal\/artifacts\/([0-9a-f-]{36})$/i,
    );
    const jobMatch = url.pathname.match(
      /^\/__internal\/jobs\/([0-9a-f-]{36})$/i,
    );

    if (!artifactMatch && !jobMatch) return undefined;

    const expected = await this.getInternalToken();
    if (bearerToken(request) !== expected) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (request.method !== "PUT") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (artifactMatch) {
      await this.env.DEMO_STUDIO_ARTIFACTS.put(
        "artifacts/" + artifactMatch[1] + ".mp4",
        request.body,
        {
          httpMetadata: {
            contentType: "video/mp4",
            cacheControl: "private, max-age=3600",
          },
        },
      );
      return new Response(null, { status: 204 });
    }

    await this.env.DEMO_STUDIO_ARTIFACTS.put(
      "jobs/" + jobMatch[1] + ".json",
      request.body,
      {
        httpMetadata: {
          contentType: "application/json; charset=utf-8",
          cacheControl: "no-store",
        },
      },
    );
    return new Response(null, { status: 204 });
  }

  async handlePersistedRead(request, url) {
    if (request.method !== "GET") return undefined;

    const artifactMatch = url.pathname.match(
      /^\/v1\/jobs\/([0-9a-f-]{36})\/artifact$/i,
    );
    const jobMatch = url.pathname.match(
      /^\/v1\/jobs\/([0-9a-f-]{36})$/i,
    );

    if (!artifactMatch && !jobMatch) return undefined;

    if (!this.isPublicAuthorized(request)) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing bearer token." }),
        {
          status: 401,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        },
      );
    }

    if (artifactMatch) {
      const object = await this.env.DEMO_STUDIO_ARTIFACTS.get(
        "artifacts/" + artifactMatch[1] + ".mp4",
      );

      if (!object) return undefined;

      return new Response(object.body, {
        status: 200,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(object.size),
          "Content-Disposition":
            'attachment; filename="viiversion-demo-' +
            artifactMatch[1] +
            '.mp4"',
          "Cache-Control": "private, max-age=3600",
          ETag: object.httpEtag,
        },
      });
    }

    const object = await this.env.DEMO_STUDIO_ARTIFACTS.get(
      "jobs/" + jobMatch[1] + ".json",
    );

    if (!object) return undefined;

    return new Response(object.body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ETag: object.httpEtag,
      },
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    const internal = await this.handleInternalRequest(request, url);
    if (internal) return internal;

    const persisted = await this.handlePersistedRead(request, url);
    if (persisted) return persisted;

    const quotaResponse = await this.enforceEdgeQuota(request, url);
    if (quotaResponse) return quotaResponse;

    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    url.protocol = "http:";
    url.host = "container";

    const forwarded = new Request(url.toString(), request);
    forwarded.headers.set("x-forwarded-host", PUBLIC_HOST);
    forwarded.headers.set("x-forwarded-proto", "https");

    return this.ctx.container.getTcpPort(CONTAINER_PORT).fetch(forwarded);
  }

  async ensureCurrentImage(container) {
    const desiredImage = container.images.app;
    const activeImage = await this.ctx.storage.get(ACTIVE_IMAGE_KEY);

    if (container.running && activeImage !== desiredImage) {
      await container.destroy(
        "Replacing stale Demo Studio container image",
      );
      await this.ctx.storage.delete(ACTIVE_IMAGE_KEY);
    }

    return desiredImage;
  }

  async startAndWaitForPort() {
    const container = this.ctx.container;
    if (!container) {
      throw new Error("Cloudflare Container binding is unavailable.");
    }

    const desiredImage = await this.ensureCurrentImage(container);

    if (!container.running) {
      const internalToken = await this.getInternalToken();
      const env = {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: String(CONTAINER_PORT),
        PUBLIC_BASE_URL: "https://" + PUBLIC_HOST,
        OPENAI_DIRECTOR_MODEL: "gpt-5.6-luna",
        OPENAI_TTS_MODEL: "gpt-4o-mini-tts",
        OPENAI_TTS_VOICE: "marin",
        DEMO_STUDIO_ALLOWED_API_HOSTS:
          PUBLIC_HOST + ",container,localhost,127.0.0.1",
        DEMO_STUDIO_ALLOWED_ORIGINS: "https://" + PUBLIC_HOST,
        DEMO_STUDIO_MAX_CONCURRENT_JOBS: "1",
        DEMO_STUDIO_DAILY_JOB_LIMIT: "10",
        DEMO_STUDIO_STORAGE_ROOT: "/data/jobs",
        DEMO_STUDIO_INTERNAL_TOKEN: internalToken,
        ALLOW_PRIVATE_TARGETS: "false",
        DEMO_STUDIO_ALLOW_UNAUTHENTICATED: this.env.DEMO_STUDIO_API_KEY
          ? "false"
          : "true",
      };

      if (this.env.OPENAI_API_KEY) {
        env.OPENAI_API_KEY = this.env.OPENAI_API_KEY;
      }

      if (this.env.DEMO_STUDIO_API_KEY) {
        env.DEMO_STUDIO_API_KEY = this.env.DEMO_STUDIO_API_KEY;
      }

      container.start({
        image: desiredImage,
        instance: "standard-1",
        enableInternet: true,
        env,
      });
    }

    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    const port = container.getTcpPort(CONTAINER_PORT);
    let lastError;

    for (let attempt = 0; attempt < 150; attempt += 1) {
      try {
        const response = await port.fetch("http://container/health", {
          signal: AbortSignal.timeout(1500),
        });
        await response.body?.cancel();

        if (response.ok) {
          await this.ctx.storage.put(ACTIVE_IMAGE_KEY, desiredImage);
          return;
        }

        lastError = new Error("Health check returned " + response.status);
      } catch (error) {
        lastError = error;
      }

      await scheduler.wait(200);
    }

    throw new Error("Demo Studio container did not become ready.", {
      cause: lastError,
    });
  }
}

export default {
  fetch(request, env) {
    const staticResponse = publicStaticResponse(request);
    if (staticResponse) return staticResponse;
    return env.DEMO_STUDIO.getByName("primary").fetch(request);
  },
};
