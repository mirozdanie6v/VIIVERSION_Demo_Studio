import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { authenticateBearer } from "./auth.js";
import { DemoStudioService } from "./service.js";

function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");
}

export function createDemoStudioMcpHandler(service: DemoStudioService) {
  return createMcpHandler((ctx) => {
    const identity = authenticateBearer(
      ctx.requestInfo?.headers.get("authorization") ?? undefined,
    ).identity;

    const server = new McpServer({
      name: "viiversion-demo-studio",
      version: "0.9.1",
    });

    server.registerTool(
      "inspect_web_app",
      {
        title: "Inspect web application",
        description:
          "Inspect a public web application and return headings plus visible interactive elements with suggested stable targets.",
        inputSchema: z.object({
          url: z.string().url(),
        }),
      },
      async ({ url }) => {
        try {
          const snapshot = await service.inspect(url);
          return {
            content: [{ type: "text", text: JSON.stringify(snapshot) }],
          };
        } catch (error) {
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
      {
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
      },
      async (input) => {
        try {
          const created = await service.createScenarioJob(input, identity);
          const statusUrl = publicBaseUrl() + "/v1/jobs/" + created.job.id;
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                job_id: created.job.id,
                status: created.job.status,
                status_url: statusUrl,
                quota: created.quota,
              }),
            }],
          };
        } catch (error) {
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
      {
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
      },
      async (input) => {
        try {
          const created = await service.createJob(input, identity);
          const statusUrl = publicBaseUrl() + "/v1/jobs/" + created.job.id;

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  job_id: created.job.id,
                  status: created.job.status,
                  status_url: statusUrl,
                  quota: created.quota,
                }),
              },
            ],
          };
        } catch (error) {
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
      {
        title: "Get demo video job",
        description:
          "Check a Demo Studio generation job. When completed, returns the MP4 download URL.",
        inputSchema: z.object({
          job_id: z.string().uuid(),
        }),
      },
      async ({ job_id }) => {
        const job = service.getJob(job_id);

        if (!job) {
          return {
            content: [{ type: "text", text: "Demo job not found." }],
            isError: true,
          };
        }

        const output: Record<string, unknown> = { ...job };
        if (job.artifactReady) {
          output.artifact_url =
            publicBaseUrl() + "/v1/jobs/" + job.id + "/artifact";
        }

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
        };
      },
    );

    return server;
  });
}
