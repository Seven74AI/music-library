/**
 * Real-time curator sync across browser tabs using BroadcastChannel API
 * See ADR-033 for full specification
 */

export type CuratorSyncMessage =
  | {
      type: "LOCK_RELEASED";
      entityType: "track" | "artist" | "album";
      entityId: string;
    }
  | {
      type: "LOCK_ACQUIRED";
      entityType: "track" | "artist" | "album";
      entityId: string;
      lockedBy: string;
    }
  | {
      type: "ENTITY_UPDATED";
      entityType: "track" | "artist" | "album";
      entityId: string;
    }
  | {
      type: "SELECTION_UPDATED";
      trackIds: string[];
    }
  | {
      type: "SELECTION_MODE_CHANGED";
      enabled: boolean;
    }
  | {
      type: "DUPLICATE_MERGED";
      entityType: "artist" | "album";
      sourceId: string;
      targetId: string;
    }
  | {
      type: "QUEUE_ITEM_CLAIMED";
      queueItemId: string;
      claimedBy: string;
    }
  | {
      type: "QUEUE_ITEM_RESOLVED";
      queueItemId: string;
    };

const CHANNEL_NAME = "curator-sync";

let channel: BroadcastChannel | null = null;
const listeners = new Set<(message: CuratorSyncMessage) => void>();

/**
 * Initialize the broadcast channel (call once on app mount)
 */
export function initCuratorSync() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    console.warn("BroadcastChannel not supported in this environment");
    return;
  }

  if (channel) {
    // Already initialized
    return;
  }

  channel = new BroadcastChannel(CHANNEL_NAME);

  channel.onmessage = (event: MessageEvent<CuratorSyncMessage>) => {
    // Notify all listeners
    listeners.forEach((listener) => {
      try {
        listener(event.data);
      } catch (err) {
        console.error("Error in curator sync listener:", err);
      }
    });
  };

  console.log("[CuratorSync] Initialized");
}

/**
 * Clean up the broadcast channel (call on app unmount)
 */
export function cleanupCuratorSync() {
  if (channel) {
    channel.close();
    channel = null;
    listeners.clear();
    console.log("[CuratorSync] Cleaned up");
  }
}

/**
 * Broadcast a message to all other tabs
 */
export function broadcastCuratorMessage(message: CuratorSyncMessage) {
  if (!channel) {
    console.warn("[CuratorSync] Channel not initialized");
    return;
  }

  try {
    channel.postMessage(message);
    console.log("[CuratorSync] Broadcasted:", message.type);
  } catch (err) {
    console.error("[CuratorSync] Failed to broadcast:", err);
  }
}

/**
 * Subscribe to curator sync messages
 * Returns unsubscribe function
 */
export function subscribeToCuratorSync(
  listener: (message: CuratorSyncMessage) => void,
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * React hook for curator sync
 */
export function useCuratorSync(handler: (message: CuratorSyncMessage) => void) {
  if (typeof window === "undefined") {
    return;
  }

  // Initialize channel if needed
  if (!channel) {
    initCuratorSync();
  }

  // Subscribe to messages
  const unsubscribe = subscribeToCuratorSync(handler);

  // Cleanup on unmount
  return unsubscribe;
}
