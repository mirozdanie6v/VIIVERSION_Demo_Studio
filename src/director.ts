import { inspectApplication, type ApplicationSnapshot } from "./inspector.js";
import { assertNoEnvironmentReferences, parseScenario } from "./scenario.js";
import type { DemoScenario, Viewport } from "./types.js";

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "baseUrl", "viewport", "steps"],
  properties: {
    name: { type: "string" },
    baseUrl: { type: "string" },
    viewport: {
      type: "object",
      additionalProperties: false,
      required: ["width", "height"],
      properties: {
        width: { type: "number" },
        height: { type: "number" },
      },
    },
    steps: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["goto", "click", "fill", "hover", "press", "scroll", "wait", "waitFor", "waitForNavigation", "assert"],
          },
          url: { type: "string" },
          target: {
            anyOf: [
              { type: "string" },
              {
                type: "object",
                additionalProperties: false,
                required: ["by", "value"],
                properties: {
                  by: { type: "string", enum: ["css", "text", "role", "testId"] },
                  value: { type: "string" },
                  name: { type: "string" },
                  exact: { type: "boolean" },
                },
              },
            ],
          },
          value: { type: "string" },
          key: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          ms: { type: "number" },
          state: { type: "string", enum: ["visible", "hidden", "attached", "detached"] },
          waitUntil: { type: "string", enum: ["load", "domcontentloaded", "networkidle"] },
          timeoutMs: { type: "number" },
          assertion: { type: "string", enum: ["visible", "hidden", "textContains", "valueEquals"] },
          expected: { type: "string" },
          label: { type: "string" },
          narration: { type: "string" },
          pauseAfterMs: { type: "number" },
        },
        required: ["action"],
      },
    },
  },
} as const;

type DirectorResponse = {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

export type DirectorOptions = {
  apiKey?: string;
  model?: string;
  viewport?: Viewport;
};

export type DirectorResult = {
  scenario: DemoScenario;
  storyboard: string;
  snapshot: ApplicationSnapshot;
};

export function extractResponseText(response: DirectorResponse): string {
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

export function buildStoryboard(scenario: DemoScenario): string {
  const lines = scenario.steps.map((step, index) => {
    const title = step.label ?? step.action + " #" + (index + 1);
    const narration = step.narration ? " — " + step.narration : "";
    return (index + 1) + ". " + title + " [" + step.action + "]" + narration;
  });

  return ["# " + scenario.name, "", ...lines].join("\n");
}

export async function planDemo(
  url: string,
  goal: string,
  options: DirectorOptions = {},
): Promise<DirectorResult> {
  if (!goal.trim()) throw new Error("Demo goal is required.");

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for AI Director.");

  const snapshot = await inspectApplication(
    url,
    options.viewport ?? { width: 1440, height: 900 },
  );

  const prompt = [
    "Goal: " + goal,
    "",
    "Build a short, polished product-demo scenario using only UI represented in the snapshot.",
    "Prefer the exact target objects supplied in snapshot.elements[].target.",
    "Start with goto. Add waits only when useful.",
    "Avoid destructive actions, purchases, irreversible submissions, account deletion, or sending real messages.",
    "Give customer-facing steps a concise label and a natural narration sentence.",
    "Keep the demo focused on the requested story.",
    "",
    "APPLICATION SNAPSHOT:",
    JSON.stringify(snapshot),
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model ?? process.env.OPENAI_DIRECTOR_MODEL ?? "gpt-5.6-luna",
      instructions:
        "You are the VIIVERSION Demo Studio AI Director. Convert a web application snapshot and presentation goal into a deterministic Playwright demo scenario.",
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "viiversion_demo_scenario",
          schema: PLAN_SCHEMA,
          strict: false,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      "OpenAI Responses request failed (" + response.status + "): " + (await response.text()),
    );
  }

  const payload = await response.json() as DirectorResponse;
  const output = extractResponseText(payload);
  if (!output) throw new Error("AI Director returned no scenario text.");

  const raw = JSON.parse(output) as Record<string, unknown>;
  raw.baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl : snapshot.url;
  raw.viewport = raw.viewport ?? snapshot.viewport;
  raw.presentation = {
    semanticCamera: {
      enabled: true,
      establishScale: 1,
      focusScale: 1.1,
      mobileFocusScale: 1.1,
      safeAreaPx: 44,
      focusTransitionMs: 240,
      resolveTransitionMs: 300,
    },
    smartZoom: { enabled: false },
    cursor: { enabled: false },
    focusRing: {
      enabled: true,
      color: "rgba(255,166,92,0.28)",
      width: 1,
      padding: 5,
    },
    clickRipple: { enabled: false },
    tactilePress: {
      enabled: true,
      scale: 0.985,
      durationMs: 190,
      glowColor: "rgba(255,151,72,0.30)",
    },
  };

  assertNoEnvironmentReferences(raw);
  const scenario = parseScenario(raw);
  return {
    scenario,
    storyboard: buildStoryboard(scenario),
    snapshot,
  };
}
