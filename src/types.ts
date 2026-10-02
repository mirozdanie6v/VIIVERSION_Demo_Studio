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

export type PresentationConfig = {
  enabled?: boolean;
  smartZoom?: {
    enabled?: boolean;
    scale?: number;
    mobileScale?: number;
    transitionMs?: number;
    settleMs?: number;
  };
  cursor?: {
    size?: number;
    fill?: string;
    border?: string;
    borderWidth?: number;
    shadow?: string;
  };
  focusRing?: {
    enabled?: boolean;
    color?: string;
    width?: number;
    padding?: number;
  };
  clickRipple?: {
    enabled?: boolean;
    color?: string;
    size?: number;
    durationMs?: number;
  };
};

export type CameraFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  scale: number;
  viewportWidth: number;
  viewportHeight: number;
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
  presentation?: PresentationConfig;
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
