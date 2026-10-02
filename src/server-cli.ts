import { listenDemoStudio } from "./api-server.js";

listenDemoStudio().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
