/**
 * In-memory handoff for a restored curator session.
 * Kept out of the `.client` module so route components can subscribe during SSR.
 */

import { type DialogDraft, type SessionState } from "./session-recovery.client.ts";

const EMPTY_DIALOGS: DialogDraft[] = [];

let dialogs: DialogDraft[] = EMPTY_DIALOGS;
const dialogListeners = new Set<() => void>();

const sessionListeners = new Set<(states: SessionState[]) => void>();

export function publishRestoredDialogs(next: DialogDraft[]) {
  dialogs = next;
  for (const listener of dialogListeners) listener();
}

export function subscribeRestoredDialogs(listener: () => void) {
  dialogListeners.add(listener);
  return () => {
    dialogListeners.delete(listener);
  };
}

export function getRestoredDialogs(): DialogDraft[] {
  return dialogs;
}

export function getServerRestoredDialogs(): DialogDraft[] {
  return EMPTY_DIALOGS;
}

export function clearRestoredTrackDialog(trackId: string) {
  publishRestoredDialogs(
    dialogs.filter(
      (dialog) => !(dialog.dialogType === "track-edit" && dialog.entityId === trackId),
    ),
  );
}

export function publishRestoredSession(states: SessionState[]) {
  for (const listener of sessionListeners) listener(states);
}

export function subscribeRestoredSession(listener: (states: SessionState[]) => void) {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}
