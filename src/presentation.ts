import type { Page } from "playwright";
import { describeTarget, resolveTarget } from "./targets.js";
import type { CameraFrame, PresentationConfig, Target } from "./types.js";

const DEFAULTS = {
  transitionMs: 320,
  settleMs: 120,
  desktopScale: 1.14,
  mobileScale: 1.04,
  cursorSize: 18,
  cursorFill: "rgba(0,0,0,.82)",
  cursorBorder: "#ffffff",
  cursorBorderWidth: 3,
  cursorShadow: "0 2px 14px rgba(0,0,0,.35)",
  focusColor: "rgba(255,255,255,.92)",
  focusWidth: 2,
  focusPadding: 10,
  rippleColor: "rgba(255,255,255,.72)",
  rippleSize: 52,
  rippleDurationMs: 420,
} as const;

export function chooseZoomScale(viewportWidth: number, config?: PresentationConfig): number {
  if (config?.enabled === false || config?.smartZoom?.enabled === false) return 1;

  const requested = viewportWidth <= 640
    ? config?.smartZoom?.mobileScale ?? DEFAULTS.mobileScale
    : config?.smartZoom?.scale ?? DEFAULTS.desktopScale;

  return Math.max(1, Math.min(requested, viewportWidth <= 640 ? 1.08 : 1.35));
}

async function ensureOverlay(page: Page, config?: PresentationConfig) {
  const cursor = config?.cursor;
  const focus = config?.focusRing;

  await page.evaluate(
    ({ cursorConfig, focusConfig, defaults }) => {
      let style = document.getElementById("viiversion-demo-style") as HTMLStyleElement | null;
      if (!style) {
        style = document.createElement("style");
        style.id = "viiversion-demo-style";
        document.documentElement.appendChild(style);
      }

      const cursorSize = cursorConfig?.size ?? defaults.cursorSize;
      const cursorBorderWidth = cursorConfig?.borderWidth ?? defaults.cursorBorderWidth;
      const focusPadding = focusConfig?.padding ?? defaults.focusPadding;

      style.textContent = `
        #viiversion-demo-pointer {
          position: fixed;
          width: ${cursorSize}px;
          height: ${cursorSize}px;
          border: ${cursorBorderWidth}px solid ${cursorConfig?.border ?? defaults.cursorBorder};
          border-radius: 999px;
          background: ${cursorConfig?.fill ?? defaults.cursorFill};
          box-shadow: ${cursorConfig?.shadow ?? defaults.cursorShadow};
          transform: translate(-50%, -50%);
          z-index: 2147483647;
          pointer-events: none;
          left: 50%;
          top: 50%;
          transition:
            left .34s cubic-bezier(.2,.8,.2,1),
            top .34s cubic-bezier(.2,.8,.2,1),
            transform .14s ease;
        }
        #viiversion-demo-pointer.viiversion-click {
          transform: translate(-50%, -50%) scale(.68);
        }
        #viiversion-demo-focus {
          position: fixed;
          z-index: 2147483646;
          pointer-events: none;
          border: ${focusConfig?.width ?? defaults.focusWidth}px solid ${focusConfig?.color ?? defaults.focusColor};
          border-radius: 14px;
          box-shadow: 0 0 0 1px rgba(0,0,0,.16), 0 12px 44px rgba(0,0,0,.12);
          opacity: 0;
          transition:
            left .28s cubic-bezier(.2,.8,.2,1),
            top .28s cubic-bezier(.2,.8,.2,1),
            width .28s cubic-bezier(.2,.8,.2,1),
            height .28s cubic-bezier(.2,.8,.2,1),
            opacity .18s ease;
          padding: ${focusPadding}px;
          margin: -${focusPadding}px;
        }
        .viiversion-demo-ripple {
          position: fixed;
          z-index: 2147483645;
          border-radius: 999px;
          pointer-events: none;
          border: 2px solid var(--viiversion-ripple-color);
          transform: translate(-50%, -50%) scale(.25);
          opacity: .9;
          animation: viiversion-demo-ripple var(--viiversion-ripple-duration) ease-out forwards;
        }
        @keyframes viiversion-demo-ripple {
          to { transform: translate(-50%, -50%) scale(1); opacity: 0; }
        }
      `;

      if (!document.getElementById("viiversion-demo-pointer")) {
        const pointer = document.createElement("div");
        pointer.id = "viiversion-demo-pointer";
        document.documentElement.appendChild(pointer);
      }

      if (!document.getElementById("viiversion-demo-focus")) {
        const ring = document.createElement("div");
        ring.id = "viiversion-demo-focus";
        document.documentElement.appendChild(ring);
      }
    },
    {
      cursorConfig: cursor,
      focusConfig: focus,
      defaults: {
        cursorSize: DEFAULTS.cursorSize,
        cursorFill: DEFAULTS.cursorFill,
        cursorBorder: DEFAULTS.cursorBorder,
        cursorBorderWidth: DEFAULTS.cursorBorderWidth,
        cursorShadow: DEFAULTS.cursorShadow,
        focusColor: DEFAULTS.focusColor,
        focusWidth: DEFAULTS.focusWidth,
        focusPadding: DEFAULTS.focusPadding,
      },
    },
  );
}

async function centerTarget(page: Page, target: Target) {
  const locator = resolveTarget(page, target);
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  await locator.evaluate((element) => {
    element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  });
}

export async function focusTarget(
  page: Page,
  target: Target,
  config?: PresentationConfig,
): Promise<CameraFrame> {
  const locator = resolveTarget(page, target);
  await centerTarget(page, target);

  const transitionMs = config?.smartZoom?.transitionMs ?? DEFAULTS.transitionMs;
  const settleMs = config?.smartZoom?.settleMs ?? DEFAULTS.settleMs;
  await page.waitForTimeout(Math.min(transitionMs, 450));

  const initialBox = await locator.boundingBox();
  if (!initialBox) throw new Error(`Element has no visible box: ${describeTarget(target)}`);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Presentation camera requires a fixed viewport.");

  const scale = chooseZoomScale(viewport.width, config);
  const centerX = initialBox.x + initialBox.width / 2;
  const centerY = initialBox.y + initialBox.height / 2;

  if (config?.enabled !== false) {
    await ensureOverlay(page, config);

    await page.evaluate(
      ({ zoom, x, y, duration }) => {
        const body = document.body;
        body.style.transition = `transform ${duration}ms cubic-bezier(.2,.8,.2,1)`;
        body.style.transformOrigin = `${x + window.scrollX}px ${y + window.scrollY}px`;
        body.style.transform = `scale(${zoom})`;
      },
      { zoom: scale, x: centerX, y: centerY, duration: transitionMs },
    );

    await page.waitForTimeout(transitionMs + settleMs);
  }

  const box = await locator.boundingBox();
  if (!box) throw new Error(`Element disappeared while focusing: ${describeTarget(target)}`);

  await page.evaluate(
    ({ x, y, width, height, showRing }) => {
      const pointer = document.getElementById("viiversion-demo-pointer");
      if (pointer) {
        pointer.style.left = `${x + width / 2}px`;
        pointer.style.top = `${y + height / 2}px`;
      }

      const ring = document.getElementById("viiversion-demo-focus");
      if (ring) {
        ring.style.left = `${x}px`;
        ring.style.top = `${y}px`;
        ring.style.width = `${width}px`;
        ring.style.height = `${height}px`;
        ring.style.opacity = showRing ? "1" : "0";
      }
    },
    {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      showRing: config?.focusRing?.enabled !== false,
    },
  );

  if (config?.enabled !== false) {
    await page.waitForTimeout(160);
  }

  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height / 2,
    scale,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  };
}

export async function animateClick(page: Page, config?: PresentationConfig) {
  if (config?.enabled === false) return;

  const ripple = config?.clickRipple;
  const durationMs = ripple?.durationMs ?? DEFAULTS.rippleDurationMs;
  const size = ripple?.size ?? DEFAULTS.rippleSize;

  await page.evaluate(
    ({ rippleEnabled, rippleColor, rippleSize, rippleDuration }) => {
      const pointer = document.getElementById("viiversion-demo-pointer");
      if (!pointer) return;

      pointer.classList.add("viiversion-click");

      if (rippleEnabled) {
        const box = pointer.getBoundingClientRect();
        const ring = document.createElement("div");
        ring.className = "viiversion-demo-ripple";
        ring.style.left = `${box.left + box.width / 2}px`;
        ring.style.top = `${box.top + box.height / 2}px`;
        ring.style.width = `${rippleSize}px`;
        ring.style.height = `${rippleSize}px`;
        ring.style.setProperty("--viiversion-ripple-color", rippleColor);
        ring.style.setProperty("--viiversion-ripple-duration", `${rippleDuration}ms`);
        document.documentElement.appendChild(ring);
        window.setTimeout(() => ring.remove(), rippleDuration + 80);
      }
    },
    {
      rippleEnabled: ripple?.enabled !== false,
      rippleColor: ripple?.color ?? DEFAULTS.rippleColor,
      rippleSize: size,
      rippleDuration: durationMs,
    },
  );

  await page.waitForTimeout(110);

  await page.evaluate(() => {
    document.getElementById("viiversion-demo-pointer")?.classList.remove("viiversion-click");
  });
}

export async function resetPresentation(page: Page, config?: PresentationConfig) {
  if (page.isClosed()) return;

  const transitionMs = config?.smartZoom?.transitionMs ?? DEFAULTS.transitionMs;

  await page.evaluate(
    ({ duration }) => {
      const body = document.body;
      body.style.transition = `transform ${duration}ms cubic-bezier(.2,.8,.2,1)`;
      body.style.transform = "scale(1)";

      const ring = document.getElementById("viiversion-demo-focus");
      if (ring) ring.style.opacity = "0";

      document.querySelectorAll(".viiversion-demo-ripple").forEach((node) => node.remove());
    },
    { duration: transitionMs },
  ).catch(() => undefined);

  await page.waitForTimeout(Math.min(transitionMs, 360));
}
