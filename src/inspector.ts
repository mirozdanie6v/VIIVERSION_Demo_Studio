import { acquireBrowser } from "./browser-pool.js";
import { assertSafeHttpUrl, attachNetworkGuard } from "./security.js";
import type { Target, Viewport } from "./types.js";

export type UiElementSnapshot = {
  index: number;
  tag: string;
  role?: string;
  text?: string;
  accessibleName?: string;
  placeholder?: string;
  testId?: string;
  href?: string;
  type?: string;
  name?: string;
  id?: string;
  cssPath: string;
  target: Target;
};

export type ApplicationSnapshot = {
  url: string;
  title: string;
  viewport: Viewport;
  headings: string[];
  elements: UiElementSnapshot[];
};

function clean(value: string | null | undefined, max = 140): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.slice(0, max);
}

function escapeCssAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function suggestedTarget(element: Omit<UiElementSnapshot, "index" | "target">): Target {
  if (element.testId) return { by: "testId", value: element.testId };
  if (element.role && element.accessibleName) {
    return { by: "role", value: element.role, name: element.accessibleName, exact: true };
  }
  if (element.id) return { by: "css", value: '[id="' + escapeCssAttribute(element.id) + '"]' };
  if (element.name) return { by: "css", value: '[name="' + escapeCssAttribute(element.name) + '"]' };
  if (element.text && ["button", "a"].includes(element.tag)) {
    return { by: "text", value: element.text, exact: true };
  }
  return { by: "css", value: element.cssPath };
}

export async function inspectApplication(
  url: string,
  viewport: Viewport = { width: 1440, height: 900 },
): Promise<ApplicationSnapshot> {
  await assertSafeHttpUrl(url);
  const lease = await acquireBrowser({ headless: true });
  const browser = lease.browser;
  const context = await browser.newContext({ viewport }).catch(async (error) => {
    await lease.release();
    throw error;
  });
  await attachNetworkGuard(context);
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);

    const title = await page.title();
    const headings = (await page.locator("h1,h2,h3").allTextContents())
      .map((value) => clean(value, 180))
      .filter((value): value is string => Boolean(value))
      .slice(0, 30);

    const raw = await page.locator(
      'button,a[href],input,textarea,select,[role],[data-testid],[data-test-id]',
    ).evaluateAll((nodes) => {
      const cssPath = (element: Element): string => {
        const segments: string[] = [];
        let current: Element | null = element;

        while (current && current !== document.body && segments.length < 5) {
          if (current.id) {
            segments.unshift('[id="' + current.id.replace(/"/g, '\\"') + '"]');
            break;
          }

          const tag = current.tagName.toLowerCase();
          const parent: Element | null = current.parentElement;
          if (!parent) {
            segments.unshift(tag);
            break;
          }

          const currentTagName = current.tagName;
          const siblings: Element[] = Array.from(parent.children).filter(
            (sibling: Element) => sibling.tagName === currentTagName,
          );
          const index = siblings.indexOf(current) + 1;
          segments.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + index + ")" : tag);
          current = parent;
        }

        return segments.join(" > ");
      };

      const inferRole = (element: Element): string | undefined => {
        const explicit = element.getAttribute("role");
        if (explicit) return explicit;

        const tag = element.tagName.toLowerCase();
        if (tag === "button") return "button";
        if (tag === "a" && element.hasAttribute("href")) return "link";
        if (tag === "textarea") return "textbox";
        if (tag === "select") return "combobox";
        if (tag === "input") {
          const type = (element.getAttribute("type") || "text").toLowerCase();
          if (["button", "submit", "reset"].includes(type)) return "button";
          if (type === "checkbox") return "checkbox";
          if (type === "radio") return "radio";
          if (["text", "email", "search", "tel", "url", "password"].includes(type)) return "textbox";
        }
        return undefined;
      };

      const accessibleName = (element: Element): string | undefined => {
        const aria = element.getAttribute("aria-label");
        if (aria) return aria;

        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        ) {
          const labels = Array.from(element.labels ?? []);
          const label = labels.map((item) => item.textContent ?? "").join(" ").trim();
          if (label) return label;
          if ("placeholder" in element && element.placeholder) return element.placeholder;
        }

        const text = element.textContent?.replace(/\s+/g, " ").trim();
        return text || undefined;
      };

      return nodes
        .filter((element) => {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && box.width > 1 && box.height > 1;
        })
        .slice(0, 150)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          role: inferRole(element),
          text: element.textContent,
          accessibleName: accessibleName(element),
          placeholder:
            element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
              ? element.placeholder
              : undefined,
          testId: element.getAttribute("data-testid") ?? element.getAttribute("data-test-id") ?? undefined,
          href: element instanceof HTMLAnchorElement ? element.href : undefined,
          type: element.getAttribute("type") ?? undefined,
          name: element.getAttribute("name") ?? undefined,
          id: element.id || undefined,
          cssPath: cssPath(element),
        }));
    });

    const elements = raw.map((element, index) => {
      const normalized = {
        tag: element.tag,
        role: clean(element.role),
        text: clean(element.text),
        accessibleName: clean(element.accessibleName),
        placeholder: clean(element.placeholder),
        testId: clean(element.testId),
        href: clean(element.href, 300),
        type: clean(element.type),
        name: clean(element.name),
        id: clean(element.id),
        cssPath: element.cssPath,
      };

      return {
        index,
        ...normalized,
        target: suggestedTarget(normalized),
      };
    });

    return {
      url: page.url(),
      title,
      viewport,
      headings,
      elements,
    };
  } finally {
    await context.close().catch(() => undefined);
    await lease.release();
  }
}
