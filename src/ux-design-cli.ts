import path from "node:path";
import { auditUxDesign } from "./ux-design-brain.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const url = arg("--url");
  if (!url) {
    throw new Error(
      "Usage: npm run ux-audit -- --url https://example.com [--out artifacts/ux-audit]",
    );
  }

  const outputDir = path.resolve(arg("--out") ?? "artifacts/ux-audit");
  const result = await auditUxDesign(url, { outputDir });

  console.log(
    JSON.stringify(
      {
        status: result.preflight.status,
        outputDir,
        findings: result.preflight.findings,
        overlay: result.contract.overlay,
      },
      null,
      2,
    ),
  );

  if (result.preflight.status === "BLOCKED") {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
