import { DurableObject } from "cloudflare:workers";

const PUBLIC_HOST = "demostudio.viiversion.com";
const RELEASE = "0.9.1";
const CONTAINER_PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_ARTIFACT_BYTES = 250 * 1024 * 1024;

function artifactKey(jobId) {
  return "jobs/" + jobId + "/final.mp4";
}

function jobIdFromPath(pathname, suffix = "") {
  const prefix = "/v1/jobs/";
  if (!pathname.startsWith(prefix)) return undefined;
  if (suffix && !pathname.endsWith(suffix)) return undefined;

  const end = suffix ? pathname.length - suffix.length : pathname.length;
  const id = pathname.slice(prefix.length, end);
  return /^[0-9a-f-]{36}$/i.test(id) ? id : undefined;
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

  async fetch(request) {
    const url = new URL(request.url);
    const direct = await this.handleDurableRequest(request, url);
    if (direct) return direct;

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

  async handleDurableRequest(request, url) {
    if (
      request.method === "PUT" &&
      url.pathname.startsWith("/internal/artifacts/")
    ) {
      const jobId = url.pathname.slice("/internal/artifacts/".length);
      if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
        return Response.json(
          { error: "Invalid artifact job id." },
          { status: 400 },
        );
      }

      const token = await this.artifactUploadToken();
      if (request.headers.get("authorization") !== "Bearer " + token) {
        return Response.json({ error: "Unauthorized." }, { status: 401 });
      }

      const declaredSize = Number(
        request.headers.get("content-length") ?? "0",
      );
      if (declaredSize > MAX_ARTIFACT_BYTES) {
        return Response.json(
          { error: "Artifact is too large." },
          { status: 413 },
        );
      }

      if (!request.body) {
        return Response.json(
          { error: "Artifact body is required." },
          { status: 400 },
        );
      }

      await this.env.ARTIFACTS.put(artifactKey(jobId), request.body, {
        httpMetadata: {
          contentType: "video/mp4",
          contentDisposition:
            'attachment; filename="viiversion-demo-' + jobId + '.mp4"',
        },
        customMetadata: {
          jobId,
          release: RELEASE,
          storedAt: new Date().toISOString(),
        },
      });

      return Response.json({ ok: true, jobId });
    }

    const artifactId = jobIdFromPath(url.pathname, "/artifact");
    if (request.method === "GET" && artifactId) {
      const object = await this.env.ARTIFACTS.get(artifactKey(artifactId));
      if (object) {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);
        headers.set("cache-control", "private, max-age=3600");
        headers.set("x-demo-studio-storage", "r2");
        return new Response(object.body, { headers });
      }
    }

    const statusId = jobIdFromPath(url.pathname);
    if (request.method === "GET" && statusId) {
      const stored = await this.env.ARTIFACTS.head(artifactKey(statusId));
      if (stored) {
        return Response.json({
          id: statusId,
          status: "completed",
          progress: 100,
          message: "Presentation video is ready.",
          artifactReady: true,
          artifact_url:
            "https://" +
            PUBLIC_HOST +
            "/v1/jobs/" +
            statusId +
            "/artifact",
          persisted: true,
        });
      }
    }

    return undefined;
  }

  async artifactUploadToken() {
    let token = await this.ctx.storage.get("artifactUploadToken");
    if (!token) {
      token = crypto.randomUUID() + crypto.randomUUID();
      await this.ctx.storage.put("artifactUploadToken", token);
    }
    return token;
  }

  async ensureCurrentContainer(container) {
    const desiredImage = container.images.app;
    const storedRelease = await this.ctx.storage.get("containerRelease");
    const info = await container.inspect();

    const imageMismatch =
      Boolean(info?.image) && info.image !== desiredImage;
    const releaseMismatch = storedRelease !== RELEASE;

    if (container.running && (imageMismatch || releaseMismatch)) {
      await container.destroy(
        "Demo Studio release upgrade from " +
          String(storedRelease ?? "unknown") +
          " to " +
          RELEASE,
      );
    }

    if (!container.running) {
      const artifactToken = await this.artifactUploadToken();
      const env = {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: String(CONTAINER_PORT),
        PUBLIC_BASE_URL: "https://" + PUBLIC_HOST,
        DEMO_STUDIO_RELEASE: RELEASE,
        OPENAI_DIRECTOR_MODEL: "gpt-5.6-luna",
        OPENAI_TTS_MODEL: "gpt-4o-mini-tts",
        OPENAI_TTS_VOICE: "marin",
        DEMO_STUDIO_ALLOWED_API_HOSTS:
          PUBLIC_HOST + ",container,localhost,127.0.0.1",
        DEMO_STUDIO_ALLOWED_ORIGINS:
          "https://" + PUBLIC_HOST,
        DEMO_STUDIO_MAX_CONCURRENT_JOBS: "1",
        DEMO_STUDIO_DAILY_JOB_LIMIT: "10",
        DEMO_STUDIO_STORAGE_ROOT: "/data/jobs",
        DEMO_STUDIO_ARTIFACT_UPLOAD_URL:
          "https://" + PUBLIC_HOST + "/internal/artifacts",
        DEMO_STUDIO_ARTIFACT_UPLOAD_TOKEN: artifactToken,
        ALLOW_PRIVATE_TARGETS: "false",
        DEMO_STUDIO_ALLOW_UNAUTHENTICATED:
          this.env.DEMO_STUDIO_API_KEY ? "false" : "true",
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

      await this.ctx.storage.put("containerRelease", RELEASE);
    }
  }

  async startAndWaitForPort() {
    const container = this.ctx.container;
    if (!container) {
      throw new Error("Cloudflare Container binding is unavailable.");
    }

    await this.ensureCurrentContainer(container);
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    const port = container.getTcpPort(CONTAINER_PORT);
    let lastError;

    for (let attempt = 0; attempt < 150; attempt += 1) {
      try {
        const response = await port.fetch("http://container/health", {
          signal: AbortSignal.timeout(1500),
        });

        if (response.ok) {
          const health = await response.json().catch(() => undefined);
          if (health?.version === RELEASE) return;
          lastError = new Error(
            "Container release mismatch: expected " +
              RELEASE +
              ", got " +
              String(health?.version ?? "unknown"),
          );
        } else {
          await response.body?.cancel();
          lastError = new Error(
            "Health check returned " + response.status,
          );
        }
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
