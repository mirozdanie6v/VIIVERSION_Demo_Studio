import assert from "node:assert/strict";
import test from "node:test";
import { assertNoEnvironmentReferences, interpolate, parseScenario, resolveUrl, ScenarioValidationError } from "../src/scenario.js";

test("parses a valid scenario", () => {
  const scenario = parseScenario({
    name: "Demo",
    baseUrl: "https://example.com",
    variables: { product: "Car" },
    steps: [
      { action: "goto", url: "/" },
      { action: "click", target: { by: "role", value: "button", name: "Open" } },
      { action: "assert", target: { by: "text", value: "Car" }, assertion: "visible" },
    ],
  });

  assert.equal(scenario.name, "Demo");
  assert.equal(scenario.steps.length, 3);
});

test("reports useful validation failures", () => {
  assert.throws(
    () => parseScenario({ name: "", steps: [] }),
    (error: unknown) =>
      error instanceof ScenarioValidationError &&
      error.problems.some((problem) => problem.includes("name")) &&
      error.problems.some((problem) => problem.includes("steps")),
  );
});

test("interpolates scenario and environment variables", () => {
  const value = interpolate(
    "Hello {{var.name}} at {{env.HOST}}",
    { name: "VIIVERSION" },
    { HOST: "demo.viiversion.com" },
  );
  assert.equal(value, "Hello VIIVERSION at demo.viiversion.com");
});

test("resolves relative URLs against baseUrl", () => {
  assert.equal(resolveUrl("/catalog", "https://demo.viiversion.com/app"), "https://demo.viiversion.com/catalog");
});


test("rejects environment references in externally generated scenarios", () => {
  assert.throws(
    () =>
      assertNoEnvironmentReferences({
        name: "Unsafe",
        steps: [
          {
            action: "fill",
            target: { by: "role", value: "textbox", name: "Email" },
            value: "{{env.PRIVATE_VALUE}}",
          },
        ],
      }),
    /Environment references are not allowed/,
  );
});


test("parses multilingual voice configuration", () => {
  const scenario = parseScenario({
    name: "Global demo",
    voice: {
      locale: "vi-VN",
      provider: "auto",
      persona: "viiversion-presenter",
      requireNativeTimings: true,
      pronunciation: {
        "VIIVERSION": "vee version",
      },
    },
    steps: [
      {
        action: "wait",
        ms: 1000,
        narration: "Welcome",
        voiceText: "Welcome",
      },
    ],
  });

  assert.equal(scenario.voice?.locale, "vi-VN");
  assert.equal(scenario.voice?.provider, "auto");
  assert.equal(scenario.steps[0].voiceText, "Welcome");
});
