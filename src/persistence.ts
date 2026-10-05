import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function baseUrl(): string | undefined {
  const value = process.env.PUBLIC_BASE_URL?.trim();
  return value ? value.replace(/\/$/, "") : undefined;
}

function internalToken(): string | undefined {
  return process.env.DEMO_STUDIO_INTERNAL_TOKEN?.trim() || undefined;
}

export function durablePersistenceEnabled(): boolean {
  return Boolean(baseUrl() && internalToken());
}

async function putInternal(
  pathname: string,
  body: BodyInit,
  contentType: string,
): Promise<void> {
  const base = baseUrl();
  const token = internalToken();

  if (!base || !token) return;

  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(base + pathname, {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": contentType,
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new Error(
          "Durable persistence returned HTTP " +
            response.status +
            ": " +
            (await response.text()),
        );
      }

      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 350));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Durable persistence failed.");
}

async function getInternal(pathname: string): Promise<Buffer | undefined> {
  const base = baseUrl();
  const token = internalToken();

  if (!base || !token) return undefined;

  const response = await fetch(base + pathname, {
    method: "GET",
    headers: {
      Authorization: "Bearer " + token,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      "Durable checkpoint read returned HTTP " +
        response.status +
        ": " +
        (await response.text()),
    );
  }

  return Buffer.from(await response.arrayBuffer());
}

export const CHECKPOINT_FILE_NAMES = [
  "scenario.json",
  "storyboard.md",
  "design_contract.json",
  "ux_preflight.json",
  "run.json",
  "capture.webm",
  "voiceover.mp3",
] as const;

export type CheckpointFileName = (typeof CHECKPOINT_FILE_NAMES)[number];

export async function persistCheckpointFile(
  jobId: string,
  name: CheckpointFileName,
  filePath: string,
  contentType = "application/octet-stream",
): Promise<void> {
  if (!durablePersistenceEnabled()) return;
  const body = await readFile(filePath);
  await putInternal(
    "/__internal/checkpoints/" +
      encodeURIComponent(jobId) +
      "/" +
      encodeURIComponent(name),
    body,
    contentType,
  );
}

export async function restoreCheckpointFile(
  jobId: string,
  name: CheckpointFileName,
  destinationPath: string,
): Promise<boolean> {
  if (!durablePersistenceEnabled()) return false;
  const body = await getInternal(
    "/__internal/checkpoints/" +
      encodeURIComponent(jobId) +
      "/" +
      encodeURIComponent(name),
  );
  if (!body) return false;

  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, body);
  return true;
}

export async function persistArtifact(
  jobId: string,
  artifactPath: string,
): Promise<void> {
  if (!durablePersistenceEnabled()) return;
  const body = await readFile(artifactPath);
  await putInternal(
    "/__internal/artifacts/" + encodeURIComponent(jobId),
    body,
    "video/mp4",
  );
}

export async function persistJobSnapshot(
  jobId: string,
  payload: unknown,
): Promise<void> {
  if (!durablePersistenceEnabled()) return;
  await putInternal(
    "/__internal/jobs/" + encodeURIComponent(jobId),
    JSON.stringify(payload),
    "application/json; charset=utf-8",
  );
}


export async function persistJobRecovery(
  jobId: string,
  payload: unknown,
): Promise<void> {
  if (!durablePersistenceEnabled()) return;
  await putInternal(
    "/__internal/recovery/" + encodeURIComponent(jobId),
    JSON.stringify(payload),
    "application/json; charset=utf-8",
  );
}
