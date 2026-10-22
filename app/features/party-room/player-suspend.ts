import { type PlayerStateData } from "#app/features/player-state/player-state.ts";

/**
 * In-memory suspend snapshot for personal PlayerState while the device is the
 * Party Room speaker (ADR-030 / ADR-017). The personal row on the server is
 * not overwritten with party queue noise.
 */
export type SuspendedPersonalPlayer = {
  snapshot: PlayerStateData;
  /** Whether the personal player UI was visible before suspend. */
  wasVisible: boolean;
};

let suspended: SuspendedPersonalPlayer | null = null;

export function suspendPersonalPlayerSnapshot(
  snapshot: PlayerStateData,
  wasVisible: boolean,
): void {
  // Keep the first snapshot if already suspended (re-entrant host reclaim).
  if (suspended) return;
  suspended = { snapshot: structuredClone(snapshot), wasVisible };
}

export function peekSuspendedPersonalPlayer(): SuspendedPersonalPlayer | null {
  return suspended;
}

export function takeSuspendedPersonalPlayer(): SuspendedPersonalPlayer | null {
  const value = suspended;
  suspended = null;
  return value;
}

export function clearSuspendedPersonalPlayer(): void {
  suspended = null;
}

/** Test helper */
export function __resetSuspendedPersonalPlayerForTests(): void {
  suspended = null;
}
