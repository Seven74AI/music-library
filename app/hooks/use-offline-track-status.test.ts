/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const mockGetRecord = vi.fn();

vi.mock("#app/features/offline-storage/offline-storage.client.ts", () => ({
  getOfflineStorage: () => ({
    getRecord: (...args: unknown[]) => mockGetRecord(...args),
  }),
}));

import { useOfflineTrackStatus } from "./use-offline-track-status.ts";

describe("useOfflineTrackStatus", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("refresh clears download state when storage lookup rejects", async () => {
    mockGetRecord.mockRejectedValue(new Error("indexeddb unavailable"));

    const { result } = renderHook(() => useOfflineTrackStatus("track-1"));

    await waitFor(() => {
      expect(result.current.isDownloaded).toBe(false);
      expect(result.current.isPinned).toBe(false);
    });

    mockGetRecord.mockRejectedValue(new Error("still down"));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.isDownloaded).toBe(false);
    expect(result.current.isPinned).toBe(false);
  });

  test("refresh reflects a stored offline record", async () => {
    mockGetRecord.mockResolvedValue({ isPinned: true });

    const { result } = renderHook(() => useOfflineTrackStatus("track-2"));

    await waitFor(() => {
      expect(result.current.isDownloaded).toBe(true);
      expect(result.current.isPinned).toBe(true);
    });
  });
});
