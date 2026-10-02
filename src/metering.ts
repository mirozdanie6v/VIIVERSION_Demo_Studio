import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type UsageEvent = {
  jobId: string;
  outcome: "completed" | "failed";
  preset: "16:9" | "9:16" | "1:1";
  captions: boolean;
  voiceover: boolean;
  durationMs: number;
  occurredAt: string;
};

export async function recordUsageEvent(
  event: UsageEvent,
  rootDir = process.env.DEMO_STUDIO_STORAGE_ROOT ?? ".demo-studio-data/jobs",
): Promise<void> {
  const meterDir = path.resolve(rootDir, "..");
  await mkdir(meterDir, { recursive: true });
  await appendFile(
    path.join(meterDir, "usage.jsonl"),
    JSON.stringify(event) + "\n",
    "utf8",
  );

  const webhook = process.env.DEMO_STUDIO_USAGE_WEBHOOK_URL?.trim();
  if (!webhook) return;

  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.DEMO_STUDIO_USAGE_WEBHOOK_TOKEN
          ? {
              Authorization:
                "Bearer " + process.env.DEMO_STUDIO_USAGE_WEBHOOK_TOKEN,
            }
          : {}),
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      console.error(
        "[metering] webhook returned " +
          response.status +
          " " +
          response.statusText,
      );
    }
  } catch (error) {
    console.error(
      "[metering] webhook failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
