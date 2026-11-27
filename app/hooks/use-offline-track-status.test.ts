/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const mockGetRecord = vi.fn();
const mockHasTrack = vi.fn();

vi.mock("#app/features/offline-storage/offline-storage.client.ts", () => ({
  getOfflineStorage: () => ({
    getRecord: (...args: unknown[]) => mockGetRecord(...args),
    hasTrack: (...args: unknown[]) => mockHasTrack(...args),
  }),
}));

import { useOfflineTrackStatus } from "./use-offline-track-status.ts";

describe("useOfflineTrackStatus", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  test("refresh clears download state when storage lookup rejects", async () => {
    mockGetRecord.mockResolvedValueOnce({ isPinned: true, isQueueCached: true });
    mockHasTrack.mockResolvedValue(true);

    const { result } = renderHook(() => useOfflineTrackStatus("track-1"));

    await waitFor(() => {
      expect(result.current.isDownloaded).toBe(true);
      expect(result.current.isPinned).toBe(true);
    });

    mockGetRecord.mockRejectedValue(new Error("indexeddb unavailable"));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.isDownloaded).toBe(false);
    expect(result.current.isPinned).toBe(false);
  });

  test("refresh reflects a stored offline record", async () => {
    mockGetRecord.mockResolvedValue({ isPinned: true });
    mockHasTrack.mockResolvedValue(true);

    const { result } = renderHook(() => useOfflineTrackStatus("track-2"));

    await waitFor(() => {
      expect(result.current.isDownloaded).toBe(true);
      expect(result.current.isPinned).toBe(true);
    });
  });

  test("metadata without OPFS bytes is not reported as downloaded", async () => {
    mockGetRecord.mockResolvedValue({ isPinned: true });
    mockHasTrack.mockResolvedValue(false);

    const { result } = renderHook(() => useOfflineTrackStatus("track-3"));

    await waitFor(() => {
      expect(result.current.isPinned).toBe(true);
    });
    expect(mockHasTrack).toHaveBeenCalledWith("track-3");
    expect(result.current.isDownloaded).toBe(false);
  });
});
