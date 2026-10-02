export type Viewport = {
  width: number;
  height: number;
};

export type Target = string | {
  by: "css" | "text" | "role" | "testId";
  value: string;
  name?: string;
  exact?: boolean;
};

type BaseStep = {
  label?: string;
  pauseAfterMs?: number;
};

type TargetStep = {
  target?: Target;
  selector?: string;
};

export type DemoStep =
  | (BaseStep & { action: "goto"; url: string })
  | (BaseStep & TargetStep & { action: "click" })
  | (BaseStep & TargetStep & { action: "fill"; value: string })
  | (BaseStep & TargetStep & { action: "hover" })
  | (BaseStep & TargetStep & { action: "press"; key: string })
  | (BaseStep & { action: "scroll"; x?: number; y: number })
  | (BaseStep & { action: "wait"; ms: number })
  | (BaseStep & {
      action: "waitFor";
      target: Target;
      state?: "visible" | "hidden" | "attached" | "detached";
      timeoutMs?: number;
    })
  | (BaseStep & {
      action: "waitForNavigation";
      waitUntil?: "load" | "domcontentloaded" | "networkidle";
      timeoutMs?: number;
    })
  | (BaseStep & {
      action: "assert";
      target: Target;
      assertion: "visible" | "hidden" | "textContains" | "valueEquals";
      expected?: string;
    });

export type DemoScenario = {
  name: string;
  baseUrl?: string;
  viewport?: Viewport;
  defaultPauseMs?: number;
  variables?: Record<string, string>;
  steps: DemoStep[];
};

export type RunResult = {
  runId: string;
  runDir: string;
  videoPath?: string;
  startedAt: string;
  finishedAt: string;
  success: boolean;
};
