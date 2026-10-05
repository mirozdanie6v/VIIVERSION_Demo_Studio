import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Page } from "playwright";
import { acquireBrowser } from "./browser-pool.js";
import { assertSafeHttpUrl, attachNetworkGuard } from "./security.js";
import {
  ExpiringPromiseCache,
  uxCacheTtlMs,
  type CacheSource,
} from "./ux-design-cache.js";

export type UxViewportKind = "desktop" | "mobile";
export type Rect = { x: number; y: number; width: number; height: number };

export type UiRegion = Rect & {
  kind: "important" | "occupied" | "do_not_cover";
  reason: string;
  selectorHint?: string;
};

export type ViewportQa = {
  kind: UxViewportKind;
  width: number;
  height: number;
  httpStatus: number;
  mainVisible: boolean;
  horizontalOverflow: boolean;
  h1Count: number;
  unnamedControls: number;
  undersizedTouchTargets: number;
  consoleErrors: string[];
  failedRequests: string[];
  externalOrigins: string[];
  regions: UiRegion[];
};

export type DesignProfile = {
  version: "design-profile-v1";
  source: {
    miniAppFactory: "preview-qa + visual preview patterns";
    proposalOrchestrator: "ui-ux-audit-fix + visual-system";
  };
  typography: {
    bodyFontFamily?: string;
    headingFontFamily?: string;
    bodyFontSize?: number;
    h1FontSize?: number;
    bodyLineHeight?: string;
    headingWeight?: string;
  };
  color: {
    background?: string;
    surface?: string;
    text?: string;
    primaryAction?: string;
    border?: string;
  };
  geometry: {
    containerMaxWidth?: number;
    commonRadius?: number;
    commonGap?: number;
    primaryButtonHeight?: number;
    inputHeight?: number;
  };
  interaction: {
    fixedOrStickyCount: number;
    focusableCount: number;
  };
};

export type UxPreflight = {
  version: "ux-preflight-v1";
  status: "PASS" | "REVISE" | "BLOCKED";
  url: string;
  checks: {
    visualResponsive: boolean;
    accessibilityBasics: boolean;
    browserDesktop: boolean;
    browserMobile: boolean;
    privacySecurity: boolean;
  };
  desktop: ViewportQa;
  mobile: ViewportQa;
  findings: Array<{
    severity: "critical" | "high" | "medium" | "low";
    layer: "visual" | "interaction" | "implementation" | "requirement";
    viewport?: UxViewportKind;
    message: string;
  }>;
};

export type OverlayPlacement = {
  caption: "top" | "bottom";
  brandCorner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  captionBandRatio: number;
  horizontalMarginRatio: number;
};

export type DesignContract = {
  version: "design-contract-v1";
  profileVersion: DesignProfile["version"];
  preflightVersion: UxPreflight["version"];
  overlay: {
    desktop: OverlayPlacement;
    mobile: OverlayPlacement;
  };
  rules: {
    preserveExistingVisualSystem: true;
    avoidImportantUi: true;
    noHorizontalOverflow: true;
    minimumTouchTargetPx: 44;
    minimumMobileControlFontPx: 16;
  };
};

type PageInspection = {
  qa: ViewportQa;
  profile: DesignProfile;
};

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

function cleanCssNumber(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mode<T>(values: T[]): T | undefined {
  if (!values.length) return undefined;
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

async function inspectPage(
  page: Page,
  url: string,
  kind: UxViewportKind,
): Promise<PageInspection> {
  const viewport = VIEWPORTS[kind];
  await page.setViewportSize(viewport);

  // tsx/esbuild may preserve helper calls for named functions inside
  // Playwright page.evaluate. Define the tiny helper in every document so
  // browser-side evaluation remains self-contained after navigation.
  await page.addInitScript(
    "globalThis.__name = globalThis.__name || ((target) => target);",
  );

  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const externalOrigins = new Set<string>();
  const targetOrigin = new URL(url).origin;

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(request.url().slice(0, 500));
  });
  page.on("request", (request) => {
    try {
      const requested = new URL(request.url());
      if (
        (requested.protocol === "http:" || requested.protocol === "https:") &&
        requested.origin !== targetOrigin
      ) {
        externalOrigins.add(requested.origin);
      }
    } catch {
      // Browser-internal URL.
    }
  });

  const navigation = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);

  const dom = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || "1") > 0 &&
        box.width > 1 &&
        box.height > 1
      );
    };

    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: Math.max(0, box.width),
        height: Math.max(0, box.height),
      };
    };

    const selectorHint = (element: Element) => {
      if (element.id) return "#" + element.id;
      const testId =
        element.getAttribute("data-testid") ??
        element.getAttribute("data-test-id");
      if (testId) return "[data-testid=\"" + testId.replace(/\"/g, "\\\"") + "\"]";
      return element.tagName.toLowerCase();
    };

    const controls = [
      ...document.querySelectorAll(
        "button,a[href],input,select,textarea,[role=button],[role=link]",
      ),
    ].filter(visible);

    const unnamedControls = controls.filter((element) => {
      const input = element as HTMLInputElement;
      const label =
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.textContent ||
        input.placeholder ||
        input.labels?.[0]?.textContent;
      return !String(label ?? "").trim();
    }).length;

    const undersizedTouchTargets = controls.filter((element) => {
      const box = element.getBoundingClientRect();
      return box.width < 44 || box.height < 44;
    }).length;

    const important = [
      ...document.querySelectorAll(
        "button,a[href],[role=button],input,select,textarea,[aria-live],[role=alert]",
      ),
    ]
      .filter(visible)
      .slice(0, 80)
      .map((element) => ({
        ...rect(element),
        kind: "important" as const,
        reason: "interactive or result UI",
        selectorHint: selectorHint(element),
      }));

    const occupied = [...document.querySelectorAll("*")]
      .filter((element) => {
        if (!visible(element)) return false;
        const style = getComputedStyle(element);
        return style.position === "fixed" || style.position === "sticky";
      })
      .slice(0, 30)
      .map((element) => ({
        ...rect(element),
        kind: "do_not_cover" as const,
        reason: "fixed or sticky UI",
        selectorHint: selectorHint(element),
      }));

    const bodyStyle = getComputedStyle(document.body);
    const h1 = document.querySelector("h1");
    const h1Style = h1 ? getComputedStyle(h1) : undefined;
    const main = document.querySelector("main");
    const primaryButton =
      document.querySelector("button,[role=button],a[href]") as HTMLElement | null;
    const input =
      document.querySelector("input,select,textarea") as HTMLElement | null;
    const cardCandidates = [
      ...document.querySelectorAll("article,section,[class*=card],[class*=panel]"),
    ].filter(visible);
    const radiusValues = cardCandidates
      .slice(0, 24)
      .map((element) =>
        Number.parseFloat(getComputedStyle(element).borderRadius),
      )
      .filter(Number.isFinite);
    const gapValues = [
      ...document.querySelectorAll("main,section,form,[class*=grid],[class*=stack]"),
    ]
      .filter(visible)
      .slice(0, 24)
      .map((element) => Number.parseFloat(getComputedStyle(element).gap))
      .filter((value) => Number.isFinite(value) && value > 0);

    const surfaces = cardCandidates
      .slice(0, 24)
      .map((element) => getComputedStyle(element).backgroundColor)
      .filter(
        (value) =>
          value &&
          value !== "rgba(0, 0, 0, 0)" &&
          value !== "transparent",
      );

    const borderColors = cardCandidates
      .slice(0, 24)
      .map((element) => getComputedStyle(element).borderColor)
      .filter((value) => value && value !== "rgba(0, 0, 0, 0)");

    const mainBox = main?.getBoundingClientRect();
    const fixedOrStickyCount = occupied.length;

    return {
      mainVisible: Boolean(
        main &&
          mainBox &&
          mainBox.width > 0 &&
          mainBox.height > 0,
      ),
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
      h1Count: document.querySelectorAll("h1").length,
      unnamedControls,
      undersizedTouchTargets,
      regions: [...important, ...occupied],
      profile: {
        bodyFontFamily: bodyStyle.fontFamily || undefined,
        headingFontFamily: h1Style?.fontFamily || undefined,
        bodyFontSize: Number.parseFloat(bodyStyle.fontSize),
        h1FontSize: h1Style ? Number.parseFloat(h1Style.fontSize) : undefined,
        bodyLineHeight: bodyStyle.lineHeight || undefined,
        headingWeight: h1Style?.fontWeight || undefined,
        background: bodyStyle.backgroundColor || undefined,
        surfaceCandidates: surfaces,
        text: bodyStyle.color || undefined,
        primaryAction: primaryButton
          ? getComputedStyle(primaryButton).backgroundColor
          : undefined,
        borderCandidates: borderColors,
        containerMaxWidth: main
          ? Number.parseFloat(getComputedStyle(main).maxWidth)
          : undefined,
        radiusValues,
        gapValues,
        primaryButtonHeight: primaryButton?.getBoundingClientRect().height,
        inputHeight: input?.getBoundingClientRect().height,
        fixedOrStickyCount,
        focusableCount: controls.length,
      },
    };
  });

  const raw = dom.profile;
  const profile: DesignProfile = {
    version: "design-profile-v1",
    source: {
      miniAppFactory: "preview-qa + visual preview patterns",
      proposalOrchestrator: "ui-ux-audit-fix + visual-system",
    },
    typography: {
      bodyFontFamily: raw.bodyFontFamily,
      headingFontFamily: raw.headingFontFamily,
      bodyFontSize: cleanCssNumber(String(raw.bodyFontSize ?? "")),
      h1FontSize: cleanCssNumber(String(raw.h1FontSize ?? "")),
      bodyLineHeight: raw.bodyLineHeight,
      headingWeight: raw.headingWeight,
    },
    color: {
      background: raw.background,
      surface: mode(raw.surfaceCandidates),
      text: raw.text,
      primaryAction: raw.primaryAction,
      border: mode(raw.borderCandidates),
    },
    geometry: {
      containerMaxWidth: Number.isFinite(raw.containerMaxWidth)
        ? raw.containerMaxWidth
        : undefined,
      commonRadius: mode(
        raw.radiusValues.map((value) => Math.round(value)),
      ),
      commonGap: mode(raw.gapValues.map((value) => Math.round(value))),
      primaryButtonHeight: raw.primaryButtonHeight,
      inputHeight: raw.inputHeight,
    },
    interaction: {
      fixedOrStickyCount: raw.fixedOrStickyCount,
      focusableCount: raw.focusableCount,
    },
  };

  return {
    qa: {
      kind,
      width: viewport.width,
      height: viewport.height,
      httpStatus: navigation?.status() ?? 0,
      mainVisible: dom.mainVisible,
      horizontalOverflow: dom.horizontalOverflow,
      h1Count: dom.h1Count,
      unnamedControls: dom.unnamedControls,
      undersizedTouchTargets: dom.undersizedTouchTargets,
      consoleErrors,
      failedRequests,
      externalOrigins: [...externalOrigins],
      regions: dom.regions,
    },
    profile,
  };
}

function mergeProfiles(
  desktop: DesignProfile,
  mobile: DesignProfile,
): DesignProfile {
  return {
    ...desktop,
    typography: {
      ...desktop.typography,
      bodyFontFamily:
        desktop.typography.bodyFontFamily ?? mobile.typography.bodyFontFamily,
      headingFontFamily:
        desktop.typography.headingFontFamily ?? mobile.typography.headingFontFamily,
    },
    geometry: {
      ...desktop.geometry,
      inputHeight:
        desktop.geometry.inputHeight ?? mobile.geometry.inputHeight,
    },
    interaction: {
      fixedOrStickyCount: Math.max(
        desktop.interaction.fixedOrStickyCount,
        mobile.interaction.fixedOrStickyCount,
      ),
      focusableCount: Math.max(
        desktop.interaction.focusableCount,
        mobile.interaction.focusableCount,
      ),
    },
  };
}

function occupancyScore(
  qa: ViewportQa,
  zone: "top" | "bottom",
): number {
  const start = zone === "top" ? 0 : qa.height * 0.68;
  const end = zone === "top" ? qa.height * 0.32 : qa.height;
  let score = 0;

  for (const region of qa.regions) {
    const regionStart = region.y;
    const regionEnd = region.y + region.height;
    const overlap = Math.max(0, Math.min(end, regionEnd) - Math.max(start, regionStart));
    if (overlap <= 0) continue;
    const weight =
      region.kind === "do_not_cover" ? 3 : region.kind === "important" ? 2 : 1;
    score += overlap * Math.min(region.width, qa.width) * weight;
  }

  return score;
}

function placementFor(qa: ViewportQa): OverlayPlacement {
  const top = occupancyScore(qa, "top");
  const bottom = occupancyScore(qa, "bottom");
  return {
    caption: top <= bottom ? "top" : "bottom",
    brandCorner: top <= bottom ? "bottom-right" : "top-right",
    captionBandRatio: qa.kind === "mobile" ? 0.16 : 0.12,
    horizontalMarginRatio: qa.kind === "mobile" ? 0.07 : 0.045,
  };
}

function preflightStatus(
  desktop: ViewportQa,
  mobile: ViewportQa,
): Pick<UxPreflight, "status" | "checks" | "findings"> {
  const findings: UxPreflight["findings"] = [];

  for (const qa of [desktop, mobile]) {
    if (qa.horizontalOverflow) {
      findings.push({
        severity: "high",
        layer: "visual",
        viewport: qa.kind,
        message: "Horizontal overflow detected.",
      });
    }
    if (qa.h1Count !== 1) {
      findings.push({
        severity: "medium",
        layer: "visual",
        viewport: qa.kind,
        message: "Expected exactly one h1, found " + qa.h1Count + ".",
      });
    }
    if (qa.unnamedControls > 0) {
      findings.push({
        severity: "high",
        layer: "interaction",
        viewport: qa.kind,
        message:
          qa.unnamedControls +
          " interactive controls have no observable accessible name.",
      });
    }
    if (qa.undersizedTouchTargets > 0 && qa.kind === "mobile") {
      findings.push({
        severity: "medium",
        layer: "interaction",
        viewport: qa.kind,
        message:
          qa.undersizedTouchTargets +
          " mobile controls are smaller than the 44px target.",
      });
    }
    if (qa.consoleErrors.length > 0 || qa.failedRequests.length > 0) {
      findings.push({
        severity: "high",
        layer: "implementation",
        viewport: qa.kind,
        message:
          "Browser runtime reported " +
          qa.consoleErrors.length +
          " console errors and " +
          qa.failedRequests.length +
          " failed requests.",
      });
    }
  }

  const checks = {
    visualResponsive:
      desktop.mainVisible &&
      mobile.mainVisible &&
      !desktop.horizontalOverflow &&
      !mobile.horizontalOverflow,
    accessibilityBasics:
      desktop.h1Count === 1 &&
      desktop.unnamedControls === 0 &&
      mobile.unnamedControls === 0,
    browserDesktop:
      desktop.httpStatus >= 200 &&
      desktop.httpStatus < 400 &&
      desktop.consoleErrors.length === 0 &&
      desktop.failedRequests.length === 0,
    browserMobile:
      mobile.httpStatus >= 200 &&
      mobile.httpStatus < 400 &&
      mobile.consoleErrors.length === 0 &&
      mobile.failedRequests.length === 0,
    privacySecurity:
      desktop.externalOrigins.length === 0 &&
      mobile.externalOrigins.length === 0,
  };

  const blocking = findings.some((finding) => finding.severity === "critical");
  const needsRevision = Object.values(checks).some((value) => !value);

  return {
    status: blocking ? "BLOCKED" : needsRevision ? "REVISE" : "PASS",
    checks,
    findings,
  };
}

type UxDesignAuditPayload = {
  preflight: UxPreflight;
  profile: DesignProfile;
  contract: DesignContract;
  screenshots?: {
    desktop: Buffer;
    mobile: Buffer;
  };
};

export type UxDesignAuditResult = {
  preflight: UxPreflight;
  profile: DesignProfile;
  contract: DesignContract;
  cacheSource: CacheSource | "disabled";
};

const uxAuditCache = new ExpiringPromiseCache<UxDesignAuditPayload>();

function uxCacheKey(url: string): string {
  return [
    "ux-design-v1",
    VIEWPORTS.desktop.width + "x" + VIEWPORTS.desktop.height,
    VIEWPORTS.mobile.width + "x" + VIEWPORTS.mobile.height,
    new URL(url).toString(),
  ].join("|");
}

async function materializeUxDesignArtifacts(
  outputDirValue: string,
  audit: UxDesignAuditPayload,
): Promise<void> {
  const outputDir = path.resolve(outputDirValue);
  await mkdir(outputDir, { recursive: true });

  const writes: Promise<unknown>[] = [
    writeFile(
      path.join(outputDir, "ux_preflight.json"),
      JSON.stringify(audit.preflight, null, 2) + "\n",
      "utf8",
    ),
    writeFile(
      path.join(outputDir, "design_profile.json"),
      JSON.stringify(audit.profile, null, 2) + "\n",
      "utf8",
    ),
    writeFile(
      path.join(outputDir, "design_contract.json"),
      JSON.stringify(audit.contract, null, 2) + "\n",
      "utf8",
    ),
  ];

  if (audit.screenshots) {
    writes.push(
      writeFile(path.join(outputDir, "ux_desktop.png"), audit.screenshots.desktop),
      writeFile(path.join(outputDir, "ux_mobile.png"), audit.screenshots.mobile),
    );
  }

  await Promise.all(writes);
}

async function auditUxDesignFresh(
  url: string,
  captureScreenshots: boolean,
): Promise<UxDesignAuditPayload> {
  const lease = await acquireBrowser({ headless: true });
  const browser = lease.browser;

  try {
    const desktopContext = await browser.newContext({
      viewport: VIEWPORTS.desktop,
    });
    const mobileContext = await browser.newContext({
      viewport: VIEWPORTS.mobile,
    });
    await attachNetworkGuard(desktopContext);
    await attachNetworkGuard(mobileContext);

    try {
      const desktopPage = await desktopContext.newPage();
      const mobilePage = await mobileContext.newPage();
      const [desktop, mobile] = await Promise.all([
        inspectPage(desktopPage, url, "desktop"),
        inspectPage(mobilePage, url, "mobile"),
      ]);

      const status = preflightStatus(desktop.qa, mobile.qa);
      const preflight: UxPreflight = {
        version: "ux-preflight-v1",
        status: status.status,
        url,
        checks: status.checks,
        desktop: desktop.qa,
        mobile: mobile.qa,
        findings: status.findings,
      };
      const profile = mergeProfiles(desktop.profile, mobile.profile);
      const contract: DesignContract = {
        version: "design-contract-v1",
        profileVersion: profile.version,
        preflightVersion: preflight.version,
        overlay: {
          desktop: placementFor(desktop.qa),
          mobile: placementFor(mobile.qa),
        },
        rules: {
          preserveExistingVisualSystem: true,
          avoidImportantUi: true,
          noHorizontalOverflow: true,
          minimumTouchTargetPx: 44,
          minimumMobileControlFontPx: 16,
        },
      };

      const screenshots = captureScreenshots
        ? await (async () => {
            const [desktopScreenshot, mobileScreenshot] = await Promise.all([
              desktopPage.screenshot({ fullPage: true }),
              mobilePage.screenshot({ fullPage: true }),
            ]);
            return {
              desktop: desktopScreenshot,
              mobile: mobileScreenshot,
            };
          })()
        : undefined;

      return {
        preflight,
        profile,
        contract,
        screenshots,
      };
    } finally {
      await desktopContext.close();
      await mobileContext.close();
    }
  } finally {
    await lease.release();
  }
}

export async function auditUxDesign(
  url: string,
  options: {
    outputDir?: string;
    cache?: boolean;
  } = {},
): Promise<UxDesignAuditResult> {
  await assertSafeHttpUrl(url);

  const ttlMs = uxCacheTtlMs();
  const useCache =
    options.cache !== false &&
    Boolean(options.outputDir) &&
    ttlMs > 0;

  let audit: UxDesignAuditPayload;
  let cacheSource: CacheSource | "disabled";

  if (useCache) {
    const cached = await uxAuditCache.getOrCreate(
      uxCacheKey(url),
      ttlMs,
      () => auditUxDesignFresh(url, true),
      (value) =>
        value.preflight.status !== "BLOCKED" &&
        Boolean(value.screenshots),
    );
    audit = cached.value;
    cacheSource = cached.source;
  } else {
    audit = await auditUxDesignFresh(url, Boolean(options.outputDir));
    cacheSource = "disabled";
  }

  if (options.outputDir) {
    await materializeUxDesignArtifacts(options.outputDir, audit);
  }

  return {
    preflight: audit.preflight,
    profile: audit.profile,
    contract: audit.contract,
    cacheSource,
  };
}
