import { DemoJobManager, type DemoJobRequest, type PublicDemoJob } from "./job-manager.js";
import { DailyQuota } from "./quota.js";

export class DemoStudioService {
  readonly jobs: DemoJobManager;
  readonly quota: DailyQuota;

  constructor(options: { jobs?: DemoJobManager; quota?: DailyQuota } = {}) {
    this.jobs = options.jobs ?? new DemoJobManager();
    this.quota = options.quota ?? new DailyQuota();
  }

  async createJob(
    request: DemoJobRequest,
    identity: string,
  ): Promise<{
    job: PublicDemoJob;
    quota: { used: number; limit: number; remaining: number };
  }> {
    const quota = this.quota.consume(identity);
    const job = await this.jobs.submit(request);
    return { job, quota };
  }

  getJob(id: string): PublicDemoJob | undefined {
    return this.jobs.get(id);
  }
}
