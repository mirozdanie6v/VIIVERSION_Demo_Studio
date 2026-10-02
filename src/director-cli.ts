import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { planDemo } from "./director.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const url = arg("--url");
  const goal = arg("--goal");

  if (!url || !goal) {
    throw new Error(
      'Usage: npm run direct -- --url https://app.example.com --goal "Show the catalog and submit a request"',
    );
  }

  const result = await planDemo(url, goal, {
    model: arg("--model"),
  });

  const output = path.resolve(arg("--output") ?? "generated/demo-scenario.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result.scenario, null, 2) + "\n", "utf8");

  const storyboardPath = output.replace(/\.json$/i, ".storyboard.md");
  await writeFile(storyboardPath, result.storyboard + "\n", "utf8");

  console.log(JSON.stringify({
    scenario: output,
    storyboard: storyboardPath,
    inspectedUrl: result.snapshot.url,
    elements: result.snapshot.elements.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
