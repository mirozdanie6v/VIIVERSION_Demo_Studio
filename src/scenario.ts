import type { DemoScenario, DemoStep, Target } from "./types.js";

export class ScenarioValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Scenario validation failed:\n- ${problems.join("\n- ")}`);
    this.name = "ScenarioValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateTarget(target: unknown, path: string, problems: string[]) {
  if (isNonEmptyString(target)) return;

  if (!isRecord(target)) {
    problems.push(`${path} must be a selector string or a target object.`);
    return;
  }

  const by = target.by;
  if (!["css", "text", "role", "testId"].includes(String(by))) {
    problems.push(`${path}.by must be one of css, text, role, testId.`);
    return;
  }

  if (!isNonEmptyString(target.value)) {
    problems.push(`${path}.value must be a non-empty string.`);
  }

  if (by === "role" && target.name !== undefined && !isNonEmptyString(target.name)) {
    problems.push(`${path}.name must be a non-empty string when provided.`);
  }

  if (target.exact !== undefined && typeof target.exact !== "boolean") {
    problems.push(`${path}.exact must be boolean when provided.`);
  }
}

function validateOptionalBoolean(value: unknown, path: string, problems: string[]) {
  if (value !== undefined && typeof value !== "boolean") problems.push(`${path} must be boolean.`);
}

function validateOptionalNumber(
  value: unknown,
  path: string,
  problems: string[],
  options: { min?: number } = {},
) {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    problems.push(`${path} must be a finite number.`);
    return;
  }
  if (options.min !== undefined && value < options.min) {
    problems.push(`${path} must be >= ${options.min}.`);
  }
}

function validateOptionalString(value: unknown, path: string, problems: string[]) {
  if (value !== undefined && !isNonEmptyString(value)) {
    problems.push(`${path} must be a non-empty string.`);
  }
}

function validateVoice(value: unknown, problems: string[]) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    problems.push("voice must be an object.");
    return;
  }

  if (!isNonEmptyString(value.locale)) {
    problems.push("voice.locale must be a non-empty BCP-47 locale string.");
  }

  if (
    value.provider !== undefined &&
    !["auto", "huggingface", "elevenlabs", "openai", "piper"].includes(String(value.provider))
  ) {
    problems.push("voice.provider must be auto, huggingface, elevenlabs, openai or piper.");
  }

  if (
    value.persona !== undefined &&
    !["viiversion-presenter", "neutral"].includes(String(value.persona))
  ) {
    problems.push("voice.persona must be viiversion-presenter or neutral.");
  }

  validateOptionalString(value.voiceId, "voice.voiceId", problems);
  validateOptionalString(value.model, "voice.model", problems);
  validateOptionalString(value.instructions, "voice.instructions", problems);
  validateOptionalBoolean(
    value.requireNativeTimings,
    "voice.requireNativeTimings",
    problems,
  );

  if (value.pronunciation !== undefined) {
    if (!isRecord(value.pronunciation)) {
      problems.push("voice.pronunciation must be an object.");
    } else {
      for (const [key, replacement] of Object.entries(value.pronunciation)) {
        if (!key.trim() || !isNonEmptyString(replacement)) {
          problems.push(
            "voice.pronunciation keys and replacements must be non-empty strings.",
          );
          break;
        }
      }
    }
  }
}

function validatePresentation(value: unknown, problems: string[]) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    problems.push("presentation must be an object.");
    return;
  }

  validateOptionalBoolean(value.enabled, "presentation.enabled", problems);

  if (value.smartZoom !== undefined) {
    if (!isRecord(value.smartZoom)) {
      problems.push("presentation.smartZoom must be an object.");
    } else {
      validateOptionalBoolean(value.smartZoom.enabled, "presentation.smartZoom.enabled", problems);
      validateOptionalNumber(value.smartZoom.scale, "presentation.smartZoom.scale", problems, { min: 1 });
      validateOptionalNumber(value.smartZoom.mobileScale, "presentation.smartZoom.mobileScale", problems, { min: 1 });
      validateOptionalNumber(value.smartZoom.transitionMs, "presentation.smartZoom.transitionMs", problems, { min: 0 });
      validateOptionalNumber(value.smartZoom.settleMs, "presentation.smartZoom.settleMs", problems, { min: 0 });
    }
  }

  if (value.semanticCamera !== undefined) {
    if (!isRecord(value.semanticCamera)) {
      problems.push("presentation.semanticCamera must be an object.");
    } else {
      validateOptionalBoolean(value.semanticCamera.enabled, "presentation.semanticCamera.enabled", problems);
      validateOptionalNumber(value.semanticCamera.establishScale, "presentation.semanticCamera.establishScale", problems, { min: 1 });
      validateOptionalNumber(value.semanticCamera.focusScale, "presentation.semanticCamera.focusScale", problems, { min: 1 });
      validateOptionalNumber(value.semanticCamera.mobileFocusScale, "presentation.semanticCamera.mobileFocusScale", problems, { min: 1 });
      validateOptionalNumber(value.semanticCamera.maxCropRatio, "presentation.semanticCamera.maxCropRatio", problems, { min: 0 });
      validateOptionalNumber(value.semanticCamera.safeAreaPx, "presentation.semanticCamera.safeAreaPx", problems, { min: 0 });
      validateOptionalNumber(value.semanticCamera.focusTransitionMs, "presentation.semanticCamera.focusTransitionMs", problems, { min: 0 });
      validateOptionalNumber(value.semanticCamera.resolveTransitionMs, "presentation.semanticCamera.resolveTransitionMs", problems, { min: 0 });
    }
  }

  if (value.cursor !== undefined) {
    if (!isRecord(value.cursor)) {
      problems.push("presentation.cursor must be an object.");
    } else {
      validateOptionalBoolean(value.cursor.enabled, "presentation.cursor.enabled", problems);
      validateOptionalNumber(value.cursor.size, "presentation.cursor.size", problems, { min: 1 });
      validateOptionalNumber(value.cursor.borderWidth, "presentation.cursor.borderWidth", problems, { min: 0 });
      validateOptionalString(value.cursor.fill, "presentation.cursor.fill", problems);
      validateOptionalString(value.cursor.border, "presentation.cursor.border", problems);
      validateOptionalString(value.cursor.shadow, "presentation.cursor.shadow", problems);
    }
  }

  if (value.focusRing !== undefined) {
    if (!isRecord(value.focusRing)) {
      problems.push("presentation.focusRing must be an object.");
    } else {
      validateOptionalBoolean(value.focusRing.enabled, "presentation.focusRing.enabled", problems);
      validateOptionalNumber(value.focusRing.width, "presentation.focusRing.width", problems, { min: 0 });
      validateOptionalNumber(value.focusRing.padding, "presentation.focusRing.padding", problems, { min: 0 });
      validateOptionalString(value.focusRing.color, "presentation.focusRing.color", problems);
    }
  }

  if (value.clickRipple !== undefined) {
    if (!isRecord(value.clickRipple)) {
      problems.push("presentation.clickRipple must be an object.");
    } else {
      validateOptionalBoolean(value.clickRipple.enabled, "presentation.clickRipple.enabled", problems);
      validateOptionalNumber(value.clickRipple.size, "presentation.clickRipple.size", problems, { min: 1 });
      validateOptionalNumber(value.clickRipple.durationMs, "presentation.clickRipple.durationMs", problems, { min: 0 });
      validateOptionalString(value.clickRipple.color, "presentation.clickRipple.color", problems);
    }
  }

  if (value.tactilePress !== undefined) {
    if (!isRecord(value.tactilePress)) {
      problems.push("presentation.tactilePress must be an object.");
    } else {
      validateOptionalBoolean(value.tactilePress.enabled, "presentation.tactilePress.enabled", problems);
      validateOptionalNumber(value.tactilePress.scale, "presentation.tactilePress.scale", problems, { min: 0.8 });
      validateOptionalNumber(value.tactilePress.durationMs, "presentation.tactilePress.durationMs", problems, { min: 0 });
      validateOptionalString(value.tactilePress.glowColor, "presentation.tactilePress.glowColor", problems);
    }
  }

  if (value.localeOverlay !== undefined) {
    if (!isRecord(value.localeOverlay)) {
      problems.push("presentation.localeOverlay must be an object.");
    } else {
      validateOptionalString(value.localeOverlay.language, "presentation.localeOverlay.language", problems);
      if (!isRecord(value.localeOverlay.replacements)) {
        problems.push("presentation.localeOverlay.replacements must be an object.");
      } else {
        for (const [source, translated] of Object.entries(value.localeOverlay.replacements)) {
          if (!source.trim() || !isNonEmptyString(translated)) {
            problems.push("presentation.localeOverlay replacements must use non-empty source/target strings.");
            break;
          }
        }
      }
    }
  }
}

function validateStep(step: unknown, index: number, problems: string[]) {
  const path = `steps[${index}]`;
  if (!isRecord(step)) {
    problems.push(`${path} must be an object.`);
    return;
  }

  const action = step.action;
  const supported = [
    "goto",
    "click",
    "fill",
    "hover",
    "press",
    "scroll",
    "wait",
    "waitFor",
    "waitForNavigation",
    "waitForContentGrowth",
    "assert",
  ];

  if (!supported.includes(String(action))) {
    problems.push(`${path}.action is unsupported: ${String(action)}.`);
    return;
  }

  if (step.label !== undefined && !isNonEmptyString(step.label)) {
    problems.push(`${path}.label must be a non-empty string when provided.`);
  }

  if (step.narration !== undefined && !isNonEmptyString(step.narration)) {
    problems.push(`${path}.narration must be a non-empty string when provided.`);
  }

  if (step.voiceText !== undefined && !isNonEmptyString(step.voiceText)) {
    problems.push(`${path}.voiceText must be a non-empty string when provided.`);
  }

  if (step.pauseAfterMs !== undefined && !isNonNegativeNumber(step.pauseAfterMs)) {
    problems.push(`${path}.pauseAfterMs must be a non-negative number.`);
  }

  switch (action) {
    case "goto":
      if (!isNonEmptyString(step.url)) problems.push(`${path}.url is required.`);
      break;
    case "click":
    case "hover":
      validateTarget(step.target ?? step.selector, `${path}.target`, problems);
      break;
    case "fill":
      validateTarget(step.target ?? step.selector, `${path}.target`, problems);
      if (!isNonEmptyString(step.value) && step.value !== "") {
        problems.push(`${path}.value must be a string.`);
      }
      break;
    case "press":
      if (step.target !== undefined || step.selector !== undefined) {
        validateTarget(step.target ?? step.selector, `${path}.target`, problems);
      }
      if (!isNonEmptyString(step.key)) problems.push(`${path}.key is required.`);
      break;
    case "scroll":
      if (!isNonNegativeNumber(Math.abs(Number(step.y))) || typeof step.y !== "number") {
        problems.push(`${path}.y must be a number.`);
      }
      if (step.x !== undefined && typeof step.x !== "number") {
        problems.push(`${path}.x must be a number when provided.`);
      }
      break;
    case "wait":
      if (!isNonNegativeNumber(step.ms)) problems.push(`${path}.ms must be a non-negative number.`);
      break;
    case "waitFor":
      validateTarget(step.target, `${path}.target`, problems);
      if (step.state !== undefined && !["visible", "hidden", "attached", "detached"].includes(String(step.state))) {
        problems.push(`${path}.state must be visible, hidden, attached or detached.`);
      }
      if (step.timeoutMs !== undefined && !isNonNegativeNumber(step.timeoutMs)) {
        problems.push(`${path}.timeoutMs must be a non-negative number.`);
      }
      break;
    case "waitForNavigation":
      if (step.waitUntil !== undefined && !["load", "domcontentloaded", "networkidle"].includes(String(step.waitUntil))) {
        problems.push(`${path}.waitUntil must be load, domcontentloaded or networkidle.`);
      }
      if (step.timeoutMs !== undefined && !isNonNegativeNumber(step.timeoutMs)) {
        problems.push(`${path}.timeoutMs must be a non-negative number.`);
      }
      break;
    case "waitForContentGrowth":
      if (step.target !== undefined || step.selector !== undefined) {
        validateTarget(step.target ?? step.selector, `${path}.target`, problems);
      }
      if (step.minAddedChars !== undefined && !isNonNegativeNumber(step.minAddedChars)) {
        problems.push(`${path}.minAddedChars must be a non-negative number.`);
      }
      if (step.timeoutMs !== undefined && !isNonNegativeNumber(step.timeoutMs)) {
        problems.push(`${path}.timeoutMs must be a non-negative number.`);
      }
      break;
    case "assert":
      validateTarget(step.target, `${path}.target`, problems);
      if (!["visible", "hidden", "textContains", "valueEquals"].includes(String(step.assertion))) {
        problems.push(`${path}.assertion must be visible, hidden, textContains or valueEquals.`);
      }
      if (["textContains", "valueEquals"].includes(String(step.assertion)) && typeof step.expected !== "string") {
        problems.push(`${path}.expected must be a string for ${String(step.assertion)}.`);
      }
      break;
  }
}

export function parseScenario(input: unknown): DemoScenario {
  const problems: string[] = [];

  if (!isRecord(input)) {
    throw new ScenarioValidationError(["Scenario root must be an object."]);
  }

  if (!isNonEmptyString(input.name)) problems.push("name must be a non-empty string.");

  if (input.baseUrl !== undefined && !isNonEmptyString(input.baseUrl)) {
    problems.push("baseUrl must be a non-empty string when provided.");
  }

  if (input.defaultPauseMs !== undefined && !isNonNegativeNumber(input.defaultPauseMs)) {
    problems.push("defaultPauseMs must be a non-negative number.");
  }

  if (input.viewport !== undefined) {
    if (!isRecord(input.viewport)) {
      problems.push("viewport must be an object.");
    } else {
      if (!isNonNegativeNumber(input.viewport.width) || Number(input.viewport.width) <= 0) {
        problems.push("viewport.width must be greater than 0.");
      }
      if (!isNonNegativeNumber(input.viewport.height) || Number(input.viewport.height) <= 0) {
        problems.push("viewport.height must be greater than 0.");
      }
    }
  }

  if (input.variables !== undefined) {
    if (!isRecord(input.variables)) {
      problems.push("variables must be an object.");
    } else {
      for (const [key, value] of Object.entries(input.variables)) {
        if (typeof value !== "string") problems.push(`variables.${key} must be a string.`);
      }
    }
  }

  validatePresentation(input.presentation, problems);
  validateVoice(input.voice, problems);

  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    problems.push("steps must contain at least one step.");
  } else {
    input.steps.forEach((step, index) => validateStep(step, index, problems));
  }

  if (problems.length > 0) throw new ScenarioValidationError(problems);
  return input as unknown as DemoScenario;
}

export function assertNoEnvironmentReferences(value: unknown): void {
  const source = JSON.stringify(value);
  if (/\{\{env\.[A-Za-z_][A-Za-z0-9_]*\}\}/.test(source)) {
    throw new Error(
      "Environment references are not allowed in externally generated scenarios.",
    );
  }
}

export function interpolate(
  value: string,
  variables: Record<string, string> = {},
  env: NodeJS.ProcessEnv = process.env,
): string {
  return value.replace(/\{\{(var|env)\.([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_match, source: string, key: string) => {
    const resolved = source === "var" ? variables[key] : env[key];
    if (resolved === undefined) {
      throw new Error(`Missing ${source === "var" ? "scenario variable" : "environment variable"}: ${key}`);
    }
    return resolved;
  });
}

export function resolveUrl(url: string, baseUrl?: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!baseUrl) throw new Error(`Relative URL "${url}" requires scenario.baseUrl.`);
  return new URL(url, baseUrl).toString();
}

export function interpolateTarget(
  target: Target,
  variables: Record<string, string>,
): Target {
  if (typeof target === "string") return interpolate(target, variables);
  return {
    ...target,
    value: interpolate(target.value, variables),
    name: target.name ? interpolate(target.name, variables) : undefined,
  };
}

export function normalizeLegacyTarget(step: DemoStep): Target | undefined {
  if ("target" in step && step.target) return step.target;
  if ("selector" in step && typeof step.selector === "string") return step.selector;
  return undefined;
}
