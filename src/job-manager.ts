import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { planDemo } from "./director.js";
import { renderRun, type RenderPreset } from "./render.js";
import { runScenario } from "./runner.js";
import { assertSafeHttpUrl } from "./security.js";
import { createVoiceover } from "./voiceover.js";

export type DemoJobRequest = {
  url: string;
  goal: string;
  preset?: RenderPreset;
  captions?: boolean;
  voiceover?: boolean;
  voice?: string;
  brand?: string;
  cta?: string;
};

export type DemoJobStatus =
  | "queued"
  | "directing"
  | "capturing"
  | "rendering"
  | "completed"
  | "failed";

export type DemoJob = {
  id: string;
  status: DemoJobStatus;
  progress: number;
  message: string;
  request: DemoJobRequest;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  scenarioPath?: string;
  storyboardPath?: string;
  runDir?: string;
  artifactPath?: string;
  error?: string;
};

export type PublicDemoJob = Omit<
  DemoJob,
  "scenarioPath" | "storyboardPath" | "runDir" | "artifactPath"
> & {
  artifactReady: boolean;
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function narrationFor(job: DemoJob, scenario: Awaited<ReturnType<typeof planDemo>>["scenario"]): string {
  return scenario.steps
    .map((step) => step.narration?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

export class DemoJobManager {
  private readonly jobs = new Map<string, DemoJob>();
  private readonly queue: string[] = [];
  private running = 0;
  private draining = false;

  readonly rootDir: string;
  readonly maxConcurrent: number;

  constructor(options: { rootDir?: string; maxConcurrent?: number } = {}) {
    this.rootDir = path.resolve(
      options.rootDir ??
        process.env.DEMO_STUDIO_STORAGE_ROOT ??
        ".demo-studio-data/jobs",
    );
    this.maxConcurrent =
      options.maxConcurrent ??
      positiveInteger(process.env.DEMO_STUDIO_MAX_CONCURRENT_JOBS, 2);
  }

  async submit(request: DemoJobRequest): Promise<PublicDemoJob> {
    await assertSafeHttpUrl(request.url);

    const now = new Date().toISOString();
    const job: DemoJob = {
      id: randomUUID(),
      status: "queued",
      progress: 0,
      message: "Waiting for an available worker.",
      request,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    await this.persist(job);
    void this.drain();

    return this.publicJob(job);
  }

  get(id: string): PublicDemoJob | undefined {
    const job = this.jobs.get(id);
    return job ? this.publicJob(job) : undefined;
  }

  getInternal(id: string): DemoJob | undefined {
    return this.jobs.get(id);
  }

  async readArtifact(id: string): Promise<{ path: string; buffer: Buffer } | undefined> {
    const job = this.jobs.get(id);
    if (!job?.artifactPath || job.status !== "completed") return undefined;

    return {
      path: job.artifactPath,
      buffer: await readFile(job.artifactPath),
    };
  }

  private publicJob(job: DemoJob): PublicDemoJob {
    const {
      scenarioPath: _scenarioPath,
      storyboardPath: _storyboardPath,
      runDir: _runDir,
      artifactPath,
      ...publicFields
    } = job;

    return {
      ...publicFields,
      artifactReady: Boolean(artifactPath && job.status === "completed"),
    };
  }

  private async update(
    job: DemoJob,
    patch: Partial<Pick<
      DemoJob,
      | "status"
      | "progress"
      | "message"
      | "scenarioPath"
      | "storyboardPath"
      | "runDir"
      | "artifactPath"
      | "error"
      | "completedAt"
    >>,
  ): Promise<void> {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    await this.persist(job);
  }

  private async persist(job: DemoJob): Promise<void> {
    const dir = path.join(this.rootDir, job.id);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "job.json"),
      JSON.stringify(job, null, 2) + "\n",
      "utf8",
    );
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.running < this.maxConcurrent && this.queue.length > 0) {
        const id = this.queue.shift();
        if (!id) break;

        const job = this.jobs.get(id);
        if (!job || job.status !== "queued") continue;

        this.running += 1;
        void this.execute(job).finally(() => {
          this.running -= 1;
          void this.drain();
        });
      }
    } finally {
      this.draining = false;
    }
  }

  private async execute(job: DemoJob): Promise<void> {
    const jobDir = path.join(this.rootDir, job.id);

    try {
      await this.update(job, {
        status: "directing",
        progress: 10,
        message: "AI Director is inspecting the application and building the storyboard.",
      });

      const directed = await planDemo(job.request.url, job.request.goal);

      const scenarioPath = path.join(jobDir, "scenario.json");
      const storyboardPath = path.join(jobDir, "storyboard.md");
      await Promise.all([
        writeFile(scenarioPath, JSON.stringify(directed.scenario, null, 2) + "\n", "utf8"),
        writeFile(storyboardPath, directed.storyboard + "\n", "utf8"),
        writeFile(
          path.join(jobDir, "snapshot.json"),
          JSON.stringify(directed.snapshot, null, 2) + "\n",
          "utf8",
        ),
      ]);

      await this.update(job, {
        status: "capturing",
        progress: 40,
        message: "Browser is executing and recording the approved scenario.",
        scenarioPath,
        storyboardPath,
      });

      const capture = await runScenario(directed.scenario, {
        artifactsRoot: path.join(jobDir, "captures"),
      });

      await this.update(job, {
        progress: 68,
        message: "Browser capture is complete.",
        runDir: capture.runDir,
      });

      let voiceoverPath: string | undefined;
      if (job.request.voiceover) {
        const narration = narrationFor(job, directed.scenario);
        if (!narration) {
          throw new Error("Voiceover requested, but the generated scenario contains no narration.");
        }

        voiceoverPath = path.join(jobDir, "voiceover.mp3");
        await createVoiceover(narration, voiceoverPath, {
          voice: job.request.voice,
        });
      }

      await this.update(job, {
        status: "rendering",
        progress: 78,
        message: "Rendering final presentation video.",
      });

      const preset = job.request.preset ?? "16:9";
      const artifactPath = path.join(
        jobDir,
        "final-" + preset.replace(":", "x") + ".mp4",
      );

      await renderRun({
        runDir: capture.runDir,
        outputPath: artifactPath,
        preset,
        captions: job.request.captions !== false,
        voiceoverPath,
        brandLabel: job.request.brand ?? "VIIVERSION",
        cta: job.request.cta,
      });

      const completedAt = new Date().toISOString();
      await this.update(job, {
        status: "completed",
        progress: 100,
        message: "Presentation video is ready.",
        artifactPath,
        completedAt,
      });
    } catch (error) {
      await this.update(job, {
        status: "failed",
        progress: 100,
        message: "Demo generation failed.",
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      });
    }
  }
}
