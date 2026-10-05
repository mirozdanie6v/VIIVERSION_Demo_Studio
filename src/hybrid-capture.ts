import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type { DemoScenario, DemoStep } from "./types.js";

export type HybridStepMode = "keyframe" | "realtime" | "passive";

export type HybridStepPlan = {
  index: number;
  action: DemoStep["action"];
  label: string;
  mode: HybridStepMode;
  reason: string;
};

export type HybridKeyframe = {
  stepIndex: number;
  action: DemoStep["action"];
  mode: HybridStepMode;
  path: string;
  capturedAt: string;
};

const REALTIME_ACTIONS = new Set<DemoStep["action"]>([
  "hover",
  "scroll",
  "wait",
  "waitFor",
  "waitForNavigation",
  "waitForContentGrowth",
]);

const SETTLE_ACTIONS = new Set<DemoStep["action"]>([
  "wait",
  "waitFor",
  "waitForNavigation",
  "waitForContentGrowth",
]);

function truthy(value: string | undefined): boolean {
  return ["1", "true", "on", "yes"].includes(value?.trim().toLowerCase() ?? "");
}

export function hybridCaptureEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return truthy(env.DEMO_STUDIO_HYBRID_CAPTURE);
}

export function planHybridCapture(scenario: DemoScenario): HybridStepPlan[] {
  return scenario.steps.map((step, index) => {
    const label = step.label ?? `${step.action} #${index + 1}`;

    if (step.action === "assert") {
      return {
        index,
        action: step.action,
        label,
        mode: "passive",
        reason: "assertion has no visual motion to preserve",
      };
    }

    if (REALTIME_ACTIONS.has(step.action)) {
      return {
        index,
        action: step.action,
        label,
        mode: "realtime",
        reason:
          step.action === "waitForContentGrowth"
            ? "async content growth must remain real-time"
            : step.action === "waitFor" || step.action === "waitForNavigation"
              ? "async readiness boundary must remain real-time"
              : step.action === "wait"
                ? "explicit scenario timing must remain real-time"
                : "visible motion is retained as real-time capture",
      };
    }

    if (step.action === "click") {
      const next = scenario.steps[index + 1];
      if (!next || !SETTLE_ACTIONS.has(next.action)) {
        return {
          index,
          action: step.action,
          label,
          mode: "realtime",
          reason: "click has no following readiness boundary, so preserve live transition",
        };
      }
    }

    return {
      index,
      action: step.action,
      label,
      mode: "keyframe",
      reason: "stable UI state can be represented by a captured keyframe",
    };
  });
}

export function hybridScenarioForExecution(
  scenario: DemoScenario,
): DemoScenario {
  return {
    ...scenario,
    presentation: {
      ...scenario.presentation,
      enabled: false,
      smartZoom: {
        ...scenario.presentation?.smartZoom,
        transitionMs: 0,
        settleMs: 0,
      },
      clickRipple: {
        ...scenario.presentation?.clickRipple,
        durationMs: 0,
      },
    },
  };
}

export function resolvedStepPauseMs(
  step: DemoStep,
  scenario: DemoScenario,
  plan: HybridStepPlan | undefined,
): number {
  if (plan?.mode === "keyframe" || plan?.mode === "passive") return 0;
  return step.pauseAfterMs ?? scenario.defaultPauseMs ?? 650;
}

export async function captureHybridKeyframe(
  page: Page,
  runDir: string,
  plan: HybridStepPlan,
): Promise<HybridKeyframe | undefined> {
  if (plan.mode === "passive") return undefined;

  const dir = path.join(runDir, "hybrid-keyframes");
  await mkdir(dir, { recursive: true });
  const safeAction = plan.action.replace(/[^a-zA-Z0-9_-]+/g, "-");
  const filename = `${String(plan.index).padStart(3, "0")}-${safeAction}.png`;
  const outputPath = path.join(dir, filename);

  await page.screenshot({
    path: outputPath,
    animations: "disabled",
    caret: "hide",
  });

  return {
    stepIndex: plan.index,
    action: plan.action,
    mode: plan.mode,
    path: outputPath,
    capturedAt: new Date().toISOString(),
  };
}

export async function writeHybridCaptureManifest(
  runDir: string,
  scenario: DemoScenario,
  plan: HybridStepPlan[],
  keyframes: HybridKeyframe[],
  startedAt: string,
  finishedAt: string,
): Promise<string> {
  const manifestPath = path.join(runDir, "hybrid_capture.json");
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        experimental: true,
        scenarioName: scenario.name,
        startedAt,
        finishedAt,
        plan,
        keyframes,
        counts: {
          keyframeSteps: plan.filter((item) => item.mode === "keyframe").length,
          realtimeSteps: plan.filter((item) => item.mode === "realtime").length,
          passiveSteps: plan.filter((item) => item.mode === "passive").length,
          capturedFrames: keyframes.length,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return manifestPath;
}
