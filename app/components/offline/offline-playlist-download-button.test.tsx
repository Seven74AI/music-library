/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type FullTrack } from "#app/types/frontend/shared";

const mockDownloadTrack = vi.fn();
const mockListForPlaylist = vi.fn();
const mockCachePlaylistMetadata = vi.fn();
const mockGetCachedPlaylistMetadata = vi.fn();
const mockToast = vi.fn();

vi.mock("#app/features/offline-storage/offline-storage.client.ts", () => ({
  getOfflineStorage: () => ({
    downloadTrack: (...args: unknown[]) => mockDownloadTrack(...args),
    listForPlaylist: (...args: unknown[]) => mockListForPlaylist(...args),
  }),
}));

vi.mock("#app/features/offline-storage/offline-playlist-metadata.client.ts", () => ({
  cachePlaylistMetadata: (...args: unknown[]) => mockCachePlaylistMetadata(...args),
  getCachedPlaylistMetadata: (...args: unknown[]) => mockGetCachedPlaylistMetadata(...args),
}));

vi.mock("#app/components/ui/use-toast.ts", () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

import { OfflinePlaylistDownloadButton } from "./offline-playlist-download-button.tsx";

function makeTrack(id: string) {
  return {
    id,
    title: `Track ${id}`,
    artist: { id: "artist-1", name: "Artist" },
    duration: 100,
    coverImage: null,
    audioFiles: [{ id: `af-${id}`, format: "mp3", objectKey: `k-${id}` }],
  } as unknown as FullTrack;
}

function summary(trackId: string) {
  return { trackId, isPinned: true };
}

const tracks = ["t1", "t2", "t3", "t4", "t5"].map(makeTrack);

function renderButton(
  props: Partial<Parameters<typeof OfflinePlaylistDownloadButton>[0]> = {},
) {
  return render(
    <OfflinePlaylistDownloadButton
      playlistId="pl-1"
      title="Mix"
      description="desc"
      tracks={tracks}
      {...props}
    />,
  );
}

describe("OfflinePlaylistDownloadButton", () => {
  beforeEach(() => {
    mockDownloadTrack.mockResolvedValue(undefined);
    mockListForPlaylist.mockResolvedValue([]);
    mockGetCachedPlaylistMetadata.mockReturnValue(null);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  test("renders nothing when there are no playable tracks", () => {
    const { container } = renderButton({ tracks: [] });
    expect(container).toBeEmptyDOMElement();
  });

  test("S2: disabled while the initial lookup is pending", async () => {
    mockListForPlaylist.mockReturnValue(new Promise(() => {}));
    renderButton();
    const button = screen.getByRole("button", { name: "Download playlist" });
    expect(button).toBeDisabled();
  });

  test("S1: nothing downloaded shows an enabled Download playlist", async () => {
    renderButton();
    const button = screen.getByRole("button", { name: "Download playlist" });
    await waitFor(() => expect(button).toBeEnabled());
  });

  test("S3: fully downloaded shows a disabled Downloaded button", async () => {
    mockListForPlaylist.mockResolvedValue(tracks.map((t) => summary(t.id)));
    renderButton();
    const button = await screen.findByRole("button", { name: "Downloaded" });
    expect(button).toBeDisabled();
    expect(button.querySelector("use")?.getAttribute("href")).toContain("check");
    await userEvent.click(button);
    expect(mockDownloadTrack).not.toHaveBeenCalled();
  });

  test("S4: partial state downloads only the missing tracks", async () => {
    mockListForPlaylist.mockResolvedValue([summary("t1"), summary("t2")]);
    renderButton();
    const button = await screen.findByRole("button", { name: "Download 3 missing tracks" });
    await userEvent.click(button);

    await waitFor(() => expect(mockDownloadTrack).toHaveBeenCalledTimes(3));
    expect(mockDownloadTrack.mock.calls.map((call) => (call[0] as FullTrack).id)).toEqual([
      "t3",
      "t4",
      "t5",
    ]);
    for (const call of mockDownloadTrack.mock.calls) {
      expect(call[1]).toEqual({ pin: true, playlistId: "pl-1" });
    }
  });

  test("S4: singular label for one missing track", async () => {
    mockListForPlaylist.mockResolvedValue(tracks.slice(0, 4).map((t) => summary(t.id)));
    renderButton();
    expect(
      await screen.findByRole("button", { name: "Download 1 missing track" }),
    ).toBeInTheDocument();
  });

  test("S5: flips to Downloaded after a successful download", async () => {
    mockListForPlaylist.mockResolvedValueOnce([]);
    renderButton();
    const button = await screen.findByRole("button", { name: "Download playlist" });
    await waitFor(() => expect(button).toBeEnabled());

    mockListForPlaylist.mockResolvedValue(tracks.map((t) => summary(t.id)));
    await userEvent.click(button);

    expect(await screen.findByRole("button", { name: "Downloaded" })).toBeDisabled();
    expect(mockDownloadTrack).toHaveBeenCalledTimes(5);
    expect(mockCachePlaylistMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pl-1", title: "Mix", description: "desc" }),
    );
  });

  test("S6: partial failure shows remaining missing tracks and a destructive toast", async () => {
    renderButton({ tracks: tracks.slice(0, 2) });
    const button = await screen.findByRole("button", { name: "Download playlist" });
    await waitFor(() => expect(button).toBeEnabled());

    mockDownloadTrack.mockResolvedValueOnce(undefined);
    mockDownloadTrack.mockRejectedValueOnce(new Error("boom"));
    mockListForPlaylist.mockResolvedValue([summary("t1")]);
    await userEvent.click(button);

    expect(
      await screen.findByRole("button", { name: "Download 1 missing track" }),
    ).toBeEnabled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Playlist partially downloaded",
        variant: "destructive",
      }),
    );
    expect(mockCachePlaylistMetadata).not.toHaveBeenCalled();
  });

  test("S7: remount after download shows Downloaded without downloading", async () => {
    mockListForPlaylist.mockResolvedValue(tracks.map((t) => summary(t.id)));
    const first = renderButton();
    await screen.findByRole("button", { name: "Downloaded" });
    first.unmount();

    renderButton();
    expect(await screen.findByRole("button", { name: "Downloaded" })).toBeDisabled();
    expect(mockDownloadTrack).not.toHaveBeenCalled();
  });

  test("S8: reacts to tracks being added or removed", async () => {
    mockListForPlaylist.mockResolvedValue(tracks.map((t) => summary(t.id)));
    const view = renderButton();
    await screen.findByRole("button", { name: "Downloaded" });

    const extra = makeTrack("t6");
    view.rerender(
      <OfflinePlaylistDownloadButton
        playlistId="pl-1"
        title="Mix"
        description="desc"
        tracks={[...tracks, extra]}
      />,
    );
    expect(
      await screen.findByRole("button", { name: "Download 1 missing track" }),
    ).toBeInTheDocument();

    view.rerender(
      <OfflinePlaylistDownloadButton
        playlistId="pl-1"
        title="Mix"
        description="desc"
        tracks={tracks.slice(1)}
      />,
    );
    expect(await screen.findByRole("button", { name: "Downloaded" })).toBeInTheDocument();
  });

  test("S13: writes missing playlist metadata once when already downloaded", async () => {
    mockListForPlaylist.mockResolvedValue(tracks.map((t) => summary(t.id)));
    mockGetCachedPlaylistMetadata.mockReturnValue(null);
    renderButton();
    await screen.findByRole("button", { name: "Downloaded" });
    await waitFor(() => expect(mockCachePlaylistMetadata).toHaveBeenCalledTimes(1));
    expect(mockCachePlaylistMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pl-1", title: "Mix", description: "desc" }),
    );
  });

  test("S13: does not rewrite unchanged playlist metadata", async () => {
    mockListForPlaylist.mockResolvedValue(tracks.map((t) => summary(t.id)));
    mockGetCachedPlaylistMetadata.mockReturnValue({
      id: "pl-1",
      title: "Mix",
      description: "desc",
      updatedAt: 123,
    });
    renderButton();
    await screen.findByRole("button", { name: "Downloaded" });
    expect(mockCachePlaylistMetadata).not.toHaveBeenCalled();
  });

  test("S13: refreshes metadata when the title changed, preserving updatedAt", async () => {
    mockListForPlaylist.mockResolvedValue(tracks.map((t) => summary(t.id)));
    mockGetCachedPlaylistMetadata.mockReturnValue({
      id: "pl-1",
      title: "Old",
      description: "desc",
      updatedAt: 123,
    });
    renderButton();
    await waitFor(() =>
      expect(mockCachePlaylistMetadata).toHaveBeenCalledWith({
        id: "pl-1",
        title: "Mix",
        description: "desc",
        updatedAt: 123,
      }),
    );
  });
});
