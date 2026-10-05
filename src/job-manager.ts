import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildStoryboard, planDemo } from "./director.js";
import { recordUsageEvent } from "./metering.js";
import { renderRun, type RenderPreset } from "./render.js";
import {
  persistArtifact,
  persistJobRecovery,
  persistJobSnapshot,
} from "./persistence.js";
import { runScenario } from "./runner.js";
import { assertSafeHttpUrl } from "./security.js";
import type { DemoScenario, RunResult } from "./types.js";
import {
  persistCaptureCheckpoint,
  persistScenarioCheckpoint,
  persistVoiceoverCheckpoint,
  restoreCaptureCheckpoint,
  restoreScenarioCheckpoint,
  restoreVoiceoverCheckpoint,
  type DemoJobCheckpoint,
} from "./checkpoints.js";
import {
  parallelVoiceoverEnabled,
  runCaptureWithOptionalVoiceover,
} from "./concurrent-media.js";
import { createVoiceover } from "./voiceover.js";
import { auditUxDesign } from "./ux-design-brain.js";

export type DemoJobRequest = {
  url: string;
  goal?: string;
  scenario?: DemoScenario;
  preset?: RenderPreset;
  captions?: boolean;
  voiceover?: boolean;
  voice?: string;
  brand?: string;
  cta?: string;
};

export type DemoJobStatus =
  | "queued"
  | "preflighting"
  | "directing"
  | "capturing"
  | "voicing"
  | "rendering"
  | "persisting"
  | "retrying"
  | "completed"
  | "failed";

export type DemoJobStage =
  | "queued"
  | "preflight"
  | "director"
  | "capture"
  | "voiceover"
  | "render"
  | "persist"
  | "retry_wait"
  | "complete"
  | "failed";

export type DemoJobEvent = {
  at: string;
  status: DemoJobStatus;
  stage: DemoJobStage;
  progress: number;
  message: string;
  attempt: number;
};

export type DemoJob = {
  id: string;
  status: DemoJobStatus;
  stage: DemoJobStage;
  stageLabel: string;
  progress: number;
  message: string;
  request: DemoJobRequest;
  createdAt: string;
  updatedAt: string;
  heartbeatAt: string;
  stageStartedAt: string;
  stageTimeoutSeconds: number;
  attempt: number;
  maxAttempts: number;
  retryReason?: string;
  history: DemoJobEvent[];
  completedAt?: string;
  scenarioPath?: string;
  storyboardPath?: string;
  runDir?: string;
  artifactPath?: string;
  checkpoint?: DemoJobCheckpoint;
  error?: string;
};

export type PublicDemoJob = {
  id: string;
  status: DemoJobStatus;
  stage: DemoJobStage;
  stageLabel: string;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  heartbeatAt: string;
  stageStartedAt: string;
  stageTimeoutSeconds: number;
  stageElapsedSeconds: number;
  heartbeatAgeSeconds: number;
  stalled: boolean;
  attempt: number;
  maxAttempts: number;
  retryReason?: string;
  history: DemoJobEvent[];
  completedAt?: string;
  error?: string;
  artifactReady: boolean;
};

export type DemoJobRecovery = {
  request: DemoJobRequest;
  createdAt: string;
  attempt: number;
  maxAttempts: number;
  history: DemoJobEvent[];
  checkpoint?: DemoJobCheckpoint;
};

class PermanentJobError extends Error {}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function secondsSince(value: string, now = Date.now()): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.floor((now - parsed) / 1000))
    : 0;
}

function isTerminal(status: DemoJobStatus): boolean {
  return status === "completed" || status === "failed";
}

export function toPublicDemoJob(job: DemoJob): PublicDemoJob {
  const stage = job.stage ?? (
    job.status === "preflighting"
      ? "preflight"
      : job.status === "directing"
        ? "director"
        : job.status === "capturing"
          ? "capture"
          : job.status === "voicing"
            ? "voiceover"
            : job.status === "rendering"
              ? "render"
              : job.status === "persisting"
                ? "persist"
                : job.status === "retrying"
                  ? "retry_wait"
                  : job.status === "completed"
                    ? "complete"
                    : job.status === "failed"
                      ? "failed"
                      : "queued"
  );
  const updatedAt = job.updatedAt ?? job.createdAt;
  const heartbeatAt = job.heartbeatAt ?? updatedAt;
  const stageStartedAt = job.stageStartedAt ?? updatedAt;
  const stageTimeoutSeconds = job.stageTimeoutSeconds ?? 300;
  const attempt = job.attempt ?? 1;
  const maxAttempts = job.maxAttempts ?? 3;
  const history = job.history ?? [];
  const stageElapsedSeconds = secondsSince(stageStartedAt);
  const heartbeatAgeSeconds = secondsSince(heartbeatAt);

  return {
    id: job.id,
    status: job.status,
    stage,
    stageLabel: job.stageLabel ?? stage,
    progress: job.progress,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt,
    heartbeatAt,
    stageStartedAt,
    stageTimeoutSeconds,
    stageElapsedSeconds,
    heartbeatAgeSeconds,
    stalled:
      !isTerminal(job.status) &&
      stageElapsedSeconds > stageTimeoutSeconds,
    attempt,
    maxAttempts,
    retryReason: job.retryReason,
    history: history.slice(-20),
    completedAt: job.completedAt,
    error: job.error,
    artifactReady: Boolean(
      job.artifactPath && job.status === "completed",
    ),
  };
}

function narrationFor(scenario: DemoScenario): string {
  return scenario.steps
    .map((step) => step.narration?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DemoJobManager {
  private readonly jobs = new Map<string, DemoJob>();
  private readonly queue: string[] = [];
  private running = 0;
  private draining = false;

  readonly rootDir: string;
  readonly maxConcurrent: number;
  readonly maxAttempts: number;
  readonly heartbeatIntervalMs: number;

  constructor(options: {
    rootDir?: string;
    maxConcurrent?: number;
    maxAttempts?: number;
    heartbeatIntervalMs?: number;
  } = {}) {
    this.rootDir = path.resolve(
      options.rootDir ??
        process.env.DEMO_STUDIO_STORAGE_ROOT ??
        ".demo-studio-data/jobs",
    );
    this.maxConcurrent =
      options.maxConcurrent ??
      positiveInteger(process.env.DEMO_STUDIO_MAX_CONCURRENT_JOBS, 2);
    this.maxAttempts =
      options.maxAttempts ??
      positiveInteger(process.env.DEMO_STUDIO_MAX_JOB_ATTEMPTS, 3);
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ??
      positiveInteger(process.env.DEMO_STUDIO_HEARTBEAT_MS, 10_000);
  }

  async submit(request: DemoJobRequest): Promise<PublicDemoJob> {
    await assertSafeHttpUrl(request.url);

    if (!request.scenario && !request.goal?.trim()) {
      throw new Error("Either goal or scenario is required.");
    }

    const now = new Date().toISOString();
    const job: DemoJob = {
      id: randomUUID(),
      status: "queued",
      stage: "queued",
      stageLabel: "Waiting for worker",
      progress: 0,
      message: "Waiting for an available worker.",
      request,
      createdAt: now,
      updatedAt: now,
      heartbeatAt: now,
      stageStartedAt: now,
      stageTimeoutSeconds: 900,
      attempt: 1,
      maxAttempts: this.maxAttempts,
      history: [],
    };
    this.pushEvent(job);

    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    await this.persistRecovery(job);
    await this.persist(job);
    void this.drain();

    return this.publicJob(job);
  }

  async resume(
    id: string,
    recovery: DemoJobRecovery,
    reason: string,
  ): Promise<PublicDemoJob> {
    const existing = this.jobs.get(id);
    if (existing && !isTerminal(existing.status)) {
      return this.publicJob(existing);
    }

    await assertSafeHttpUrl(recovery.request.url);
    const now = new Date().toISOString();
    const attempt = Math.max(1, recovery.attempt);
    const job: DemoJob = {
      id,
      status: "retrying",
      stage: "retry_wait",
      stageLabel: "Recovering job",
      progress: 1,
      message:
        "Automatic recovery is restarting this job (attempt " +
        attempt +
        "/" +
        recovery.maxAttempts +
        ").",
      request: recovery.request,
      createdAt: recovery.createdAt,
      updatedAt: now,
      heartbeatAt: now,
      stageStartedAt: now,
      stageTimeoutSeconds: 60,
      attempt,
      maxAttempts: recovery.maxAttempts,
      retryReason: reason,
      history: recovery.history.slice(-20),
      checkpoint: recovery.checkpoint,
    };
    this.pushEvent(job);

    this.jobs.set(id, job);
    this.queue.push(id);
    await this.persistRecovery(job);
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
    return toPublicDemoJob(job);
  }

  private pushEvent(job: DemoJob): void {
    job.history.push({
      at: job.updatedAt,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      message: job.message,
      attempt: job.attempt,
    });
    if (job.history.length > 24) {
      job.history.splice(0, job.history.length - 24);
    }
  }

  private async update(
    job: DemoJob,
    patch: Partial<Pick<
      DemoJob,
      | "status"
      | "stage"
      | "stageLabel"
      | "progress"
      | "message"
      | "stageStartedAt"
      | "stageTimeoutSeconds"
      | "heartbeatAt"
      | "attempt"
      | "retryReason"
      | "scenarioPath"
      | "storyboardPath"
      | "runDir"
      | "artifactPath"
      | "checkpoint"
      | "error"
      | "completedAt"
    >>,
    options: { event?: boolean } = {},
  ): Promise<void> {
    const now = new Date().toISOString();
    Object.assign(job, patch, {
      updatedAt: now,
      heartbeatAt: patch.heartbeatAt ?? now,
    });
    if (options.event !== false) this.pushEvent(job);
    await this.persist(job);
  }

  private async beginStage(
    job: DemoJob,
    input: {
      status: DemoJobStatus;
      stage: DemoJobStage;
      stageLabel: string;
      progress: number;
      message: string;
      timeoutSeconds: number;
    },
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.update(job, {
      ...input,
      stageStartedAt: now,
      heartbeatAt: now,
      error: undefined,
    });
  }

  private async heartbeat(job: DemoJob): Promise<void> {
    if (isTerminal(job.status)) return;
    await this.update(
      job,
      { heartbeatAt: new Date().toISOString() },
      { event: false },
    );
  }

  private async persist(job: DemoJob): Promise<void> {
    const dir = path.join(this.rootDir, job.id);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "job.json"),
      JSON.stringify(job, null, 2) + "\n",
      "utf8",
    );

    await persistJobSnapshot(job.id, this.publicJob(job)).catch(
      (persistenceError) => {
        console.error("[persistence] progress snapshot failed", persistenceError);
      },
    );
  }

  private recoveryPayload(job: DemoJob): DemoJobRecovery {
    return {
      request: job.request,
      createdAt: job.createdAt,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      history: job.history.slice(-20),
      checkpoint: job.checkpoint,
    };
  }

  private async persistRecovery(job: DemoJob): Promise<void> {
    await persistJobRecovery(job.id, this.recoveryPayload(job));
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.running < this.maxConcurrent && this.queue.length > 0) {
        const id = this.queue.shift();
        if (!id) break;

        const job = this.jobs.get(id);
        if (
          !job ||
          (job.status !== "queued" && job.status !== "retrying")
        ) {
          continue;
        }

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

  private retryable(error: unknown): boolean {
    if (error instanceof PermanentJobError) return false;
    const message = error instanceof Error ? error.message : String(error);
    return !/quota exceeded|invalid or missing bearer|host header|origin is not allowed|visual critic blocked|editor brain quality gate failed/i.test(
      message,
    );
  }

  private async execute(job: DemoJob): Promise<void> {
    while (true) {
      const heartbeat = setInterval(() => {
        void this.heartbeat(job).catch((error) => {
          console.error("[heartbeat]", error);
        });
      }, this.heartbeatIntervalMs);
      heartbeat.unref?.();

      try {
        await this.executeAttempt(job);
        return;
      } catch (error) {
        clearInterval(heartbeat);

        if (this.retryable(error) && job.attempt < job.maxAttempts) {
          const reason =
            error instanceof Error ? error.message : String(error);
          const nextAttempt = job.attempt + 1;
          const backoffSeconds = Math.min(20, 3 * nextAttempt);

          job.attempt = nextAttempt;
          job.retryReason = reason;
          await this.beginStage(job, {
            status: "retrying",
            stage: "retry_wait",
            stageLabel: "Automatic retry",
            progress: Math.min(job.progress, 92),
            message:
              "A recoverable error occurred. Retrying automatically in " +
              backoffSeconds +
              " seconds (attempt " +
              nextAttempt +
              "/" +
              job.maxAttempts +
              ").",
            timeoutSeconds: backoffSeconds + 45,
          });
          await this.persistRecovery(job);
          await delay(backoffSeconds * 1000);
          continue;
        }

        await this.fail(job, error);
        return;
      } finally {
        clearInterval(heartbeat);
      }
    }
  }

  private async executeAttempt(job: DemoJob): Promise<void> {
    const jobDir = path.join(this.rootDir, job.id);
    const scenarioPath = path.join(jobDir, "scenario.json");
    const storyboardPath = path.join(jobDir, "storyboard.md");

    let scenario: DemoScenario | undefined;
    let storyboard: string | undefined;
    let snapshot: unknown;

    if (job.checkpoint?.version === 1 && job.checkpoint.scenarioReady) {
      const restored = await restoreScenarioCheckpoint(job.id, jobDir);
      if (restored) {
        scenario = restored.scenario;
        storyboard = restored.storyboard;
        await this.beginStage(job, {
          status: "directing",
          stage: "director",
          stageLabel: "Checkpoint recovery",
          progress: 26,
          message: "Recovered a validated scenario checkpoint.",
          timeoutSeconds: 60,
        });
        await this.update(job, {
          scenarioPath,
          storyboardPath,
          checkpoint: job.checkpoint,
        });
      } else {
        job.checkpoint = undefined;
        await this.persistRecovery(job);
      }
    }

    if (!scenario || !storyboard) {
      await this.beginStage(job, {
        status: "preflighting",
        stage: "preflight",
        stageLabel: "UX & design preflight",
        progress: 5,
        message:
          "Checking desktop, mobile, accessibility and visual-system constraints.",
        timeoutSeconds: 150,
      });

      const uxDesign = await auditUxDesign(job.request.url, {
        outputDir: jobDir,
      });

      if (uxDesign.preflight.status === "BLOCKED") {
        throw new PermanentJobError(
          "UX/Design preflight blocked generation: " +
            uxDesign.preflight.findings
              .map((finding) => finding.message)
              .join(" "),
        );
      }

      await this.update(job, {
        progress: 14,
        message:
          "UX & design preflight passed (" +
          uxDesign.cacheSource +
          ").",
      });

      if (job.request.scenario) {
        scenario = job.request.scenario;
        storyboard = buildStoryboard(scenario);
      } else {
        await this.beginStage(job, {
          status: "directing",
          stage: "director",
          stageLabel: "AI Director",
          progress: 16,
          message:
            "Inspecting the application and building the presentation storyboard.",
          timeoutSeconds: 180,
        });

        const directed = await planDemo(
          job.request.url,
          job.request.goal ?? "",
        );
        scenario = directed.scenario;
        storyboard = directed.storyboard;
        snapshot = directed.snapshot;

        await this.update(job, {
          progress: 26,
          message: "Storyboard is ready.",
        });
      }

      const writes: Promise<unknown>[] = [
        writeFile(
          scenarioPath,
          JSON.stringify(scenario, null, 2) + "\n",
          "utf8",
        ),
        writeFile(storyboardPath, storyboard + "\n", "utf8"),
      ];

      if (snapshot) {
        writes.push(
          writeFile(
            path.join(jobDir, "snapshot.json"),
            JSON.stringify(snapshot, null, 2) + "\n",
            "utf8",
          ),
        );
      }
      await Promise.all(writes);

      await persistScenarioCheckpoint(job.id, jobDir);
      job.checkpoint = {
        version: 1,
        scenarioReady: true,
      };
      await this.update(job, {
        scenarioPath,
        storyboardPath,
        checkpoint: job.checkpoint,
        progress: Math.max(job.progress, 28),
        message: "Scenario checkpoint saved.",
      });
      await this.persistRecovery(job);
    }

    const activeScenario = scenario;
    if (!activeScenario) {
      throw new Error("Scenario checkpoint resolution failed.");
    }

    let narration: string | undefined;
    let plannedVoiceoverPath: string | undefined;

    if (job.request.voiceover) {
      narration = narrationFor(activeScenario);
      if (!narration) {
        throw new PermanentJobError(
          "Voiceover requested, but the scenario contains no narration.",
        );
      }
      plannedVoiceoverPath = path.join(jobDir, "voiceover.mp3");
    }

    let restoredCapture: RunResult | undefined;
    let restoredVoiceoverPath: string | undefined;

    if (job.checkpoint?.captureRunId) {
      restoredCapture = await restoreCaptureCheckpoint(
        job.id,
        jobDir,
        job.checkpoint.captureRunId,
      );
      if (!restoredCapture) {
        job.checkpoint = {
          version: 1,
          scenarioReady: true,
          voiceoverReady: job.checkpoint.voiceoverReady,
        };
        await this.persistRecovery(job);
      }
    }

    if (
      job.request.voiceover &&
      plannedVoiceoverPath &&
      job.checkpoint?.voiceoverReady
    ) {
      restoredVoiceoverPath = await restoreVoiceoverCheckpoint(
        job.id,
        plannedVoiceoverPath,
      );
      if (!restoredVoiceoverPath) {
        job.checkpoint = {
          version: 1,
          scenarioReady: true,
          captureRunId: job.checkpoint.captureRunId,
        };
        await this.persistRecovery(job);
      }
    }

    const needsCapture = !restoredCapture;
    const needsVoiceover =
      Boolean(job.request.voiceover) && !restoredVoiceoverPath;

    if (needsCapture) {
      const captureTimeout = Math.max(
        300,
        activeScenario.steps.length * 40,
      );
      await this.beginStage(job, {
        status: "capturing",
        stage: "capture",
        stageLabel: "Browser capture",
        progress: 30,
        message: "Executing and recording the customer journey.",
        timeoutSeconds: captureTimeout,
      });
    } else if (needsVoiceover) {
      await this.beginStage(job, {
        status: "voicing",
        stage: "voiceover",
        stageLabel: "Narration recovery",
        progress: 64,
        message:
          "Browser capture restored. Generating only the missing narration.",
        timeoutSeconds: 180,
      });
    } else {
      await this.update(job, {
        progress: job.request.voiceover ? 75 : 62,
        message: job.request.voiceover
          ? "Browser capture and narration restored from checkpoints."
          : "Browser capture restored from checkpoint.",
        runDir: restoredCapture?.runDir,
      });
    }

    let capture = restoredCapture;
    let voiceoverPath = restoredVoiceoverPath;

    if (needsCapture || needsVoiceover) {
      const captureWasRestored = Boolean(restoredCapture);
      const voiceoverWasRestored = Boolean(restoredVoiceoverPath);

      const media = await runCaptureWithOptionalVoiceover({
        parallel: parallelVoiceoverEnabled(),
        capture: restoredCapture
          ? async () => restoredCapture as RunResult
          : () =>
              runScenario(activeScenario, {
                artifactsRoot: path.join(jobDir, "captures"),
              }),
        voiceover:
          narration && plannedVoiceoverPath
            ? restoredVoiceoverPath
              ? async () => restoredVoiceoverPath as string
              : async () => {
                  await createVoiceover(
                    narration as string,
                    plannedVoiceoverPath as string,
                    {
                      voice: job.request.voice,
                    },
                  );
                  return plannedVoiceoverPath as string;
                }
            : undefined,
        onCapture: captureWasRestored
          ? undefined
          : async (result) => {
              await persistCaptureCheckpoint(job.id, result);
              job.checkpoint = {
                ...(job.checkpoint ?? { version: 1 }),
                version: 1,
                scenarioReady: true,
                captureRunId: result.runId,
              };
              await this.update(job, {
                checkpoint: job.checkpoint,
                runDir: result.runDir,
                progress: Math.max(job.progress, 62),
                message: "Browser capture checkpoint saved.",
              });
              await this.persistRecovery(job);
            },
        onVoiceover: voiceoverWasRestored
          ? undefined
          : async (resultPath) => {
              await persistVoiceoverCheckpoint(job.id, resultPath);
              job.checkpoint = {
                ...(job.checkpoint ?? { version: 1 }),
                version: 1,
                scenarioReady: true,
                voiceoverReady: true,
              };
              await this.update(job, {
                checkpoint: job.checkpoint,
                progress: Math.max(job.progress, 70),
                message: "Narration checkpoint saved.",
              });
              await this.persistRecovery(job);
            },
      });

      capture = media.capture;
      voiceoverPath = media.voiceoverPath;
    }

    if (!capture) {
      throw new Error("Capture stage did not produce a usable recording.");
    }

    await this.update(job, {
      progress: voiceoverPath ? 75 : 62,
      message: voiceoverPath
        ? "Browser capture and narration are complete."
        : "Browser capture is complete.",
      runDir: capture.runDir,
      checkpoint: job.checkpoint,
    });

    await this.beginStage(job, {
      status: "rendering",
      stage: "render",
      stageLabel: "Final render",
      progress: 78,
      message:
        "Editor Brain, Design Brain and FFmpeg are building the final video.",
      timeoutSeconds: 420,
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
      designContractPath: path.join(jobDir, "design_contract.json"),
      uxPreflightPath: path.join(jobDir, "ux_preflight.json"),
    });

    await this.beginStage(job, {
      status: "persisting",
      stage: "persist",
      stageLabel: "Saving result",
      progress: 96,
      message: "Saving the final MP4 to durable storage.",
      timeoutSeconds: 120,
    });

    await persistArtifact(job.id, artifactPath);

    const completedAt = new Date().toISOString();
    await this.update(job, {
      status: "completed",
      stage: "complete",
      stageLabel: "Completed",
      stageStartedAt: completedAt,
      stageTimeoutSeconds: 86_400,
      progress: 100,
      message: "Presentation video is ready.",
      artifactPath,
      completedAt,
      retryReason: undefined,
    });

    void recordUsageEvent({
      jobId: job.id,
      outcome: "completed",
      preset,
      captions: job.request.captions !== false,
      voiceover: Boolean(job.request.voiceover),
      durationMs: Date.now() - Date.parse(job.createdAt),
      occurredAt: completedAt,
    }, this.rootDir).catch((meterError) => {
      console.error("[metering]", meterError);
    });
  }

  private async fail(job: DemoJob, error: unknown): Promise<void> {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);

    await this.update(job, {
      status: "failed",
      stage: "failed",
      stageLabel: "Failed",
      stageStartedAt: completedAt,
      stageTimeoutSeconds: 86_400,
      progress: 100,
      message:
        job.attempt >= job.maxAttempts
          ? "Generation failed after all automatic recovery attempts."
          : "Generation failed.",
      error: message,
      completedAt,
    });

    void recordUsageEvent({
      jobId: job.id,
      outcome: "failed",
      preset: job.request.preset ?? "16:9",
      captions: job.request.captions !== false,
      voiceover: Boolean(job.request.voiceover),
      durationMs: Date.now() - Date.parse(job.createdAt),
      occurredAt: completedAt,
    }, this.rootDir).catch((meterError) => {
      console.error("[metering]", meterError);
    });
  }
}
