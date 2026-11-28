/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { type OfflineTrackSummary } from "#app/features/offline-storage/types.ts";

const capturedProps = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tanstack/react-virtual", () => ({
  useWindowVirtualizer: ({
    count,
  }: {
    count: number;
    estimateSize: (index: number) => number;
  }) => ({
    getTotalSize: () => count * 72,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 72,
      })),
    measureElement: () => {},
  }),
}));

vi.mock("#app/components/track-list-item.tsx", () => ({
  TrackListItem: (props: Record<string, unknown>) => {
    capturedProps.items.push(props);
    return <div data-testid={`track-${String(props.track && (props.track as { id: string }).id)}`} />;
  },
}));

import { OfflineLibraryView } from "./offline-library-view.tsx";

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
    fileSizeBytes: 1000,
    lastAccessedAt: 0,
    ...flags,
  };
}

describe("OfflineLibraryView", () => {
  beforeEach(() => {
    capturedProps.items.length = 0;
  });

  test("does not pass offlineStorageKind when showStorageBadge is false", () => {
    render(
      <OfflineLibraryView
        tracks={[summary("t1", { isPinned: true, isQueueCached: false })]}
      />,
    );
    expect(capturedProps.items[0]?.offlineStorageKind).toBeUndefined();
  });

  test("passes offlineStorageKind when showStorageBadge is true", () => {
    render(
      <OfflineLibraryView
        showStorageBadge
        tracks={[
          summary("pinned", { isPinned: true, isQueueCached: false }),
          summary("queue", { isPinned: false, isQueueCached: true }),
        ]}
      />,
    );
    expect(capturedProps.items.map((item) => item.offlineStorageKind)).toEqual([
      "downloaded",
      "auto-cached",
    ]);
  });

  test("forwards onOfflineDownloadChange and playContextType", () => {
    const onChange = vi.fn();
    render(
      <OfflineLibraryView
        playContextType="downloads"
        onOfflineDownloadChange={onChange}
        tracks={[summary("t1", { isPinned: true, isQueueCached: false })]}
      />,
    );
    expect(capturedProps.items[0]?.onOfflineDownloadChange).toBe(onChange);
    expect((capturedProps.items[0]?.playlistContext as { type: string }).type).toBe("downloads");
  });
});