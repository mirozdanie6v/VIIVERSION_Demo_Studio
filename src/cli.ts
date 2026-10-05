import { readFile } from "node:fs/promises";
import path from "node:path";
import { hybridCaptureEnabled } from "./hybrid-capture.js";
import { runScenario } from "./runner.js";
import { parseScenario } from "./scenario.js";

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const scenarioArg = readArg("--scenario");
  if (!scenarioArg) {
    throw new Error("Usage: npm run capture -- --scenario examples/viiversion-v1.json [--headed] [--hybrid]");
  }

  const scenarioPath = path.resolve(scenarioArg);
  const source = await readFile(scenarioPath, "utf8");
  const scenario = parseScenario(JSON.parse(source) as unknown);

  const result = await runScenario(scenario, {
    headed: process.argv.includes("--headed"),
    hybrid: process.argv.includes("--hybrid") || hybridCaptureEnabled(),
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
