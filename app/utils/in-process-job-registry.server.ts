type InProcessJobStopper = () => void | Promise<void>;

declare global {
  // eslint-disable-next-line no-var
  var __inProcessJobStoppers: Map<string, InProcessJobStopper> | undefined;
  // eslint-disable-next-line no-var
  var __drainInProcessJobStoppers: (() => void | Promise<void>) | undefined;
}

function stoppers(): Map<string, InProcessJobStopper> {
  if (!globalThis.__inProcessJobStoppers) {
    globalThis.__inProcessJobStoppers = new Map();
  }
  return globalThis.__inProcessJobStoppers;
}

/** Register a stop function for graceful shutdown (shared across server bundles). */
export function registerInProcessJobStopper(id: string, stop: InProcessJobStopper): void {
  stoppers().set(id, stop);
}

/** Call every registered stopper and clear the registry (idempotent). */
export async function drainInProcessJobStoppers(): Promise<void> {
  const map = stoppers();
  const stops = [...map.values()];
  map.clear();
  for (const stop of stops) {
    try {
      await stop();
    } catch (error) {
      // One failing stopper must not skip the rest (or the HTTP graceful close).
      console.error("In-process job stopper failed during shutdown:", error);
    }
  }
}
