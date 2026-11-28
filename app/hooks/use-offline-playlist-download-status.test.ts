/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const mockListForPlaylist = vi.fn();

vi.mock("#app/features/offline-storage/offline-storage.client.ts", () => ({
  getOfflineStorage: () => ({
    listForPlaylist: (...args: unknown[]) => mockListForPlaylist(...args),
  }),
}));

import { useOfflinePlaylistDownloadStatus } from "./use-offline-playlist-download-status.ts";

function summary(trackId: string, isPinned = true) {
  return { trackId, isPinned };
}

describe("useOfflinePlaylistDownloadStatus", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  test("starts checking, then becomes ready with the computed status", async () => {
    mockListForPlaylist.mockResolvedValue([summary("a")]);
    const { result } = renderHook(() => useOfflinePlaylistDownloadStatus("pl-1", ["a", "b"]));

    expect(result.current.phase).toBe("checking");
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(mockListForPlaylist).toHaveBeenCalledWith("pl-1");
    expect([...result.current.status.missingIds]).toEqual(["b"]);
    expect(result.current.status.isPartial).toBe(true);
  });

  test("a new playlistId resets to checking and ignores the stale response", async () => {
    let resolveOld: (value: unknown) => void = () => {};
    mockListForPlaylist.mockImplementationOnce(
      () => new Promise((resolve) => (resolveOld = resolve)),
    );
    mockListForPlaylist.mockResolvedValueOnce([]);

    const { result, rerender } = renderHook(
      ({ id }) => useOfflinePlaylistDownloadStatus(id, ["a"]),
      { initialProps: { id: "pl-1" } },
    );
    rerender({ id: "pl-2" });
    expect(result.current.phase).toBe("checking");
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.status.isComplete).toBe(false);

    await act(async () => {
      resolveOld([summary("a")]);
    });
    expect(result.current.status.isComplete).toBe(false);
    expect([...result.current.status.missingIds]).toEqual(["a"]);
  });

  test("a new array with identical content does not re-query", async () => {
    mockListForPlaylist.mockResolvedValue([]);
    const { result, rerender } = renderHook(
      ({ ids }) => useOfflinePlaylistDownloadStatus("pl-1", ids),
      { initialProps: { ids: ["a", "b"] } },
    );
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    rerender({ ids: ["a", "b"] });
    await act(async () => {});
    expect(mockListForPlaylist).toHaveBeenCalledTimes(1);
  });

  test("an added id re-queries", async () => {
    mockListForPlaylist.mockResolvedValue([summary("a")]);
    const { result, rerender } = renderHook(
      ({ ids }) => useOfflinePlaylistDownloadStatus("pl-1", ids),
      { initialProps: { ids: ["a"] } },
    );
    await waitFor(() => expect(result.current.status.isComplete).toBe(true));
    rerender({ ids: ["a", "b"] });
    await waitFor(() => expect([...result.current.status.missingIds]).toEqual(["b"]));
    expect(mockListForPlaylist).toHaveBeenCalledTimes(2);
  });

  test("fails open when listForPlaylist rejects", async () => {
    mockListForPlaylist.mockRejectedValue(new Error("indexeddb blocked"));
    const { result } = renderHook(() => useOfflinePlaylistDownloadStatus("pl-1", ["a", "b"]));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.status.isComplete).toBe(false);
    expect([...result.current.status.missingIds]).toEqual(["a", "b"]);
  });

  test("a stale refresh from an older render still uses the latest track ids", async () => {
    mockListForPlaylist.mockResolvedValue([summary("a"), summary("b")]);
    const { result, rerender } = renderHook(
      ({ ids }) => useOfflinePlaylistDownloadStatus("pl-1", ids),
      { initialProps: { ids: ["a", "b"] } },
    );
    await waitFor(() => expect(result.current.status.isComplete).toBe(true));
    const staleRefresh = result.current.refresh;

    rerender({ ids: ["a", "b", "c"] });
    await waitFor(() => expect([...result.current.status.missingIds]).toEqual(["c"]));

    await act(async () => {
      await staleRefresh();
    });
    expect([...result.current.status.missingIds]).toEqual(["c"]);
    expect(result.current.status.isComplete).toBe(false);
  });

  test("refresh re-queries and updates state", async () => {
    mockListForPlaylist.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useOfflinePlaylistDownloadStatus("pl-1", ["a"]));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.status.isComplete).toBe(false);

    mockListForPlaylist.mockResolvedValueOnce([summary("a")]);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.status.isComplete).toBe(true);
  });
});
