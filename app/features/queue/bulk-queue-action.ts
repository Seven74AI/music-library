export type BulkQueueAction = "playNext" | "addToUpNext" | "addToQueue";

export type BulkQueueHandlers<T> = {
  playNextTrack: (track: T) => void;
  addToUpNext: (track: T) => void;
  addToQueue: (track: T) => void;
};

/**
 * Apply a queue action to a selection, keeping the selection's order in the
 * queue. "Play next" front-inserts each track (most recent first), so the
 * selection is fed in reverse to land in its original order at the head.
 */
export function applyBulkQueueAction<T>(
  tracks: readonly T[],
  action: BulkQueueAction,
  handlers: BulkQueueHandlers<T>,
): void {
  if (tracks.length === 0) return;

  if (action === "playNext") {
    for (const track of [...tracks].reverse()) {
      handlers.playNextTrack(track);
    }
    return;
  }

  const add = action === "addToUpNext" ? handlers.addToUpNext : handlers.addToQueue;
  for (const track of tracks) {
    add(track);
  }
}
