import type { Page } from "playwright";
import type { CameraFrame, DemoScenario } from "./types.js";

export type VisualQaSeverity = "warning" | "critical";

export type VisualQaIssue = {
  severity: VisualQaSeverity;
  code: string;
  message: string;
  stepIndex: number;
  stepLabel: string;
  details?: Record<string, unknown>;
};

export type VisualQaSnapshot = {
  documentLanguage: string;
  unexpectedScriptSamples: string[];
  overflowSamples: string[];
  pointerVisible: boolean;
  focusVisible: boolean;
};

function expectedLanguage(scenario: DemoScenario): string | undefined {
  return scenario.presentation?.localeOverlay?.language
    ?? scenario.voice?.locale?.split("-")[0]
    ?? undefined;
}

export async function inspectVisualState(
  page: Page,
  scenario: DemoScenario,
): Promise<VisualQaSnapshot> {
  const expected = expectedLanguage(scenario);
  return page.evaluate(({ expected }) => {
    const visible = (el: Element) => {
      const style = getComputedStyle(el);
      const rect = (el as HTMLElement).getBoundingClientRect();
      return style.visibility !== "hidden"
        && style.display !== "none"
        && Number(style.opacity || "1") > 0.01
        && rect.width > 1
        && rect.height > 1
        && rect.bottom > 0
        && rect.right > 0
        && rect.top < innerHeight
        && rect.left < innerWidth;
    };

    const candidates = Array.from(
      document.querySelectorAll("button,[role=button],h1,h2,h3,p,label,input,textarea,select"),
    ).filter(visible) as HTMLElement[];

    const overflowSamples = candidates
      .filter((el) => {
        const text = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
          ? (el.value || el.placeholder || "")
          : (el.innerText || el.textContent || "");
        return text.trim().length > 2
          && (el.scrollWidth > el.clientWidth + 3 || el.scrollHeight > el.clientHeight + 3);
      })
      .slice(0, 8)
      .map((el) => (el.innerText || el.textContent || (el as HTMLInputElement).value || "").trim().slice(0, 120));

    const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const unexpectedScriptSamples: string[] = [];
    if (expected === "en") {
      const parts = bodyText.match(/[^.!?\n]{0,40}[\u0400-\u04FF][^.!?\n]{0,40}/g) ?? [];
      unexpectedScriptSamples.push(...parts.slice(0, 6).map((value) => value.trim()));
    }

    const pointer = document.getElementById("viiversion-demo-pointer");
    const focus = document.getElementById("viiversion-demo-focus");
    const pointerVisible = Boolean(pointer && visible(pointer));
    const focusVisible = Boolean(
      focus
      && visible(focus)
      && Number(getComputedStyle(focus).opacity || "0") > 0.05,
    );

    return {
      documentLanguage: document.documentElement.lang || "",
      unexpectedScriptSamples,
      overflowSamples,
      pointerVisible,
      focusVisible,
    };
  }, { expected });
}

export function reviewVisualState(input: {
  scenario: DemoScenario;
  camera?: CameraFrame;
  snapshot: VisualQaSnapshot;
  stepIndex: number;
  stepLabel: string;
}): VisualQaIssue[] {
  const { scenario, camera, snapshot, stepIndex, stepLabel } = input;
  const issues: VisualQaIssue[] = [];
  const semantic = scenario.presentation?.semanticCamera;
  const expected = expectedLanguage(scenario);
  const safeArea = semantic?.safeAreaPx ?? 44;

  if (camera && semantic?.enabled) {
    const right = camera.x + camera.width;
    const bottom = camera.y + camera.height;
    if (
      camera.x < safeArea
      || camera.y < safeArea
      || right > camera.viewportWidth - safeArea
      || bottom > camera.viewportHeight - safeArea
    ) {
      issues.push({
        severity: "warning",
        code: "target_outside_safe_area",
        message: "Focused target approaches or crosses the semantic camera safe area.",
        stepIndex,
        stepLabel,
        details: { safeArea, camera },
      });
    }

    const maxScale = camera.viewportWidth <= 640 ? 1.12 : 1.18;
    if (camera.scale > maxScale + 0.001) {
      issues.push({
        severity: "critical",
        code: "unsafe_zoom",
        message: "Semantic camera zoom exceeds the premium safe limit.",
        stepIndex,
        stepLabel,
        details: { scale: camera.scale, maxScale },
      });
    }
  }

  if (scenario.presentation?.cursor?.enabled === false && snapshot.pointerVisible) {
    issues.push({
      severity: "critical",
      code: "cursor_visible_when_disabled",
      message: "Presentation cursor is visible although premium mode disables it.",
      stepIndex,
      stepLabel,
    });
  }

  if (snapshot.overflowSamples.length > 0) {
    issues.push({
      severity: "warning",
      code: "text_overflow",
      message: "Visible UI text may be clipped or overflow its container.",
      stepIndex,
      stepLabel,
      details: { samples: snapshot.overflowSamples },
    });
  }

  if (expected === "en" && snapshot.unexpectedScriptSamples.length > 0) {
    issues.push({
      severity: "warning",
      code: "language_mismatch",
      message: "English presentation contains visible Cyrillic text.",
      stepIndex,
      stepLabel,
      details: { samples: snapshot.unexpectedScriptSamples },
    });
  }

  return issues;
}

export function summarizeVisualQa(issues: VisualQaIssue[]) {
  return {
    critical: issues.filter((issue) => issue.severity === "critical").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    passed: issues.every((issue) => issue.severity !== "critical"),
  };
}
