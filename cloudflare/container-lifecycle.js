// Pure lifecycle decisions shared by Demo Studio's edge Worker and tests.
export const IDLE_CONTAINER_INACTIVITY_MS = 10 * 60 * 1000;
export const ACTIVE_CONTAINER_INACTIVITY_MS = 60 * 60 * 1000;

export function inactivityTimeoutForActiveJobCount(activeJobCount) {
  return activeJobCount > 0
    ? ACTIVE_CONTAINER_INACTIVITY_MS
    : IDLE_CONTAINER_INACTIVITY_MS;
}

export function isTerminalJobStatus(status) {
  return status === "completed" || status === "failed";
}

export function edgeHealthPayload({ version, productionHybrid, apiKeyPresent }) {
  return {
    ok: true,
    service: "viiversion-demo-studio",
    version,
    generationMode:
      String(productionHybrid ?? "true").trim().toLowerCase() === "false"
        ? "standard"
        : "hybrid",
    accessMode: apiKeyPresent ? "authenticated" : "anonymous",
    healthScope: "edge",
    containerChecked: false,
  };
}
