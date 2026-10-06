import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  authenticateBearer,
  authenticationMode,
  oauthChallenge,
  type AuthResult,
} from "./auth.js";
import { DemoStudioService } from "./service.js";
import { DEMO_STUDIO_VERSION } from "./version.js";

const SCOPE_INSPECT = "demo.inspect";
const SCOPE_GENERATE = "demo.generate";
const SCOPE_READ = "demo.read";

function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");
}

function securedTool<T extends object>(
  config: T,
  scope: string,
  meta?: Record<string, unknown>,
): T {
  return Object.assign(
    {},
    config,
    {
      securitySchemes: [{ type: "oauth2", scopes: [scope] }],
    },
    meta ? { _meta: meta } : {},
  ) as T;
}

function authErrorResult(error: unknown, scopes: string[]) {
  const message = error instanceof Error ? error.message : String(error);
  const output: Record<string, unknown> = {
    content: [{ type: "text", text: message }],
    isError: true,
  };

  if (authenticationMode() === "oauth") {
    output._meta = {
      "mcp/www_authenticate": [
        oauthChallenge(scopes, {
          error: /scope/i.test(message) ? "insufficient_scope" : "invalid_token",
          description: message,
        }),
      ],
    };
  }

  return output as never;
}

async function authorizeTool(
  header: string | undefined,
  scopes: string[],
): Promise<AuthResult> {
  return authenticateBearer(header, scopes);
}

export function createDemoStudioMcpHandler(service: DemoStudioService) {
  return createMcpHandler((ctx) => {
    const authHeader =
      ctx.requestInfo?.headers.get("authorization") ?? undefined;

    const server = new McpServer({
      name: "viiversion-demo-studio",
      version: DEMO_STUDIO_VERSION,
    });

    server.registerTool(
      "get_profile",
      securedTool({
        title: "Get connected Demo Studio profile",
        description:
          "Return the stable profile represented by the current OAuth credentials.",
        inputSchema: z.object({}),
        outputSchema: z.object({
          id: z.string().min(1),
          name: z.string().optional(),
          email: z.string().optional(),
          nickname: z.string().optional(),
        }),
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      }, SCOPE_READ, { "openai/profile": true }),
      async () => {
        try {
          const auth = await authorizeTool(authHeader, [SCOPE_READ]);
          return {
            content: [{ type: "text", text: JSON.stringify(auth.profile) }],
            structuredContent: auth.profile,
          } as never;
        } catch (error) {
          return authErrorResult(error, [SCOPE_READ]);
        }
      },
    );

    server.registerTool(
      "inspect_web_app",
      securedTool({
        title: "Inspect web application",
        description:
          "Inspect a public web application and return headings plus visible interactive elements with suggested stable targets.",
        inputSchema: z.object({
          url: z.string().url(),
        }),
        annotations: {
          readOnlyHint: true,
          openWorldHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      }, SCOPE_INSPECT),
      async ({ url }) => {
        try {
          await authorizeTool(authHeader, [SCOPE_INSPECT]);
          const snapshot = await service.inspect(url);
          return {
            content: [{ type: "text", text: JSON.stringify(snapshot) }],
          };
        } catch (error) {
          if (/OAuth|bearer|Authentication|required scope/i.test(
            error instanceof Error ? error.message : String(error)
          )) {
            return authErrorResult(error, [SCOPE_INSPECT]);
          }
          return {
            content: [{
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            }],
            isError: true,
          };
        }
      },
    );

    server.registerTool(
      "audit_web_app_design",
      securedTool({
        title: "Audit web application UX and visual system",
        description:
          "Run the reusable VIIVERSION UX/Design Brain against a public web application. Returns desktop/mobile QA, inferred design profile and overlay design contract.",
        inputSchema: z.object({
          url: z.string().url(),
        }),
        annotations: {
          readOnlyHint: true,
          openWorldHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      }, SCOPE_INSPECT),
      async ({ url }) => {
        try {
          await authorizeTool(authHeader, [SCOPE_INSPECT]);
          const result = await service.auditDesign(url);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        } catch (error) {
          if (/OAuth|bearer|Authentication|required scope/i.test(
            error instanceof Error ? error.message : String(error)
          )) {
            return authErrorResult(error, [SCOPE_INSPECT]);
          }
          return {
            content: [{
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            }],
            isError: true,
          };
        }
      },
    );

    server.registerTool(
      "create_demo_video_from_scenario",
      securedTool({
        title: "Render web app demo from scenario",
        description:
          "Render a presentation video from a Demo Studio scenario built from inspect_web_app results.",
        inputSchema: z.object({
          url: z.string().url(),
          scenario: z.unknown(),
          preset: z.enum(["16:9", "9:16", "1:1"]).optional(),
          captions: z.boolean().optional(),
          voiceover: z.boolean().optional(),
          voice: z.string().max(80).optional(),
          brand: z.string().max(120).optional(),
          cta: z.string().max(180).optional(),
        }),
        annotations: {
          readOnlyHint: false,
          openWorldHint: true,
          destructiveHint: true,
          idempotentHint: false,
        },
      }, SCOPE_GENERATE),
      async (input) => {
        try {
          const auth = await authorizeTool(authHeader, [SCOPE_GENERATE]);
          const created = await service.createScenarioJob(input, auth.identity);
          const statusUrl = publicBaseUrl() + "/v1/jobs/" + created.job.id;
          const statusPageUrl =
            publicBaseUrl() +
            "/jobs/" +
            created.job.id +
            (created.job.statusToken
              ? "?status_token=" + encodeURIComponent(created.job.statusToken)
              : "");
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                job_id: created.job.id,
                status: created.job.status,
                status_url: statusUrl,
                status_page_url: statusPageUrl,
                progress: created.job.progress,
                stage: created.job.stage,
                attempt: created.job.attempt,
                max_attempts: created.job.maxAttempts,
                quota: created.quota,
              }),
            }],
          };
        } catch (error) {
          if (/OAuth|bearer|Authentication|required scope/i.test(
            error instanceof Error ? error.message : String(error)
          )) {
            return authErrorResult(error, [SCOPE_GENERATE]);
          }
          return {
            content: [{
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            }],
            isError: true,
          };
        }
      },
    );

    server.registerTool(
      "create_demo_video",
      securedTool({
        title: "Create web app demo video",
        description:
          "Create a presentation video of a web application from its URL and a plain-language demo goal. Returns a job ID immediately; use get_demo_job to monitor it.",
        inputSchema: z.object({
          url: z.string().url().describe("Public http(s) URL of the web application"),
          goal: z.string().min(1).max(2000).describe(
            "What the presentation should demonstrate, in natural language",
          ),
          preset: z.enum(["16:9", "9:16", "1:1"]).optional(),
          captions: z.boolean().optional(),
          voiceover: z.boolean().optional(),
          voice: z.string().max(80).optional(),
          brand: z.string().max(120).optional(),
          cta: z.string().max(180).optional(),
        }),
        annotations: {
          readOnlyHint: false,
          openWorldHint: true,
          destructiveHint: true,
          idempotentHint: false,
        },
      }, SCOPE_GENERATE),
      async (input) => {
        try {
          const auth = await authorizeTool(authHeader, [SCOPE_GENERATE]);
          const created = await service.createJob(input, auth.identity);
          const statusUrl = publicBaseUrl() + "/v1/jobs/" + created.job.id;
          const statusPageUrl = publicBaseUrl() + "/jobs/" + created.job.id;

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  job_id: created.job.id,
                  status: created.job.status,
                  status_url: statusUrl,
                  status_page_url: statusPageUrl,
                  progress: created.job.progress,
                  stage: created.job.stage,
                  attempt: created.job.attempt,
                  max_attempts: created.job.maxAttempts,
                  quota: created.quota,
                }),
              },
            ],
          };
        } catch (error) {
          if (/OAuth|bearer|Authentication|required scope/i.test(
            error instanceof Error ? error.message : String(error)
          )) {
            return authErrorResult(error, [SCOPE_GENERATE]);
          }
          return {
            content: [
              {
                type: "text",
                text: error instanceof Error ? error.message : String(error),
              },
            ],
            isError: true,
          };
        }
      },
    );

    server.registerTool(
      "get_demo_job",
      securedTool({
        title: "Get demo video job",
        description:
          "Check a Demo Studio generation job. When completed, returns the MP4 download URL.",
        inputSchema: z.object({
          job_id: z.string().uuid(),
        }),
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      }, SCOPE_READ),
      async ({ job_id }) => {
        try {
          const auth = await authorizeTool(authHeader, [SCOPE_READ]);
          const job = await service.getJobDurable(
            job_id,
            auth.identity,
            auth.bearerToken,
          );

          if (!job) {
            return {
              content: [{ type: "text", text: "Demo job not found." }],
              isError: true,
            };
          }

          const output: Record<string, unknown> = {
            ...job,
            status_page_url:
              publicBaseUrl() + "/jobs/" + job.id,
          };
          if (job.artifactReady) {
            output.artifact_url =
              publicBaseUrl() + "/v1/jobs/" + job.id + "/artifact";
          }

          return {
            content: [{ type: "text", text: JSON.stringify(output) }],
          };
        } catch (error) {
          return authErrorResult(error, [SCOPE_READ]);
        }
      },
    );

    return server;
  });
}
