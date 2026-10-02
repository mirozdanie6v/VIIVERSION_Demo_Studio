import { chromium, type Page } from "playwright";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { describeTarget, resolveTarget } from "./targets.js";
import {
  interpolate,
  interpolateTarget,
  normalizeLegacyTarget,
  resolveUrl,
} from "./scenario.js";
import type { DemoScenario, DemoStep, RunResult, Target } from "./types.js";

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

function makeRunId(name: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${stamp}-${slug || "demo"}`;
}

function requiredTarget(step: DemoStep, scenario: DemoScenario): Target {
  const raw = normalizeLegacyTarget(step);
  if (!raw) throw new Error(`Step "${step.action}" requires a target.`);
  return interpolateTarget(raw, scenario.variables ?? {});
}

async function ensurePointerOverlay(page: Page) {
  await page.evaluate(() => {
    if (document.getElementById("viiversion-demo-pointer")) return;

    const style = document.createElement("style");
    style.id = "viiversion-demo-style";
    style.textContent = `
      #viiversion-demo-pointer {
        position: fixed;
        width: 18px;
        height: 18px;
        border: 3px solid white;
        border-radius: 999px;
        background: rgba(0,0,0,.78);
        box-shadow: 0 2px 14px rgba(0,0,0,.35);
        transform: translate(-50%, -50%);
        z-index: 2147483647;
        pointer-events: none;
        left: 50%;
        top: 50%;
        transition: left .34s cubic-bezier(.2,.8,.2,1), top .34s cubic-bezier(.2,.8,.2,1), transform .14s ease;
      }
      #viiversion-demo-pointer.viiversion-click {
        transform: translate(-50%, -50%) scale(.68);
      }
    `;
    document.documentElement.appendChild(style);

    const pointer = document.createElement("div");
    pointer.id = "viiversion-demo-pointer";
    document.documentElement.appendChild(pointer);
  });
}

async function movePointerTo(page: Page, target: Target) {
  const locator = resolveTarget(page, target);
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Element has no visible box: ${describeTarget(target)}`);

  await ensurePointerOverlay(page);
  await page.evaluate(
    ({ x, y }) => {
      const pointer = document.getElementById("viiversion-demo-pointer");
      if (!pointer) return;
      pointer.style.left = `${x}px`;
      pointer.style.top = `${y}px`;
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  await page.waitForTimeout(380);
}

async function animateClick(page: Page) {
  await page.evaluate(() => {
    document.getElementById("viiversion-demo-pointer")?.classList.add("viiversion-click");
  });
  await page.waitForTimeout(110);
  await page.evaluate(() => {
    document.getElementById("viiversion-demo-pointer")?.classList.remove("viiversion-click");
  });
}

async function runAssertion(page: Page, step: Extract<DemoStep, { action: "assert" }>, scenario: DemoScenario) {
  const target = interpolateTarget(step.target, scenario.variables ?? {});
  const locator = resolveTarget(page, target);

  switch (step.assertion) {
    case "visible":
      if (!(await locator.isVisible())) {
        throw new Error(`Assertion failed: ${describeTarget(target)} is not visible.`);
      }
      return;
    case "hidden":
      if (await locator.isVisible()) {
        throw new Error(`Assertion failed: ${describeTarget(target)} is visible.`);
      }
      return;
    case "textContains": {
      const expected = interpolate(step.expected ?? "", scenario.variables ?? {});
      const actual = (await locator.textContent()) ?? "";
      if (!actual.includes(expected)) {
        throw new Error(
          `Assertion failed: ${describeTarget(target)} text does not contain "${expected}". Actual: "${actual}".`,
        );
      }
      return;
    }
    case "valueEquals": {
      const expected = interpolate(step.expected ?? "", scenario.variables ?? {});
      const actual = await locator.inputValue();
      if (actual !== expected) {
        throw new Error(
          `Assertion failed: ${describeTarget(target)} value "${actual}" !== "${expected}".`,
        );
      }
      return;
    }
  }
}

async function runStep(page: Page, step: DemoStep, scenario: DemoScenario) {
  const variables = scenario.variables ?? {};

  switch (step.action) {
    case "goto": {
      const rawUrl = interpolate(step.url, variables);
      const baseUrl = scenario.baseUrl ? interpolate(scenario.baseUrl, variables) : undefined;
      await page.goto(resolveUrl(rawUrl, baseUrl), { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      return;
    }
    case "click": {
      const target = requiredTarget(step, scenario);
      await movePointerTo(page, target);
      await animateClick(page);
      await resolveTarget(page, target).click();
      return;
    }
    case "fill": {
      const target = requiredTarget(step, scenario);
      await movePointerTo(page, target);
      await resolveTarget(page, target).fill(interpolate(step.value, variables));
      return;
    }
    case "hover": {
      const target = requiredTarget(step, scenario);
      await movePointerTo(page, target);
      await resolveTarget(page, target).hover();
      return;
    }
    case "press": {
      const target = normalizeLegacyTarget(step);
      const key = interpolate(step.key, variables);
      if (target) {
        const resolved = interpolateTarget(target, variables);
        await movePointerTo(page, resolved);
        await resolveTarget(page, resolved).press(key);
      } else {
        await page.keyboard.press(key);
      }
      return;
    }
    case "scroll":
      await page.mouse.wheel(step.x ?? 0, step.y);
      return;
    case "wait":
      await page.waitForTimeout(step.ms);
      return;
    case "waitFor": {
      const target = interpolateTarget(step.target, variables);
      await resolveTarget(page, target).waitFor({
        state: step.state ?? "visible",
        timeout: step.timeoutMs ?? 10_000,
      });
      return;
    }
    case "waitForNavigation":
      await page.waitForLoadState(step.waitUntil ?? "domcontentloaded", {
        timeout: step.timeoutMs ?? 15_000,
      });
      return;
    case "assert":
      await runAssertion(page, step, scenario);
      return;
  }
}

export async function runScenario(
  scenario: DemoScenario,
  options: { headed?: boolean; artifactsRoot?: string } = {},
): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const runId = makeRunId(scenario.name);
  const runDir = path.resolve(options.artifactsRoot ?? "artifacts", runId);
  await mkdir(runDir, { recursive: true });

  const viewport = scenario.viewport ?? DEFAULT_VIEWPORT;
  const browser = await chromium.launch({ headless: !options.headed });
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: runDir, size: viewport },
  });

  const page = await context.newPage();
  const video = page.video();

  const timeline: Array<{
    index: number;
    label: string;
    action: DemoStep["action"];
    startedAt: string;
    finishedAt: string;
    success: boolean;
    error?: string;
  }> = [];

  let runError: unknown;

  try {
    for (let index = 0; index < scenario.steps.length; index += 1) {
      const step = scenario.steps[index];
      const stepStartedAt = new Date().toISOString();

      try {
        await runStep(page, step, scenario);

        const pause = step.pauseAfterMs ?? scenario.defaultPauseMs ?? 650;
        if (!["wait", "waitFor", "waitForNavigation"].includes(step.action) && pause > 0) {
          await page.waitForTimeout(pause);
        }

        timeline.push({
          index,
          label: step.label ?? `${step.action} #${index + 1}`,
          action: step.action,
          startedAt: stepStartedAt,
          finishedAt: new Date().toISOString(),
          success: true,
        });
      } catch (error) {
        timeline.push({
          index,
          label: step.label ?? `${step.action} #${index + 1}`,
          action: step.action,
          startedAt: stepStartedAt,
          finishedAt: new Date().toISOString(),
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  } catch (error) {
    runError = error;
  } finally {
    await context.close();
    await browser.close();
  }

  let videoPath: string | undefined;
  if (video) {
    const generatedPath = await video.path();
    videoPath = path.join(runDir, "capture.webm");
    if (generatedPath !== videoPath) {
      await rename(generatedPath, videoPath);
    }
  }

  const finishedAt = new Date().toISOString();
  const success = runError === undefined;

  await writeFile(
    path.join(runDir, "run.json"),
    JSON.stringify({
      scenario,
      timeline,
      startedAt,
      finishedAt,
      videoPath,
      success,
      error: runError instanceof Error ? runError.message : runError ? String(runError) : undefined,
    }, null, 2),
    "utf8",
  );

  if (runError) throw runError;
  return { runId, runDir, videoPath, startedAt, finishedAt, success };
}
