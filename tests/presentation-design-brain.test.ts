import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOverlayPlan,
  resolvePresentationDesign,
  reviewVisualPlan,
} from "../src/presentation-design-brain.js";
import type { DesignContract } from "../src/ux-design-brain.js";

const contract: DesignContract = {
  version: "design-contract-v1",
  profileVersion: "design-profile-v1",
  preflightVersion: "ux-preflight-v1",
  overlay: {
    desktop: {
      caption: "bottom",
      brandCorner: "top-right",
      captionBandRatio: 0.12,
      horizontalMarginRatio: 0.05,
    },
    mobile: {
      caption: "top",
      brandCorner: "bottom-right",
      captionBandRatio: 0.16,
      horizontalMarginRatio: 0.07,
    },
  },
  rules: {
    preserveExistingVisualSystem: true,
    avoidImportantUi: true,
    noHorizontalOverflow: true,
    minimumTouchTargetPx: 44,
    minimumMobileControlFontPx: 16,
  },
};

test("moves captions away from active UI when preferred zone collides", () => {
  const plan = buildOverlayPlan(
    [{
      camera: {
        x: 450,
        y: 760,
        width: 300,
        height: 110,
        centerX: 600,
        centerY: 815,
        scale: 1.1,
        viewportWidth: 1440,
        viewportHeight: 900,
      },
    }],
    "16:9",
    contract,
  );

  assert.equal(plan.captionPlacement, "top");
  assert.equal(plan.collisions.caption, 0);
});

test("blocks after bounded revisions when every overlay region collides", () => {
  const timeline = [{
    camera: {
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      centerX: 195,
      centerY: 422,
      scale: 1,
      viewportWidth: 390,
      viewportHeight: 844,
    },
  }];

  const result = resolvePresentationDesign(timeline, "9:16", contract, {
    preflightStatus: "PASS",
    revisionLimit: 2,
  });

  assert.equal(result.status, "BLOCKED");
  assert.ok(
    result.findings.some((finding) => finding.code === "revision_limit"),
  );
});

test("preflight BLOCKED is an independent visual stop", () => {
  const plan = buildOverlayPlan([], "16:9", contract);
  const result = reviewVisualPlan(plan, {
    preflightStatus: "BLOCKED",
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.findings[0]?.ownerStage, "design_contract");
});
