/**
 * Selection state for bulk operations.
 * Handles track selection with localStorage persistence and BroadcastChannel sync.
 *
 * This module is intentionally not `*.client.ts`. Route components call these
 * hooks during SSR, and React Router replaces `.client` exports with
 * `undefined` in the server bundle.
 *
 * State is read from localStorage after mount so the server render and the
 * first client render stay in sync.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  clearSessionState,
  saveSessionState,
  SESSION_SAVE_DEBOUNCE_MS,
} from "./session-recovery.client.ts";
import {
  broadcastCuratorMessage,
  subscribeToCuratorSync,
  type CuratorSyncMessage,
} from "./sync.client";

const SELECTION_MODE_KEY = "curator:selection-mode";
const SELECTED_TRACKS_KEY = "curator:selected-tracks";

// BroadcastChannel does not deliver a message to the channel that posted it.
// The selection switch and the library list are separate hook instances in the
// same tab, so they subscribe here and are notified directly on write.
const selectionModeListeners = new Set<(enabled: boolean) => void>();
const selectedTrackListeners = new Set<(trackIds: string[]) => void>();

let selectionSessionTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSelectionIds: string[] | null = null;

function flushSelectionSession() {
  if (selectionSessionTimer) clearTimeout(selectionSessionTimer);
  selectionSessionTimer = null;
  const trackIds = pendingSelectionIds;
  pendingSelectionIds = null;
  if (!trackIds || typeof saveSessionState !== "function") return;
  if (trackIds.length === 0) {
    if (typeof clearSessionState === "function") clearSessionState("selection");
    return;
  }
  saveSessionState({
    type: "selection",
    trackIds,
    context: "library",
    timestamp: Date.now(),
  });
}

function persistSelectionSession(trackIds: string[]) {
  if (typeof saveSessionState !== "function") return;
  pendingSelectionIds = trackIds;
  if (selectionSessionTimer) clearTimeout(selectionSessionTimer);
  selectionSessionTimer = setTimeout(flushSelectionSession, SESSION_SAVE_DEBOUNCE_MS);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushSelectionSession);
}

function notifyListeners<T>(listeners: Set<(value: T) => void>, value: T) {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      console.error("Error in selection listener:", error);
    }
  }
}

function readStorageItem(key: string): string | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Read whether selection mode is enabled from localStorage. */
export function getSelectionMode(): boolean {
  return readStorageItem(SELECTION_MODE_KEY) === "true";
}

/**
 * Set selection mode in localStorage
 */
export function setSelectionMode(enabled: boolean): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    globalThis.localStorage.setItem(SELECTION_MODE_KEY, String(enabled));
    notifyListeners(selectionModeListeners, enabled);
    // Broadcast to other tabs
    broadcastCuratorMessage({
      type: "SELECTION_MODE_CHANGED",
      enabled,
    });
  } catch (error) {
    console.error("Failed to save selection mode:", error);
  }
}

/**
 * Get selected track IDs from localStorage
 */
export function getSelectedTrackIds(): Set<string> {
  try {
    const stored = readStorageItem(SELECTED_TRACKS_KEY);
    if (!stored) return new Set();
    const parsed = JSON.parse(stored) as string[];
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

/**
 * Save selected track IDs to localStorage
 */
export function saveSelectedTrackIds(trackIds: Set<string>): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    const array = Array.from(trackIds);
    globalThis.localStorage.setItem(SELECTED_TRACKS_KEY, JSON.stringify(array));
    notifyListeners(selectedTrackListeners, array);
    // Broadcast to other tabs
    broadcastCuratorMessage({
      type: "SELECTION_UPDATED",
      trackIds: array,
    });
  } catch (error) {
    console.error("Failed to save selected tracks:", error);
  }
}

/**
 * Clear selected track IDs from localStorage
 */
export function clearSelectedTrackIds(): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    globalThis.localStorage.removeItem(SELECTED_TRACKS_KEY);
    notifyListeners(selectedTrackListeners, []);
    // Broadcast to other tabs
    broadcastCuratorMessage({
      type: "SELECTION_UPDATED",
      trackIds: [],
    });
  } catch (error) {
    console.error("Failed to clear selected tracks:", error);
  }
}

/**
 * React hook for selection mode
 */
export function useSelectionMode() {
  const [selectionMode, setSelectionModeState] = useState(false);

  useEffect(() => {
    setSelectionModeState(getSelectionMode());

    const onSelectionMode = (enabled: boolean) => {
      setSelectionModeState(enabled);
    };
    selectionModeListeners.add(onSelectionMode);

    // Subscribe to selection mode changes from other tabs
    const unsubscribe = subscribeToCuratorSync((message: CuratorSyncMessage) => {
      if (message.type === "SELECTION_MODE_CHANGED") {
        setSelectionModeState(message.enabled);
      }
    });

    return () => {
      selectionModeListeners.delete(onSelectionMode);
      unsubscribe();
    };
  }, []);

  const toggleSelectionMode = useCallback(() => {
    const newMode = !selectionMode;
    setSelectionMode(newMode);
    setSelectionModeState(newMode);

    // Clear selection when disabling selection mode
    if (!newMode) {
      clearSelectedTrackIds();
    }
  }, [selectionMode]);

  return {
    selectionMode,
    toggleSelectionMode,
  };
}

/**
 * React hook for track selection state
 */
export function useSelection() {
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(() => new Set());
  const selectedTrackIdsRef = useRef(selectedTrackIds);
  selectedTrackIdsRef.current = selectedTrackIds;

  const replaceSelection = useCallback((next: Set<string>) => {
    selectedTrackIdsRef.current = next;
    setSelectedTrackIds(next);
    saveSelectedTrackIds(next);
    persistSelectionSession(Array.from(next));
  }, []);

  useEffect(() => {
    setSelectedTrackIds(getSelectedTrackIds());

    const onSelectedTracks = (trackIds: string[]) => {
      setSelectedTrackIds(new Set(trackIds));
    };
    selectedTrackListeners.add(onSelectedTracks);

    // Subscribe to selection changes from other tabs
    const unsubscribe = subscribeToCuratorSync((message: CuratorSyncMessage) => {
      if (message.type === "SELECTION_UPDATED") {
        setSelectedTrackIds(new Set(message.trackIds));
      }
    });

    return () => {
      selectedTrackListeners.delete(onSelectedTracks);
      unsubscribe();
    };
  }, []);

  const selectAll = useCallback(
    (trackIds: string[]) => {
      replaceSelection(new Set(trackIds));
    },
    [replaceSelection],
  );

  const deselectAll = useCallback(() => {
    selectedTrackIdsRef.current = new Set();
    setSelectedTrackIds(new Set());
    clearSelectedTrackIds();
    persistSelectionSession([]);
  }, []);

  const toggleSelection = useCallback(
    (trackId: string) => {
      const next = new Set(selectedTrackIdsRef.current);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      replaceSelection(next);
    },
    [replaceSelection],
  );

  const selectRange = useCallback(
    (startIndex: number, endIndex: number, allTrackIds: string[]) => {
      const min = Math.min(startIndex, endIndex);
      const max = Math.max(startIndex, endIndex);
      const rangeIds = allTrackIds.slice(min, max + 1);
      const next = new Set(selectedTrackIdsRef.current);
      rangeIds.forEach((id) => next.add(id));
      replaceSelection(next);
    },
    [replaceSelection],
  );

  const isSelected = useCallback(
    (trackId: string) => selectedTrackIds.has(trackId),
    [selectedTrackIds],
  );

  return {
    selectedTrackIds,
    selectAll,
    deselectAll,
    toggleSelection,
    selectRange,
    isSelected,
    selectedCount: selectedTrackIds.size,
  };
}
