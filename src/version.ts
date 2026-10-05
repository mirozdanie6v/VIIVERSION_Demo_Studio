import { readFileSync } from "node:fs";

type PackageMetadata = {
  version?: unknown;
};

const metadata = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as PackageMetadata;

if (typeof metadata.version !== "string" || !metadata.version.trim()) {
  throw new Error("Demo Studio package version is missing.");
}

export const DEMO_STUDIO_VERSION = metadata.version;

export function demoStudioGenerationMode(): "hybrid" | "standard" {
  return (process.env.DEMO_STUDIO_PRODUCTION_HYBRID ?? "true")
    .trim()
    .toLowerCase() === "false"
    ? "standard"
    : "hybrid";
}
