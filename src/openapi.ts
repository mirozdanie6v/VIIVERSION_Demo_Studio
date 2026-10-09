import { DEMO_STUDIO_VERSION } from "./version.js";

export function buildOpenApiDocument(baseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:8787") {
  const issuer = process.env.DEMO_STUDIO_OAUTH_ISSUER?.replace(/\/$/, "");
  const oauthEnabled = Boolean(issuer);
  const oauthScopes = {
    "demo.inspect": "Inspect authorized web applications",
    "demo.generate": "Create Demo Studio video jobs",
    "demo.read": "Read the current user's Demo Studio jobs and artifacts",
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "VIIVERSION Demo Studio API",
      version: DEMO_STUDIO_VERSION,
      description:
        "Generate polished presentation videos from web applications using AI-directed browser automation.",
    },
    servers: [{ url: baseUrl.replace(/\/$/, "") }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
        ...(oauthEnabled
          ? {
              oauth2: {
                type: "oauth2",
                flows: {
                  authorizationCode: {
                    authorizationUrl:
                      process.env.DEMO_STUDIO_OAUTH_AUTHORIZATION_URL ??
                      issuer + "/authorize",
                    tokenUrl:
                      process.env.DEMO_STUDIO_OAUTH_TOKEN_URL ??
                      issuer + "/oauth/token",
                    scopes: oauthScopes,
                  },
                },
              },
            }
          : {}),
      },
      schemas: {
        CreateDemoJob: {
          type: "object",
          additionalProperties: false,
          required: ["url", "goal"],
          properties: {
            url: { type: "string", format: "uri" },
            goal: { type: "string", minLength: 1, maxLength: 2000 },
            preset: { type: "string", enum: ["16:9", "9:16", "1:1"], default: "16:9" },
            captions: { type: "boolean", default: true },
            voiceover: { type: "boolean", default: false },
            voice: { type: "string", maxLength: 80 },
            brand: { type: "string", maxLength: 120 },
            cta: { type: "string", maxLength: 180 },
          },
        },
        DemoJob: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            status: {
              type: "string",
              enum: [
                "queued",
                "preflighting",
                "directing",
                "capturing",
                "voicing",
                "rendering",
                "persisting",
                "retrying",
                "completed",
                "failed",
              ],
            },
            stage: {
              type: "string",
              enum: [
                "queued",
                "preflight",
                "director",
                "capture",
                "voiceover",
                "render",
                "persist",
                "retry_wait",
                "complete",
                "failed",
              ],
            },
            stageLabel: { type: "string" },
            progress: { type: "integer", minimum: 0, maximum: 100 },
            message: { type: "string" },
            attempt: { type: "integer", minimum: 1 },
            maxAttempts: { type: "integer", minimum: 1 },
            heartbeatAt: { type: "string", format: "date-time" },
            stageStartedAt: { type: "string", format: "date-time" },
            stageTimeoutSeconds: { type: "integer", minimum: 1 },
            stageElapsedSeconds: { type: "integer", minimum: 0 },
            heartbeatAgeSeconds: { type: "integer", minimum: 0 },
            stalled: { type: "boolean" },
            retryReason: { type: "string" },
            history: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  at: { type: "string", format: "date-time" },
                  status: { type: "string" },
                  stage: { type: "string" },
                  progress: { type: "integer", minimum: 0, maximum: 100 },
                  message: { type: "string" },
                  attempt: { type: "integer", minimum: 1 },
                },
              },
            },
            artifactReady: { type: "boolean" },
            error: { type: "string" },
          },
        },
      },
    },
    security: oauthEnabled
      ? [{ oauth2: ["demo.read"] }]
      : [{ bearerAuth: [] }],
    paths: {
      "/health": {
        get: {
          security: [],
          operationId: "health",
          summary: "Service health",
          responses: {
            "200": {
              description: "Healthy",
            },
          },
        },
      },
      "/v1/jobs": {
        post: {
          operationId: "createDemoVideo",
          summary: "Start generation of a web application presentation video",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateDemoJob" },
              },
            },
          },
          responses: {
            "202": {
              description: "Job accepted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      job: { $ref: "#/components/schemas/DemoJob" },
                      status_url: { type: "string" },
                      status_page_url: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": { description: "Invalid request" },
            "401": { description: "Unauthorized" },
            "429": { description: "Quota exceeded" },
          },
        },
      },
      "/jobs/{jobId}": {
        get: {
          security: [],
          operationId: "viewDemoJobProgress",
          summary: "Open the live client-facing generation progress page",
          parameters: [
            {
              name: "jobId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": {
              description: "HTML progress page",
              content: { "text/html": {} },
            },
          },
        },
      },
      "/v1/jobs/{jobId}": {
        get: {
          operationId: "getDemoJob",
          summary: "Get demo generation status",
          parameters: [
            {
              name: "jobId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": {
              description: "Current job status",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/DemoJob" },
                },
              },
            },
            "404": { description: "Job not found" },
          },
        },
      },
      "/v1/jobs/{jobId}/artifact": {
        get: {
          operationId: "downloadDemoVideo",
          summary: "Download the completed MP4",
          parameters: [
            {
              name: "jobId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": {
              description: "Final MP4 video",
              content: {
                "video/mp4": {},
              },
            },
            "404": { description: "Artifact is not ready" },
          },
        },
      },
    },
  };
}
