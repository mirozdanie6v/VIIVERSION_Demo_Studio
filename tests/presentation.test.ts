import assert from "node:assert/strict";
import test from "node:test";
import { chooseZoomScale } from "../src/presentation.js";

test("uses desktop presentation zoom", () => {
  assert.equal(chooseZoomScale(1440), 1.14);
});

test("reduces zoom on mobile viewports", () => {
  assert.equal(chooseZoomScale(390), 1.04);
});

test("presentation can disable smart zoom", () => {
  assert.equal(chooseZoomScale(1440, { smartZoom: { enabled: false } }), 1);
});

test("caps unsafe zoom values", () => {
  assert.equal(chooseZoomScale(1440, { smartZoom: { scale: 9 } }), 1.35);
  assert.equal(chooseZoomScale(390, { smartZoom: { mobileScale: 2 } }), 1.08);
});
