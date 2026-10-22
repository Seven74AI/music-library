import { describe, expect, test, vi } from "vitest";
import {
  DIALOGS_MAX_AGE_MS,
  SELECTION_MAX_AGE_MS,
  createDebouncedSessionSaver,
  dashboardTabToPersist,
  discardSession,
  hasRecoverableSession,
  loadSession,
  restoreSession,
  saveSessionState,
  summarizeSession,
  type KeyValueStorage,
  type SessionState,
} from "./session-recovery.client.ts";

function memoryStorage(): KeyValueStorage & { snapshot: () => Record<string, string> } {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    snapshot: () => Object.fromEntries(store),
  };
}

const now = Date.parse("2026-10-05T12:00:00.000Z");

function selection(timestamp: number, trackIds = ["track-1", "track-2"]): SessionState {
  return {
    type: "selection",
    trackIds,
    context: "library",
    timestamp,
  };
}

describe("curator session recovery", () => {
  test("saves each state type under its own key", () => {
    const storage = memoryStorage();
    saveSessionState(selection(now), storage);
    saveSessionState(
      {
        type: "dialogs",
        openDialogs: [
          {
            dialogType: "track-edit",
            entityId: "track-1",
            tab: "basic",
            unsavedChanges: { title: "Live" },
          },
        ],
        timestamp: now,
      },
      storage,
    );
    const saved = storage.snapshot();
    expect(saved["curator-session-selection"]).toContain("track-1");
    expect(saved["curator-session-dialogs"]).toContain("unsavedChanges");
    expect(loadSession(storage, now)).toHaveLength(2);
  });

  test("drops selection older than 24 hours and keeps a younger one", () => {
    const storage = memoryStorage();
    saveSessionState(selection(now - SELECTION_MAX_AGE_MS - 1), storage);
    expect(loadSession(storage, now)).toEqual([]);
    expect(storage.snapshot()["curator-session-selection"]).toBeUndefined();

    saveSessionState(selection(now - SELECTION_MAX_AGE_MS + 1000), storage);
    const loaded = loadSession(storage, now);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ type: "selection", trackIds: ["track-1", "track-2"] });
  });

  test("drops unsaved dialogs after 2 hours", () => {
    const storage = memoryStorage();
    saveSessionState(
      {
        type: "dialogs",
        openDialogs: [
          { dialogType: "track-edit", entityId: "track-9", unsavedChanges: { genre: "Jazz" } },
        ],
        timestamp: now - DIALOGS_MAX_AGE_MS - 1,
      },
      storage,
    );
    expect(loadSession(storage, now)).toEqual([]);

    saveSessionState(
      {
        type: "dialogs",
        openDialogs: [{ dialogType: "track-edit", entityId: "track-9" }],
        timestamp: now - 60 * 60 * 1000,
      },
      storage,
    );
    expect(loadSession(storage, now)).toHaveLength(1);
  });

  test("restore returns the saved snapshot and discard removes it", () => {
    const storage = memoryStorage();
    saveSessionState(selection(now, ["a", "b", "c"]), storage);
    saveSessionState(
      {
        type: "filters",
        page: "/music/curator/queue",
        filters: { source: "user_report", status: "open" },
        scrollPosition: 2400,
        timestamp: now - 15 * 60 * 1000,
      },
      storage,
    );

    const restored = restoreSession(storage, now);
    expect(restored.map((state) => state.type).sort()).toEqual(["filters", "selection"]);
    expect(hasRecoverableSession(restored)).toBe(true);
    expect(summarizeSession(restored)).toEqual(
      expect.arrayContaining([
        "3 tracks selected",
        "Review queue filtered to user reports",
        "Scroll position 2400px",
      ]),
    );
    expect(storage.snapshot()["curator-session-selection"]).toBeTruthy();

    discardSession(storage);
    expect(restoreSession(storage, now)).toEqual([]);
    expect(storage.snapshot()).toEqual({});
  });

  test("a dashboard tab is saved only after the curator changes it", () => {
    expect(dashboardTabToPersist(null, "activity")).toBeNull();
    expect(dashboardTabToPersist("activity", "activity")).toBeNull();
    expect(dashboardTabToPersist("reports", "overview")).toBeNull();
    expect(dashboardTabToPersist("overview", "activity")).toBe("activity");
    expect(dashboardTabToPersist("activity", "queue")).toBe("queue");
  });

  test("debounced save writes once after the wait", () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      const saver = createDebouncedSessionSaver(1000, storage);
      saver.save(selection(now, ["one"]));
      saver.save(selection(now, ["one", "two"]));
      expect(storage.snapshot()).toEqual({});
      vi.advanceTimersByTime(999);
      expect(storage.snapshot()).toEqual({});
      vi.advanceTimersByTime(1);
      const saved = JSON.parse(storage.snapshot()["curator-session-selection"]!) as {
        trackIds: string[];
      };
      expect(saved.trackIds).toEqual(["one", "two"]);
      saver.cancel();
    } finally {
      vi.useRealTimers();
    }
  });
});
