import { readFile } from "node:fs/promises";

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
