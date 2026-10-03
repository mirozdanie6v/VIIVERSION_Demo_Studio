import type { CameraFrame } from "./types.js";
import type { DesignContract, OverlayPlacement } from "./ux-design-brain.js";

export type PresentationPreset = "16:9" | "9:16" | "1:1";

export type OverlayPlan = {
  version: "overlay-plan-v1";
  preset: PresentationPreset;
  captionPlacement: "top" | "bottom";
  brandCorner: OverlayPlacement["brandCorner"];
  captionBandRatio: number;
  horizontalMarginRatio: number;
  collisions: {
    caption: number;
    brand: number;
  };
  revision: number;
  source: "design-contract" | "fallback";
};

export type VisualCriticFinding = {
  severity: "info" | "warning" | "error";
  ownerStage: "design_contract" | "caption_brain" | "presentation_design";
  code:
    | "preflight_blocked"
    | "caption_ui_collision"
    | "brand_ui_collision"
    | "revision_limit";
  message: string;
  requiredAction: string;
};

export type VisualCriticResult = {
  version: "visual-critic-v1";
  status: "PASS" | "REVISE" | "BLOCKED";
  revision: number;
  findings: VisualCriticFinding[];
  plan: OverlayPlan;
};

type CameraEntry = {
  camera?: CameraFrame;
};

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function captionRect(
  camera: CameraFrame,
  placement: "top" | "bottom",
  bandRatio: number,
  horizontalMarginRatio: number,
) {
  const height = camera.viewportHeight * bandRatio;
  const margin = camera.viewportWidth * horizontalMarginRatio;
  return {
    x: margin,
    y: placement === "top" ? 0 : camera.viewportHeight - height,
    width: camera.viewportWidth - margin * 2,
    height,
  };
}

function brandRect(
  camera: CameraFrame,
  corner: OverlayPlacement["brandCorner"],
) {
  const width = camera.viewportWidth * 0.2;
  const height = Math.max(42, camera.viewportHeight * 0.07);
  const marginX = camera.viewportWidth * 0.025;
  const marginY = camera.viewportHeight * 0.025;
  const left = corner.endsWith("left");
  const top = corner.startsWith("top");
  return {
    x: left ? marginX : camera.viewportWidth - width - marginX,
    y: top ? marginY : camera.viewportHeight - height - marginY,
    width,
    height,
  };
}

function collisionCount(
  cameras: CameraFrame[],
  placement: "top" | "bottom",
  corner: OverlayPlacement["brandCorner"],
  bandRatio: number,
  horizontalMarginRatio: number,
) {
  let caption = 0;
  let brand = 0;

  for (const camera of cameras) {
    const active = {
      x: camera.x,
      y: camera.y,
      width: camera.width,
      height: camera.height,
    };
    if (
      intersects(
        active,
        captionRect(camera, placement, bandRatio, horizontalMarginRatio),
      )
    ) {
      caption += 1;
    }
    if (intersects(active, brandRect(camera, corner))) {
      brand += 1;
    }
  }

  return { caption, brand };
}

function oppositePlacement(value: "top" | "bottom"): "top" | "bottom" {
  return value === "top" ? "bottom" : "top";
}

function oppositeCorner(
  corner: OverlayPlacement["brandCorner"],
): OverlayPlacement["brandCorner"] {
  const map: Record<
    OverlayPlacement["brandCorner"],
    OverlayPlacement["brandCorner"]
  > = {
    "top-left": "bottom-right",
    "top-right": "bottom-left",
    "bottom-left": "top-right",
    "bottom-right": "top-left",
  };
  return map[corner];
}

function contractPlacement(
  contract: DesignContract | undefined,
  preset: PresentationPreset,
): OverlayPlacement {
  if (!contract) {
    return {
      caption: preset === "9:16" ? "top" : "bottom",
      brandCorner: preset === "9:16" ? "bottom-right" : "top-right",
      captionBandRatio: preset === "9:16" ? 0.16 : 0.12,
      horizontalMarginRatio: preset === "9:16" ? 0.07 : 0.045,
    };
  }
  return preset === "9:16"
    ? contract.overlay.mobile
    : contract.overlay.desktop;
}

export function buildOverlayPlan(
  timeline: CameraEntry[],
  preset: PresentationPreset,
  contract?: DesignContract,
  revision = 0,
): OverlayPlan {
  const cameras = timeline
    .map((entry) => entry.camera)
    .filter((value): value is CameraFrame => Boolean(value));
  const preferred = contractPlacement(contract, preset);
  const effectiveBandRatio = Math.max(
    preset === "9:16" ? 0.11 : 0.08,
    preferred.captionBandRatio * (1 - revision * 0.14),
  );
  const effectiveMarginRatio = Math.min(
    0.12,
    preferred.horizontalMarginRatio * (1 + revision * 0.08),
  );

  const candidates: Array<{
    captionPlacement: "top" | "bottom";
    brandCorner: OverlayPlacement["brandCorner"];
  }> = [
    {
      captionPlacement: preferred.caption,
      brandCorner: preferred.brandCorner,
    },
    {
      captionPlacement: oppositePlacement(preferred.caption),
      brandCorner: preferred.brandCorner,
    },
    {
      captionPlacement: preferred.caption,
      brandCorner: oppositeCorner(preferred.brandCorner),
    },
    {
      captionPlacement: oppositePlacement(preferred.caption),
      brandCorner: oppositeCorner(preferred.brandCorner),
    },
  ];

  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      collisions: collisionCount(
        cameras,
        candidate.captionPlacement,
        candidate.brandCorner,
        effectiveBandRatio,
        effectiveMarginRatio,
      ),
    }))
    .sort(
      (a, b) =>
        a.collisions.caption * 3 +
        a.collisions.brand -
        (b.collisions.caption * 3 + b.collisions.brand),
    );

  const best = ranked[0];

  return {
    version: "overlay-plan-v1",
    preset,
    captionPlacement: best.captionPlacement,
    brandCorner: best.brandCorner,
    captionBandRatio: effectiveBandRatio,
    horizontalMarginRatio: effectiveMarginRatio,
    collisions: best.collisions,
    revision,
    source: contract ? "design-contract" : "fallback",
  };
}

export function reviewVisualPlan(
  plan: OverlayPlan,
  options: {
    preflightStatus?: "PASS" | "REVISE" | "BLOCKED";
    revisionLimit?: number;
  } = {},
): VisualCriticResult {
  const findings: VisualCriticFinding[] = [];
  const limit = options.revisionLimit ?? 2;

  if (options.preflightStatus === "BLOCKED") {
    findings.push({
      severity: "error",
      ownerStage: "design_contract",
      code: "preflight_blocked",
      message: "UX preflight contains a blocking condition.",
      requiredAction:
        "Resolve the blocking target-application issue before presentation rendering.",
    });
  }

  if (plan.collisions.caption > 0) {
    findings.push({
      severity: "warning",
      ownerStage: "caption_brain",
      code: "caption_ui_collision",
      message:
        "Caption region intersects important active UI in " +
        plan.collisions.caption +
        " recorded camera frames.",
      requiredAction:
        "Move captions to a lower-collision safe region or reduce the caption band.",
    });
  }

  if (plan.collisions.brand > 0) {
    findings.push({
      severity: "warning",
      ownerStage: "presentation_design",
      code: "brand_ui_collision",
      message:
        "Brand overlay intersects important active UI in " +
        plan.collisions.brand +
        " recorded camera frames.",
      requiredAction: "Move branding to the opposite low-conflict corner.",
    });
  }

  const hasErrors = findings.some((finding) => finding.severity === "error");
  const hasWarnings = findings.some((finding) => finding.severity === "warning");

  if (hasWarnings && plan.revision >= limit) {
    findings.push({
      severity: "error",
      ownerStage: "presentation_design",
      code: "revision_limit",
      message: "Visual revision limit reached without a collision-free plan.",
      requiredAction:
        "Stop automatic revision and require an explicit design decision.",
    });
  }

  return {
    version: "visual-critic-v1",
    status:
      hasErrors || (hasWarnings && plan.revision >= limit)
        ? "BLOCKED"
        : hasWarnings
          ? "REVISE"
          : "PASS",
    revision: plan.revision,
    findings,
    plan,
  };
}

export function resolvePresentationDesign(
  timeline: CameraEntry[],
  preset: PresentationPreset,
  contract?: DesignContract,
  options: {
    preflightStatus?: "PASS" | "REVISE" | "BLOCKED";
    revisionLimit?: number;
  } = {},
): VisualCriticResult {
  const limit = options.revisionLimit ?? 2;
  let finalResult: VisualCriticResult | undefined;

  for (let revision = 0; revision <= limit; revision += 1) {
    const plan = buildOverlayPlan(timeline, preset, contract, revision);
    const reviewed = reviewVisualPlan(plan, {
      ...options,
      revisionLimit: limit,
    });
    finalResult = reviewed;

    if (reviewed.status !== "REVISE") return reviewed;
  }

  return finalResult!;
}
