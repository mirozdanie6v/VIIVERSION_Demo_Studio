import { chromium, type Page } from "playwright";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { animateClick, focusTarget, resetPresentation } from "./presentation.js";
import { attachNetworkGuard } from "./security.js";
import { describeTarget, resolveTarget, resolveTargetWithRecovery } from "./targets.js";
import {
  interpolate,
  interpolateTarget,
  normalizeLegacyTarget,
  resolveUrl,
} from "./scenario.js";
import type { CameraFrame, DemoScenario, DemoStep, RunResult, Target } from "./types.js";

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

type StepExecution = {
  camera?: CameraFrame;
  recovery?: {
    original: Target;
    resolved: Target;
  };
};

async function applyLocaleOverlayNow(
  page: Page,
  scenario: DemoScenario,
): Promise<void> {
  const overlay = scenario.presentation?.localeOverlay;
  if (!overlay) return;

  await page.evaluate(({ language, replacements }) => {
    document.documentElement.lang = language;
    const pairs = Object.entries(replacements)
      .filter(([source, translated]) => source && translated)
      .sort((a, b) => b[0].length - a[0].length);

    const translate = (value: string) => {
      let next = value;
      for (const [source, translated] of pairs) {
        if (next.includes(source)) next = next.split(source).join(translated);
      }
      return next;
    };

    const walker = document.createTreeWalker(
      document.documentElement,
      NodeFilter.SHOW_TEXT,
    );
    const nodes: Node[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const current = node.nodeValue ?? "";
      const next = translate(current);
      if (next !== current) node.nodeValue = next;
    }

    for (const element of Array.from(document.querySelectorAll("*"))) {
      for (const attribute of ["placeholder", "aria-label", "title", "alt"]) {
        const current = element.getAttribute(attribute);
        if (!current) continue;
        const next = translate(current);
        if (next !== current) element.setAttribute(attribute, next);
      }
    }
  }, overlay);
}

async function runStep(
  page: Page,
  step: DemoStep,
  scenario: DemoScenario,
): Promise<StepExecution> {
  const variables = scenario.variables ?? {};

  switch (step.action) {
    case "goto": {
      const rawUrl = interpolate(step.url, variables);
      const baseUrl = scenario.baseUrl ? interpolate(scenario.baseUrl, variables) : undefined;
      await page.goto(resolveUrl(rawUrl, baseUrl), { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      return {};
    }
    case "click": {
      const target = requiredTarget(step, scenario);
      const resolved = await resolveTargetWithRecovery(page, target);
      const camera = await focusTarget(page, resolved.target, scenario.presentation);
      await animateClick(page, resolved.target, scenario.presentation);
      await resolved.locator.click();
      if (scenario.presentation?.semanticCamera?.enabled) {
        await page.waitForTimeout(90);
        await resetPresentation(page, scenario.presentation);
      }
      return {
        camera,
        recovery: resolved.recovered
          ? { original: target, resolved: resolved.target }
          : undefined,
      };
    }
    case "fill": {
      const target = requiredTarget(step, scenario);
      const resolved = await resolveTargetWithRecovery(page, target);
      const camera = await focusTarget(page, resolved.target, scenario.presentation);
      await resolved.locator.fill(interpolate(step.value, variables));
      return {
        camera,
        recovery: resolved.recovered
          ? { original: target, resolved: resolved.target }
          : undefined,
      };
    }
    case "hover": {
      const target = requiredTarget(step, scenario);
      const resolved = await resolveTargetWithRecovery(page, target);
      const camera = await focusTarget(page, resolved.target, scenario.presentation);
      await resolved.locator.hover();
      return {
        camera,
        recovery: resolved.recovered
          ? { original: target, resolved: resolved.target }
          : undefined,
      };
    }
    case "press": {
      const target = normalizeLegacyTarget(step);
      const key = interpolate(step.key, variables);
      if (target) {
        const original = interpolateTarget(target, variables);
        const resolved = await resolveTargetWithRecovery(page, original);
        const camera = await focusTarget(page, resolved.target, scenario.presentation);
        await resolved.locator.press(key);
        return {
          camera,
          recovery: resolved.recovered
            ? { original, resolved: resolved.target }
            : undefined,
        };
      }

      await page.keyboard.press(key);
      return {};
    }
    case "scroll":
      if (scenario.presentation?.semanticCamera?.enabled) {
        await resetPresentation(page, scenario.presentation);
      }
      await page.mouse.wheel(step.x ?? 0, step.y);
      return {};
    case "wait":
      await page.waitForTimeout(step.ms);
      return {};
    case "waitFor": {
      const target = interpolateTarget(step.target, variables);
      if ((step.state ?? "visible") === "visible") {
        const resolved = await resolveTargetWithRecovery(page, target, {
          primaryTimeoutMs: step.timeoutMs ?? 10_000,
        });
        return {
          recovery: resolved.recovered
            ? { original: target, resolved: resolved.target }
            : undefined,
        };
      }

      await resolveTarget(page, target).waitFor({
        state: step.state,
        timeout: step.timeoutMs ?? 10_000,
      });
      return {};
    }
    case "waitForNavigation":
      await page.waitForLoadState(step.waitUntil ?? "domcontentloaded", {
        timeout: step.timeoutMs ?? 15_000,
      });
      return {};
    case "waitForContentGrowth": {
      const raw = normalizeLegacyTarget(step) ?? ({ by: "css", value: "body" } as Target);
      const target = interpolateTarget(raw, variables);
      const resolved = await resolveTargetWithRecovery(page, target, {
        primaryTimeoutMs: 5_000,
      });
      const baseline = ((await resolved.locator.innerText().catch(() => "")) ?? "").trim();
      const minAddedChars = Math.max(1, step.minAddedChars ?? 80);
      const timeoutMs = step.timeoutMs ?? 30_000;
      await page.waitForFunction(
        ({ baseline, minAddedChars, selector }) => {
          const el = document.querySelector(selector);
          if (!el) return false;
          const current = (el.textContent ?? "").trim();
          return current.length >= baseline.length + minAddedChars;
        },
        {
          baseline,
          minAddedChars,
          selector:
            typeof resolved.target === "string"
              ? resolved.target
              : resolved.target.by === "css"
                ? resolved.target.value
                : "body",
        },
        { timeout: timeoutMs },
      );
      return {
        recovery: resolved.recovered
          ? { original: target, resolved: resolved.target }
          : undefined,
      };
    }
    case "assert":
      await runAssertion(page, step, scenario);
      return {};
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
  await attachNetworkGuard(context);

  const localeOverlay = scenario.presentation?.localeOverlay;
  if (localeOverlay) {
    await context.addInitScript(
      ({ language, replacements }) => {
        const pairs = Object.entries(replacements)
          .filter(([source, translated]) => source && translated)
          .sort((a, b) => b[0].length - a[0].length);

        const translateString = (value: string) => {
          let next = value;
          for (const [source, translated] of pairs) {
            if (next.includes(source)) next = next.split(source).join(translated);
          }
          return next;
        };

        const translateNode = (root: Node) => {
          if (root.nodeType === Node.TEXT_NODE) {
            const current = root.nodeValue ?? "";
            const next = translateString(current);
            if (next !== current) root.nodeValue = next;
            return;
          }

          if (!(root instanceof Element) && !(root instanceof Document)) return;

          const container = root instanceof Document ? root.documentElement : root;
          if (!container) return;

          const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
          const textNodes: Node[] = [];
          while (walker.nextNode()) textNodes.push(walker.currentNode);
          for (const node of textNodes) {
            const current = node.nodeValue ?? "";
            const next = translateString(current);
            if (next !== current) node.nodeValue = next;
          }

          const elements = [
            ...(container instanceof Element ? [container] : []),
            ...Array.from(container.querySelectorAll("*")),
          ];
          for (const element of elements) {
            for (const attribute of ["placeholder", "aria-label", "title", "alt"]) {
              const current = element.getAttribute(attribute);
              if (!current) continue;
              const next = translateString(current);
              if (next !== current) element.setAttribute(attribute, next);
            }
          }
        };

        const install = () => {
          document.documentElement.lang = language;
          translateNode(document);
          const observer = new MutationObserver((records) => {
            for (const record of records) {
              if (record.type === "characterData") {
                translateNode(record.target);
                continue;
              }
              for (const node of Array.from(record.addedNodes)) translateNode(node);
            }
          });
          observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            characterData: true,
          });
        };

        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", install, { once: true });
        } else {
          install();
        }
      },
      localeOverlay,
    );
  }

  const page = await context.newPage();
  const video = page.video();

  const timeline: Array<{
    index: number;
    label: string;
    action: DemoStep["action"];
    startedAt: string;
    finishedAt: string;
    success: boolean;
    camera?: CameraFrame;
    recovery?: {
      original: Target;
      resolved: Target;
    };
    error?: string;
  }> = [];

  let runError: unknown;

  try {
    for (let index = 0; index < scenario.steps.length; index += 1) {
      const step = scenario.steps[index];
      const stepStartedAt = new Date().toISOString();

      try {
        await applyLocaleOverlayNow(page, scenario).catch(() => undefined);
        const execution = await runStep(page, step, scenario);

        const pause = step.pauseAfterMs ?? scenario.defaultPauseMs ?? 650;
        if (!["wait", "waitFor", "waitForNavigation"].includes(step.action) && pause > 0) {
          await page.waitForTimeout(pause);
        }

        if (execution.camera && !scenario.presentation?.semanticCamera?.enabled) {
          await resetPresentation(page, scenario.presentation);
        }

        await applyLocaleOverlayNow(page, scenario).catch(() => undefined);
        await page.waitForTimeout(40);
        await applyLocaleOverlayNow(page, scenario).catch(() => undefined);

        timeline.push({
          index,
          label: step.label ?? `${step.action} #${index + 1}`,
          action: step.action,
          startedAt: stepStartedAt,
          finishedAt: new Date().toISOString(),
          success: true,
          camera: execution.camera,
          recovery: execution.recovery,
        });
      } catch (error) {
        await resetPresentation(page, scenario.presentation).catch(() => undefined);

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
