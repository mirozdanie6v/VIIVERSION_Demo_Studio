import assert from "node:assert/strict";
import test from "node:test";
import { buildStoryboard, extractResponseText } from "../src/director.js";
import type { DemoScenario } from "../src/types.js";

test("extracts structured response output text", () => {
  const text = extractResponseText({
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: "{\"name\":\"Demo\"}" }],
      },
    ],
  });

  assert.equal(text, '{"name":"Demo"}');
});

test("builds a human-readable storyboard", () => {
  const scenario: DemoScenario = {
    name: "Catalog demo",
    steps: [
      {
        action: "goto",
        url: "https://example.com",
        label: "Open app",
        narration: "Welcome to the application.",
      },
      {
        action: "click",
        target: { by: "role", value: "button", name: "Catalog" },
        label: "Open catalog",
      },
    ],
  };

  const storyboard = buildStoryboard(scenario);
  assert.match(storyboard, /# Catalog demo/);
  assert.match(storyboard, /Open app \[goto\]/);
  assert.match(storyboard, /Welcome to the application\./);
});
