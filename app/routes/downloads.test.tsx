/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { type OfflineTrackSummary } from "#app/features/offline-storage/types.ts";

const mockPinQueueCachedTracks = vi.fn();
const mockPurgeQueueCache = vi.fn();
const mockSetQueueCacheEnabled = vi.fn();
const mockToast = vi.fn();
const offlineViewProps = vi.hoisted(() => ({
  last: null as Record<string, unknown> | null,
}));

vi.mock("#app/features/offline-storage/offline-storage.client.ts", () => ({
  getOfflineStorage: () => ({
    pinQueueCachedTracks: (...args: unknown[]) => mockPinQueueCachedTracks(...args),
    purgeQueueCache: (...args: unknown[]) => mockPurgeQueueCache(...args),
  }),
}));

vi.mock("#app/features/offline-storage/queue-cache-preference.client.ts", () => ({
  isQueueCacheEnabled: () => true,
  setQueueCacheEnabled: (...args: unknown[]) => mockSetQueueCacheEnabled(...args),
}));

vi.mock("#app/utils/user.ts", () => ({
  useOptionalUser: () => ({ id: "user-1" }),
}));

vi.mock("#app/components/ui/use-toast.ts", () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock("#app/components/offline/offline-library-view.tsx", () => ({
  OfflineLibraryView: (props: Record<string, unknown>) => {
    offlineViewProps.last = props;
    return <div data-testid="offline-library-view" />;
  },
}));

import DownloadsRoute from "./downloads.tsx";

function summary(
  trackId: string,
  flags: Pick<OfflineTrackSummary, "isPinned" | "isQueueCached">,
): OfflineTrackSummary {
  return {
    trackId,
    title: trackId,
    artistId: "a1",
    artistName: "Artist",
    duration: 60,
    coverObjectKey: null,
    audioFormat: "mp3",
    fileSizeBytes: 1_000_000,
    lastAccessedAt: 0,
    ...flags,
  };
}

function renderDownloads(tracks: OfflineTrackSummary[]) {
  const loaderData = {
    tracks,
    stats: {
      trackCount: tracks.length,
      pinnedCount: tracks.filter((t) => t.isPinned).length,
      totalBytes: tracks.reduce((s, t) => s + t.fileSizeBytes, 0),
      usage: 0,
      quota: 100_000_000,
    },
  };
  const router = createMemoryRouter(
    [{ path: "/", element: <DownloadsRoute loaderData={loaderData} /> }],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("DownloadsRoute", () => {
  beforeEach(() => {
    mockPinQueueCachedTracks.mockReset();
    mockPurgeQueueCache.mockReset();
    mockSetQueueCacheEnabled.mockReset();
    mockToast.mockReset();
    offlineViewProps.last = null;
    mockPinQueueCachedTracks.mockResolvedValue({ promotedCount: 2 });
  });

  test("header uses downloaded and auto-cached counts from tracks", () => {
    renderDownloads([
      summary("d1", { isPinned: true, isQueueCached: false }),
      summary("q1", { isPinned: false, isQueueCached: true }),
    ]);
    expect(screen.getByText(/1 downloaded · 1 auto-cached ·/)).toBeDefined();
    expect(screen.queryByText(/pinned/i)).toBeNull();
  });

  test("disables Download all auto-cached when there are no queue-only tracks", () => {
    renderDownloads([summary("d1", { isPinned: true, isQueueCached: false })]);
    expect(screen.getByRole("button", { name: "Download all auto-cached" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  test("promote dialog confirms and calls pinQueueCachedTracks", async () => {
    const user = userEvent.setup();
    renderDownloads([
      summary("q1", { isPinned: false, isQueueCached: true }),
      summary("q2", { isPinned: false, isQueueCached: true }),
    ]);

    await user.click(screen.getByRole("button", { name: "Download all auto-cached" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Download 2 auto-cached tracks\?/)).toBeDefined();
    expect(within(dialog).getByText(/MB/)).toBeDefined();

    await user.click(within(dialog).getByRole("button", { name: "Download all" }));

    await waitFor(() => {
      expect(mockPinQueueCachedTracks).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalled();
    });
  });

  test("toggling auto-cache checkbox calls setQueueCacheEnabled false", async () => {
    const user = userEvent.setup();
    renderDownloads([]);

    const checkbox = screen.getByRole("checkbox", { name: /Auto-cache queue tracks/i });
    await user.click(checkbox);

    expect(mockSetQueueCacheEnabled).toHaveBeenCalledWith("user-1", false);
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
  });

  test("passes showStorageBadge and downloads play context to OfflineLibraryView", () => {
    renderDownloads([summary("d1", { isPinned: true, isQueueCached: false })]);
    expect(offlineViewProps.last?.showStorageBadge).toBe(true);
    expect(offlineViewProps.last?.playContextType).toBe("downloads");
    expect(typeof offlineViewProps.last?.onOfflineDownloadChange).toBe("function");
  });
});