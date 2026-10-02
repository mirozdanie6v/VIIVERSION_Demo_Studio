import type { Locator, Page } from "playwright";
import type { Target } from "./types.js";

export function resolveTarget(page: Page, target: Target): Locator {
  if (typeof target === "string") return page.locator(target).first();

  switch (target.by) {
    case "css":
      return page.locator(target.value).first();
    case "text":
      return page.getByText(target.value, { exact: target.exact }).first();
    case "testId":
      return page.getByTestId(target.value).first();
    case "role":
      return page.getByRole(
        target.value as Parameters<Page["getByRole"]>[0],
        { name: target.name, exact: target.exact },
      ).first();
  }
}

export function describeTarget(target: Target): string {
  if (typeof target === "string") return target;
  if (target.by === "role") {
    return `role=${target.value}${target.name ? ` name="${target.name}"` : ""}`;
  }
  return `${target.by}=${target.value}`;
}
