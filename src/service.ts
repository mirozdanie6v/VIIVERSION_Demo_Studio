import {
  DemoJobManager,
  type DemoJobRequest,
  type PublicDemoJob,
  type DemoJobRecovery,
} from "./job-manager.js";
import { inspectApplication, type ApplicationSnapshot } from "./inspector.js";
import { DailyQuota } from "./quota.js";
import { assertNoEnvironmentReferences, parseScenario } from "./scenario.js";
import type { DemoScenario } from "./types.js";
import { auditUxDesign } from "./ux-design-brain.js";

export class DemoStudioService {
  readonly jobs: DemoJobManager;
  readonly quota: DailyQuota;

  constructor(options: { jobs?: DemoJobManager; quota?: DailyQuota } = {}) {
    this.jobs = options.jobs ?? new DemoJobManager();
    this.quota = options.quota ?? new DailyQuota();
  }

  async inspect(url: string): Promise<ApplicationSnapshot> {
    return inspectApplication(url);
  }

  async auditDesign(url: string) {
    return auditUxDesign(url);
  }

  async createJob(
    request: DemoJobRequest,
    identity: string,
  ): Promise<{
    job: PublicDemoJob;
    quota: { used: number; limit: number; remaining: number };
  }> {
    if (!request.scenario && !process.env.OPENAI_API_KEY) {
      throw new Error(
        "Server-side AI Director requires OPENAI_API_KEY. For ChatGPT/MCP use inspect_web_app followed by create_demo_video_from_scenario; that path does not require a server-side OpenAI key.",
      );
    }

    const quota = this.quota.consume(identity);
    const job = await this.jobs.submit(request, identity);
    return { job, quota };
  }

  async resumeJob(
    id: string,
    recovery: DemoJobRecovery,
    reason: string,
  ): Promise<PublicDemoJob> {
    return this.jobs.resume(id, recovery, reason);
  }

  async createScenarioJob(
    input: {
      url: string;
      scenario: unknown;
      preset?: DemoJobRequest["preset"];
      captions?: boolean;
      voiceover?: boolean;
      voice?: string;
      brand?: string;
      cta?: string;
    },
    identity: string,
  ): Promise<{
    job: PublicDemoJob;
    quota: { used: number; limit: number; remaining: number };
  }> {
    assertNoEnvironmentReferences(input.scenario);
    const scenario = parseScenario(input.scenario);

    const normalized: DemoScenario = {
      ...scenario,
      baseUrl: scenario.baseUrl ?? input.url,
    };

    const quota = this.quota.consume(identity);
    const job = await this.jobs.submit({
      url: input.url,
      scenario: normalized,
      preset: input.preset,
      captions: input.captions,
      voiceover: input.voiceover,
      voice: input.voice,
      brand: input.brand,
      cta: input.cta,
    }, identity);

    return { job, quota };
  }

  getJob(
    id: string,
    identity?: string,
    statusToken?: string,
  ): PublicDemoJob | undefined {
    return this.jobs.get(id, identity, statusToken);
  }

  async getJobDurable(
    id: string,
    identity: string,
    bearerToken?: string,
  ): Promise<PublicDemoJob | undefined> {
    const local = this.jobs.get(id, identity);
    if (local) return local;

    const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
    if (!base) return undefined;

    const headers: Record<string, string> = {};
    if (bearerToken) {
      headers.Authorization = "Bearer " + bearerToken;
    }

    try {
      const response = await fetch(base + "/v1/jobs/" + id, {
        headers,
        signal: AbortSignal.timeout(5_000),
      });

      if (response.status === 404) return undefined;
      if (!response.ok) {
        throw new Error(
          "Persistent job lookup returned HTTP " + response.status,
        );
      }

      return (await response.json()) as PublicDemoJob;
    } catch (error) {
      console.error("[persistence] job lookup failed", error);
      return undefined;
    }
  }
}
