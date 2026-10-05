import path from "node:path";
import { composeHybridRun } from "./hybrid-compose.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runArg = arg("--run");
  if (!runArg) {
    throw new Error(
      "Usage: npm run hybrid-compose -- --run artifacts/<hybrid-run> [--output-dir path]",
    );
  }

  const result = await composeHybridRun(path.resolve(runArg), {
    outputDir: arg("--output-dir"),
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
