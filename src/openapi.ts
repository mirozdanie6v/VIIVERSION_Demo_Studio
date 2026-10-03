export function buildOpenApiDocument(baseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:8787") {
  return {
    openapi: "3.1.0",
    info: {
      title: "VIIVERSION Demo Studio API",
      version: "0.12.0",
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
              enum: ["queued", "directing", "capturing", "rendering", "completed", "failed"],
            },
            progress: { type: "integer", minimum: 0, maximum: 100 },
            message: { type: "string" },
            artifactReady: { type: "boolean" },
            error: { type: "string" },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
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
