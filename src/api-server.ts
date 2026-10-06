import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  authenticateBearer,
  authenticationMode,
  oauthChallenge,
  protectedResourceMetadata,
} from "./auth.js";
import { assertTrustedHttpRequest } from "./http-security.js";
import { FAVICON_SVG, LANDING_PAGE } from "./landing.js";
import type { DemoJobRecovery, DemoJobRequest } from "./job-manager.js";
import { buildJobStatusPage } from "./job-status-page.js";
import { createDemoStudioMcpHandler } from "./mcp-server.js";
import { buildOpenApiDocument } from "./openapi.js";
import { identityHash } from "./quota.js";
import { DemoStudioService } from "./service.js";
import { DEMO_STUDIO_VERSION, demoStudioAccessMode, demoStudioGenerationMode } from "./version.js";

const MAX_JSON_BYTES = 64 * 1024;

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body).toString(),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(body);
}

function sendText(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text).toString(),
    "Cache-Control": "no-store",
  });
  response.end(text);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > MAX_JSON_BYTES) {
      throw new Error("Request body is too large.");
    }

    chunks.push(buffer);
  }

  const source = Buffer.concat(chunks).toString("utf8");
  if (!source.trim()) throw new Error("JSON request body is required.");
  return JSON.parse(source) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(field + " must be a string up to " + maxLength + " characters.");
  }
  return value;
}

function parseJobRequest(value: unknown): DemoJobRequest {
  if (!isRecord(value)) throw new Error("Request body must be a JSON object.");

  if (typeof value.url !== "string" || !value.url.trim()) {
    throw new Error("url is required.");
  }

  if (
    typeof value.goal !== "string" ||
    !value.goal.trim() ||
    value.goal.length > 2000
  ) {
    throw new Error("goal is required and must be at most 2000 characters.");
  }

  const preset = value.preset;
  if (
    preset !== undefined &&
    !["16:9", "9:16", "1:1"].includes(String(preset))
  ) {
    throw new Error("preset must be 16:9, 9:16 or 1:1.");
  }

  for (const field of ["captions", "voiceover"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "boolean") {
      throw new Error(field + " must be boolean.");
    }
  }

  return {
    url: value.url.trim(),
    goal: value.goal.trim(),
    preset: preset as DemoJobRequest["preset"],
    captions: value.captions as boolean | undefined,
    voiceover: value.voiceover as boolean | undefined,
    voice: optionalString(value.voice, "voice", 80),
    brand: optionalString(value.brand, "brand", 120),
    cta: optionalString(value.cta, "cta", 180),
  };
}

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("quota exceeded")) return 429;
  if (
    message.includes("bearer token") ||
    message.includes("OAuth access token") ||
    message.includes("required scope") ||
    message.includes("Invalid or missing")
  ) {
    return 401;
  }
  if (
    message.includes("Authentication is not configured") ||
    message.includes("OAuth is enabled but")
  ) return 503;
  if (message.includes("Host header") || message.includes("Origin is not allowed")) return 403;
  return 400;
}

function requestPath(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://localhost").pathname;
}

function matchJobPath(pathname: string):
  | { id: string; artifact: boolean }
  | undefined {
  const match = pathname.match(
    /^\/v1\/jobs\/([0-9a-f-]{36})(\/artifact)?$/i,
  );
  if (!match) return undefined;
  return { id: match[1], artifact: Boolean(match[2]) };
}

function matchStatusPage(pathname: string): string | undefined {
  return pathname.match(/^\/jobs\/([0-9a-f-]{36})$/i)?.[1];
}

function matchInternalRetry(pathname: string): string | undefined {
  return pathname.match(
    /^\/__internal\/retry\/([0-9a-f-]{36})$/i,
  )?.[1];
}

function internalAuthorized(request: IncomingMessage): boolean {
  const expected = process.env.DEMO_STUDIO_INTERNAL_TOKEN?.trim();
  if (!expected) return false;
  const header = request.headers.authorization ?? "";
  return header === "Bearer " + expected;
}

function internalAuthCheckAuthorized(request: IncomingMessage): boolean {
  const expected = process.env.DEMO_STUDIO_INTERNAL_TOKEN?.trim();
  if (!expected) return false;
  return request.headers["x-demo-studio-internal-token"] === expected;
}

export function createDemoStudioHttpServer(
  service = new DemoStudioService(),
) {
  const mcpHandler = createDemoStudioMcpHandler(service);
  const mcpNode = toNodeHandler(mcpHandler, {
    onerror(error) {
      console.error("[mcp]", error);
    },
  });

  return createServer(async (request, response) => {
    try {
      assertTrustedHttpRequest({
        host: request.headers.host,
        origin:
          typeof request.headers.origin === "string"
            ? request.headers.origin
            : undefined,
      });

      const pathname = requestPath(request);

      if (request.method === "GET" && pathname === "/") {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=300",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(LANDING_PAGE);
        return;
      }

      if (
        request.method === "GET" &&
        pathname === "/.well-known/oauth-protected-resource"
      ) {
        sendJson(response, 200, protectedResourceMetadata());
        return;
      }

      if (request.method === "GET" && pathname === "/favicon.svg") {
        response.writeHead(200, {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "public, max-age=86400",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(FAVICON_SVG);
        return;
      }

      const statusPageJobId = matchStatusPage(pathname);
      if (request.method === "GET" && statusPageJobId) {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(buildJobStatusPage(statusPageJobId));
        return;
      }

      if (
        request.method === "GET" &&
        pathname === "/__internal/auth-check"
      ) {
        if (!internalAuthCheckAuthorized(request)) {
          sendJson(response, 401, { error: "Unauthorized internal request." });
          return;
        }

        const requiredScopes = String(
          request.headers["x-demo-studio-required-scopes"] ?? "",
        )
          .split(/[\s,]+/)
          .map((value) => value.trim())
          .filter(Boolean);
        const auth = await authenticateBearer(
          request.headers.authorization,
          requiredScopes,
        );
        sendJson(response, 200, {
          identityHash: identityHash(auth.identity),
          mode: auth.mode,
          scopes: auth.scopes,
        });
        return;
      }

      const retryJobId = matchInternalRetry(pathname);
      if (request.method === "POST" && retryJobId) {
        if (!internalAuthorized(request)) {
          sendJson(response, 401, { error: "Unauthorized internal request." });
          return;
        }

        const payload = await readJson(request);
        if (!isRecord(payload) || !isRecord(payload.recovery)) {
          throw new Error("Internal retry payload is invalid.");
        }

        const reason =
          typeof payload.reason === "string"
            ? payload.reason
            : "Cloud watchdog requested recovery.";
        const resumed = await service.resumeJob(
          retryJobId,
          payload.recovery as unknown as DemoJobRecovery,
          reason,
        );
        sendJson(response, 202, resumed);
        return;
      }

      if (request.method === "GET" && pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          service: "viiversion-demo-studio",
          version: DEMO_STUDIO_VERSION,
          generationMode: demoStudioGenerationMode(),
          accessMode: demoStudioAccessMode(),
        });
        return;
      }

      if (request.method === "GET" && pathname === "/openapi.json") {
        sendJson(response, 200, buildOpenApiDocument());
        return;
      }

      if (pathname === "/mcp") {
        await mcpNode(request, response);
        return;
      }

      if (request.method === "POST" && pathname === "/v1/jobs") {
        const auth = await authenticateBearer(
          request.headers.authorization,
          ["demo.generate"],
        );
        const input = parseJobRequest(await readJson(request));
        const created = await service.createJob(input, auth.identity);

        sendJson(response, 202, {
          job: created.job,
          quota: created.quota,
          status_url: "/v1/jobs/" + created.job.id,
          status_page_url: "/jobs/" + created.job.id,
        });
        return;
      }

      const jobPath = matchJobPath(pathname);
      if (request.method === "GET" && jobPath && !jobPath.artifact) {
        const auth = await authenticateBearer(
          request.headers.authorization,
          ["demo.read"],
        );
        const job = service.getJob(jobPath.id, auth.identity);
        if (!job) {
          sendJson(response, 404, { error: "Demo job not found." });
          return;
        }

        sendJson(response, 200, {
          ...job,
          artifact_url: job.artifactReady
            ? "/v1/jobs/" + job.id + "/artifact"
            : undefined,
        });
        return;
      }

      if (request.method === "GET" && jobPath?.artifact) {
        const auth = await authenticateBearer(
          request.headers.authorization,
          ["demo.read"],
        );
        const internal = service.jobs.getInternal(jobPath.id);
        if (
          !internal?.artifactPath ||
          internal.status !== "completed" ||
          internal.ownerIdentity !== auth.identity
        ) {
          sendJson(response, 404, { error: "Artifact is not ready." });
          return;
        }

        const info = await stat(internal.artifactPath);
        response.writeHead(200, {
          "Content-Type": "video/mp4",
          "Content-Length": info.size.toString(),
          "Content-Disposition":
            'attachment; filename="viiversion-demo-' + internal.id + '.mp4"',
          "Cache-Control": "private, max-age=3600",
        });

        createReadStream(internal.artifactPath).pipe(response);
        return;
      }

      sendText(response, 404, "Not found.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = errorStatus(error);
      const headers: Record<string, string> = {};
      if (status === 401 && authenticationMode() === "oauth") {
        headers["WWW-Authenticate"] = oauthChallenge([], {
          error: /scope/i.test(message)
            ? "insufficient_scope"
            : "invalid_token",
          description: message,
        });
      }
      sendJson(response, status, { error: message }, headers);
    }
  });
}

export async function listenDemoStudio(): Promise<void> {
  const port = Number(process.env.PORT ?? "8787");
  const host = process.env.HOST ?? "0.0.0.0";
  const service = new DemoStudioService();
  const server = createDemoStudioHttpServer(service);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  console.log(
    "VIIVERSION Demo Studio listening on http://" + host + ":" + port,
  );
}
