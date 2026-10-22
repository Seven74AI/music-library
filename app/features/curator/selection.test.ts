/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  getSelectionMode,
  setSelectionMode,
  getSelectedTrackIds,
  saveSelectedTrackIds,
  clearSelectedTrackIds,
  useSelectionMode,
  useSelection,
} from "./selection.ts";

// Mock curator sync module
vi.mock("./sync.client", () => ({
  broadcastCuratorMessage: vi.fn(),
  subscribeToCuratorSync: vi.fn(() => vi.fn()),
  initCuratorSync: vi.fn(),
  cleanupCuratorSync: vi.fn(),
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// Mock BroadcastChannel
class BroadcastChannelMock {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
}

Object.defineProperty(globalThis, "BroadcastChannel", {
  value: BroadcastChannelMock,
  writable: true,
});

describe("selection", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe("getSelectionMode", () => {
    it("returns false when nothing is stored", () => {
      expect(getSelectionMode()).toBe(false);
    });

    it("returns true when 'true' is stored", () => {
      localStorageMock.setItem("curator:selection-mode", "true");
      expect(getSelectionMode()).toBe(true);
    });

    it("returns false when 'false' is stored", () => {
      localStorageMock.setItem("curator:selection-mode", "false");
      expect(getSelectionMode()).toBe(false);
    });
  });

  describe("setSelectionMode", () => {
    it("stores true in localStorage", () => {
      setSelectionMode(true);
      expect(localStorageMock.getItem("curator:selection-mode")).toBe("true");
    });

    it("stores false in localStorage", () => {
      setSelectionMode(false);
      expect(localStorageMock.getItem("curator:selection-mode")).toBe("false");
    });
  });

  describe("getSelectedTrackIds", () => {
    it("returns empty set when nothing is stored", () => {
      const result = getSelectedTrackIds();
      expect(result).toEqual(new Set());
    });

    it("returns stored track IDs as a set", () => {
      const trackIds = ["track-1", "track-2", "track-3"];
      localStorageMock.setItem("curator:selected-tracks", JSON.stringify(trackIds));
      const result = getSelectedTrackIds();
      expect(result).toEqual(new Set(trackIds));
    });

    it("returns empty set when stored data is invalid JSON", () => {
      localStorageMock.setItem("curator:selected-tracks", "invalid-json");
      const result = getSelectedTrackIds();
      expect(result).toEqual(new Set());
    });
  });

  describe("saveSelectedTrackIds", () => {
    it("stores track IDs as JSON array", () => {
      const trackIds = new Set(["track-1", "track-2"]);
      saveSelectedTrackIds(trackIds);
      const stored = localStorageMock.getItem("curator:selected-tracks");
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!) as string[];
      expect(new Set(parsed)).toEqual(trackIds);
    });

    it("stores empty array when given empty set", () => {
      saveSelectedTrackIds(new Set());
      const stored = localStorageMock.getItem("curator:selected-tracks");
      expect(stored).toBe("[]");
    });
  });

  describe("clearSelectedTrackIds", () => {
    it("removes track IDs from localStorage", () => {
      localStorageMock.setItem("curator:selected-tracks", '["track-1"]');
      clearSelectedTrackIds();
      expect(localStorageMock.getItem("curator:selected-tracks")).toBeNull();
    });
  });

  describe("useSelectionMode hook", () => {
    it("initializes with stored selection mode", () => {
      localStorageMock.setItem("curator:selection-mode", "true");
      const { result } = renderHook(() => useSelectionMode());
      expect(result.current.selectionMode).toBe(true);
    });

    it("toggles selection mode", () => {
      const { result } = renderHook(() => useSelectionMode());
      expect(result.current.selectionMode).toBe(false);

      act(() => {
        result.current.toggleSelectionMode();
      });

      expect(result.current.selectionMode).toBe(true);
      expect(localStorageMock.getItem("curator:selection-mode")).toBe("true");
    });

    it("clears selected tracks when disabling selection mode", () => {
      localStorageMock.setItem("curator:selection-mode", "true");
      localStorageMock.setItem("curator:selected-tracks", '["track-1"]');

      const { result } = renderHook(() => useSelectionMode());
      expect(result.current.selectionMode).toBe(true);

      act(() => {
        result.current.toggleSelectionMode();
      });

      expect(result.current.selectionMode).toBe(false);
      expect(localStorageMock.getItem("curator:selected-tracks")).toBeNull();
    });
  });

  describe("useSelection hook", () => {
    it("initializes with stored selection", () => {
      const trackIds = ["track-1", "track-2"];
      localStorageMock.setItem("curator:selected-tracks", JSON.stringify(trackIds));

      const { result } = renderHook(() => useSelection());
      expect(result.current.selectedTrackIds).toEqual(new Set(trackIds));
      expect(result.current.selectedCount).toBe(2);
    });

    it("selects all tracks", () => {
      const trackIds = ["track-1", "track-2", "track-3"];
      const { result } = renderHook(() => useSelection());

      act(() => {
        result.current.selectAll(trackIds);
      });

      expect(result.current.selectedTrackIds).toEqual(new Set(trackIds));
      expect(result.current.selectedCount).toBe(3);
    });

    it("deselects all tracks", () => {
      localStorageMock.setItem("curator:selected-tracks", '["track-1", "track-2"]');
      const { result } = renderHook(() => useSelection());

      act(() => {
        result.current.deselectAll();
      });

      expect(result.current.selectedTrackIds).toEqual(new Set());
      expect(result.current.selectedCount).toBe(0);
    });

    it("toggles individual track selection", () => {
      const { result } = renderHook(() => useSelection());

      // Add track
      act(() => {
        result.current.toggleSelection("track-1");
      });
      expect(result.current.selectedTrackIds.has("track-1")).toBe(true);

      // Remove track
      act(() => {
        result.current.toggleSelection("track-1");
      });
      expect(result.current.selectedTrackIds.has("track-1")).toBe(false);
    });

    it("selects range of tracks", () => {
      const allTrackIds = ["track-1", "track-2", "track-3", "track-4", "track-5"];
      const { result } = renderHook(() => useSelection());

      act(() => {
        result.current.selectRange(1, 3, allTrackIds);
      });

      expect(result.current.selectedTrackIds).toEqual(new Set(["track-2", "track-3", "track-4"]));
    });

    it("selects range in reverse order", () => {
      const allTrackIds = ["track-1", "track-2", "track-3", "track-4", "track-5"];
      const { result } = renderHook(() => useSelection());

      act(() => {
        result.current.selectRange(3, 1, allTrackIds);
      });

      expect(result.current.selectedTrackIds).toEqual(new Set(["track-2", "track-3", "track-4"]));
    });

    it("checks if track is selected", () => {
      localStorageMock.setItem("curator:selected-tracks", '["track-1"]');
      const { result } = renderHook(() => useSelection());

      expect(result.current.isSelected("track-1")).toBe(true);
      expect(result.current.isSelected("track-2")).toBe(false);
    });
  });
});
