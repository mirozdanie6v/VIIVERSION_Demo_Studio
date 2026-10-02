export type Viewport = {
  width: number;
  height: number;
};

type BaseStep = {
  label?: string;
  pauseAfterMs?: number;
};

export type DemoStep =
  | (BaseStep & { action: "goto"; url: string })
  | (BaseStep & { action: "click"; selector: string })
  | (BaseStep & { action: "fill"; selector: string; value: string })
  | (BaseStep & { action: "hover"; selector: string })
  | (BaseStep & { action: "press"; key: string; selector?: string })
  | (BaseStep & { action: "scroll"; x?: number; y: number })
  | (BaseStep & { action: "wait"; ms: number });

export type DemoScenario = {
  name: string;
  viewport?: Viewport;
  defaultPauseMs?: number;
  steps: DemoStep[];
};

export type RunResult = {
  runId: string;
  runDir: string;
  videoPath?: string;
  startedAt: string;
  finishedAt: string;
};
