import type { Locator, Page } from "playwright";
import type { Target } from "./types.js";

export type TargetResolution = {
  locator: Locator;
  target: Target;
  recovered: boolean;
};

export function resolveTarget(page: Page, target: Target): Locator {
  if (typeof target === "string") return page.locator(target).first();

  switch (target.by) {
    case "css":
      return page.locator(target.value).first();
    case "text":
      return page.getByText(target.value, { exact: target.exact }).first();
    case "testId":
      return page.getByTestId(target.value).first();
    case "role":
      return page.getByRole(
        target.value as Parameters<Page["getByRole"]>[0],
        { name: target.name, exact: target.exact },
      ).first();
  }
}

function uniqueTargets(targets: Target[]): Target[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = JSON.stringify(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function recoveryCandidates(target: Target): Target[] {
  if (typeof target === "string") return [];

  const candidates: Target[] = [];

  if (target.by === "role" && target.name) {
    candidates.push(
      { ...target, exact: false },
      { by: "text", value: target.name, exact: true },
      { by: "text", value: target.name, exact: false },
    );
  }

  if (target.by === "text") {
    candidates.push({ ...target, exact: false });
  }

  if (target.by === "testId") {
    candidates.push(
      { by: "css", value: `[data-testid="${target.value.replace(/"/g, '\\"')}"]` },
      { by: "css", value: `[data-test-id="${target.value.replace(/"/g, '\\"')}"]` },
    );
  }

  if (target.by === "css") {
    const id = target.value.match(/^#([A-Za-z][\w:-]*)$/)?.[1];
    if (id) {
      candidates.push({ by: "css", value: `[id="${id}"]` });
    }

    const name = target.value.match(/^\[name=["']?([^"'\]]+)["']?\]$/)?.[1];
    if (name) {
      candidates.push({ by: "css", value: `[name="${name.replace(/"/g, '\\"')}"]` });
    }
  }

  return uniqueTargets(candidates).filter(
    (candidate) => JSON.stringify(candidate) !== JSON.stringify(target),
  );
}

async function locatorReady(locator: Locator, timeoutMs: number): Promise<boolean> {
  try {
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

export async function resolveTargetWithRecovery(
  page: Page,
  target: Target,
  options: { primaryTimeoutMs?: number; fallbackTimeoutMs?: number } = {},
): Promise<TargetResolution> {
  const primary = resolveTarget(page, target);

  if (await locatorReady(primary, options.primaryTimeoutMs ?? 2_500)) {
    return { locator: primary, target, recovered: false };
  }

  for (const fallback of recoveryCandidates(target)) {
    const locator = resolveTarget(page, fallback);
    if (await locatorReady(locator, options.fallbackTimeoutMs ?? 1_500)) {
      return { locator, target: fallback, recovered: true };
    }
  }

  throw new Error(
    "Target could not be resolved after recovery attempts: " + describeTarget(target),
  );
}

export function describeTarget(target: Target): string {
  if (typeof target === "string") return target;
  if (target.by === "role") {
    return `role=${target.value}${target.name ? ` name="${target.name}"` : ""}`;
  }
  return `${target.by}=${target.value}`;
}
