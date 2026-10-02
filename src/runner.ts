import { chromium, type Page } from "playwright";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DemoScenario, DemoStep, RunResult } from "./types.js";

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

function makeRunId(name: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${stamp}-${slug || "demo"}`;
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

async function movePointerTo(page: Page, selector: string) {
  const locator = page.locator(selector).first();
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Element has no visible box: ${selector}`);

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

async function runStep(page: Page, step: DemoStep) {
  switch (step.action) {
    case "goto":
      await page.goto(step.url, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      return;
    case "click":
      await movePointerTo(page, step.selector);
      await animateClick(page);
      await page.locator(step.selector).first().click();
      return;
    case "fill":
      await movePointerTo(page, step.selector);
      await page.locator(step.selector).first().fill(step.value);
      return;
    case "hover":
      await movePointerTo(page, step.selector);
      await page.locator(step.selector).first().hover();
      return;
    case "press": {
      if (step.selector) {
        await movePointerTo(page, step.selector);
        await page.locator(step.selector).first().press(step.key);
      } else {
        await page.keyboard.press(step.key);
      }
      return;
    }
    case "scroll":
      await page.mouse.wheel(step.x ?? 0, step.y);
      return;
    case "wait":
      await page.waitForTimeout(step.ms);
      return;
  }
}

export async function runScenario(
  scenario: DemoScenario,
  options: { headed?: boolean; artifactsRoot?: string } = {},
): Promise<RunResult> {
  if (!scenario.name?.trim()) throw new Error("Scenario name is required.");
  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
    throw new Error("Scenario must contain at least one step.");
  }

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
  }> = [];

  try {
    for (let index = 0; index < scenario.steps.length; index += 1) {
      const step = scenario.steps[index];
      const stepStartedAt = new Date().toISOString();

      await runStep(page, step);

      const pause = step.pauseAfterMs ?? scenario.defaultPauseMs ?? 650;
      if (step.action !== "wait" && pause > 0) await page.waitForTimeout(pause);

      timeline.push({
        index,
        label: step.label ?? `${step.action} #${index + 1}`,
        action: step.action,
        startedAt: stepStartedAt,
        finishedAt: new Date().toISOString(),
      });
    }
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
  await writeFile(
    path.join(runDir, "run.json"),
    JSON.stringify({ scenario, timeline, startedAt, finishedAt, videoPath }, null, 2),
    "utf8",
  );

  return { runId, runDir, videoPath, startedAt, finishedAt };
}
