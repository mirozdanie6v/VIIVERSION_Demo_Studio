import { DurableObject } from "cloudflare:workers";

const PUBLIC_HOST = "demostudio.viiversion.com";
const CONTAINER_PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;
const ACTIVE_IMAGE_KEY = "active-container-image";
const INTERNAL_TOKEN_KEY = "internal-storage-token";

function bearerToken(request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
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
    return env.DEMO_STUDIO.getByName("primary").fetch(request);
  },
};
