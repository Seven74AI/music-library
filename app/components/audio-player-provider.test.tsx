/**
 * @vitest-environment jsdom
 *
 * Provider fetch wiring and cold-start flags. AudioPlayer is mocked for speed.
 * Queue ordering and queue sheet UX are covered in audio-player-queue.integration.test.tsx.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi, beforeEach, afterEach } from "vitest";
import { type FullTrack } from "#app/types/frontend/shared";
import { AudioPlayerProvider, useAudioPlayer } from "./audio-player-provider";

vi.mock("./audio-player", () => ({
  AudioPlayer: ({ wantsAutoPlayRef }: { wantsAutoPlayRef?: React.MutableRefObject<boolean> }) => (
    <span data-testid="wants-autoplay">{String(wantsAutoPlayRef?.current ?? false)}</span>
  ),
}));

vi.mock("#app/components/pwa/install-app-banner", () => ({
  InstallAppBanner: () => null,
}));

vi.mock("#app/features/offline-storage/offline-storage.client.ts", () => ({
  getOfflineStorage: () => ({
    cacheQueueTrack: vi.fn().mockResolvedValue(undefined),
    listDownloaded: vi.fn().mockResolvedValue([
      {
        trackId: "track-1",
        title: "Test Song",
        artistId: "artist-1",
        artistName: "Test Artist",
        duration: 180,
        coverObjectKey: "covers/test.jpg",
        audioFormat: "mp3",
        isPinned: true,
        isQueueCached: false,
        fileSizeBytes: 1000,
        lastAccessedAt: Date.now(),
      },
    ]),
    listPinned: vi.fn().mockResolvedValue([
      {
        trackId: "track-1",
        title: "Test Song",
        artistId: "artist-1",
        artistName: "Test Artist",
        duration: 180,
        coverObjectKey: "covers/test.jpg",
        audioFormat: "mp3",
        isPinned: true,
        isQueueCached: false,
        fileSizeBytes: 1000,
        lastAccessedAt: Date.now(),
      },
    ]),
    listForPlaylist: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("#app/features/offline-storage/resolve-playback-url.client.ts", () => ({
  prefetchPlaybackAudioUrl: vi.fn(),
}));

const playableTrack: FullTrack = {
  id: "track-1",
  title: "Test Song",
  artist: { id: "artist-1", name: "Test Artist" },
  duration: 180,
  coverImage: { objectKey: "covers/test.jpg" },
  audioFiles: [{ id: "af-1", format: "mp3", objectKey: "audio/test.mp3" }],
};

const spineTrack = {
  id: "track-1",
  title: "Test Song",
  artist: { id: "artist-1", name: "Test Artist" },
};

function QueueProbe() {
  const {
    playNextTrack,
    addToUpNext,
    playTrack,
    startQueuePlayback,
    currentTrack,
    isPlayerVisible,
    hasQueuedPlayback,
    upNext,
  } = useAudioPlayer();

  return (
    <>
      <button type="button" onClick={() => playNextTrack(playableTrack)}>
        Play next track
      </button>
      <button type="button" onClick={() => addToUpNext(playableTrack)}>
        Add to up next
      </button>
      <button type="button" onClick={() => void startQueuePlayback()}>
        Start queue playback
      </button>
      <button type="button" onClick={() => playTrack(playableTrack, { type: "library" }, 0)}>
        Play library track
      </button>
      <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
      <span data-testid="player-visible">{String(isPlayerVisible)}</span>
      <span data-testid="has-queued-playback">{String(hasQueuedPlayback)}</span>
      <span data-testid="up-next-count">{upNext.length}</span>
    </>
  );
}

function PlayTrackProbe() {
  const { playTrack, playlist } = useAudioPlayer();

  return (
    <>
      <button type="button" onClick={() => playTrack(playableTrack, { type: "library" }, 0)}>
        Play library track
      </button>
      <span data-testid="playlist-length">{playlist.length}</span>
    </>
  );
}

function PlayArtistTrackProbe() {
  const { playTrack } = useAudioPlayer();

  return (
    <button
      type="button"
      onClick={() => playTrack(playableTrack, { type: "artist", artistId: "artist-1" }, 0)}
    >
      Play artist track
    </button>
  );
}

function PlayAlbumTrackProbe() {
  const { playTrack } = useAudioPlayer();

  return (
    <button
      type="button"
      onClick={() => playTrack(playableTrack, { type: "album", albumId: "album-1" }, 0)}
    >
      Play album track
    </button>
  );
}

function PlaySingleTrackProbe() {
  const { playTrack } = useAudioPlayer();

  return (
    <button
      type="button"
      onClick={() => playTrack(playableTrack, { type: "track", trackId: "track-1" }, 0)}
    >
      Play single track
    </button>
  );
}

function PlayLibraryProbe() {
  const { playLibrary } = useAudioPlayer();

  return (
    <button type="button" onClick={() => void playLibrary()}>
      Play library
    </button>
  );
}

function PlayUserPlaylistProbe() {
  const { playUserPlaylist } = useAudioPlayer();

  return (
    <button type="button" onClick={() => void playUserPlaylist("playlist-1")}>
      Play user playlist
    </button>
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("playNextTrack on cold start cues track as current without autoplay", async () => {
  const user = userEvent.setup();

  render(
    <AudioPlayerProvider>
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play next track" }));

  expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  expect(screen.getByTestId("player-visible").textContent).toBe("true");
  expect(screen.getByTestId("up-next-count").textContent).toBe("0");
  expect(screen.getByTestId("wants-autoplay").textContent).toBe("false");
});

test("addToUpNext opens queue-only playback without autoplay when idle", async () => {
  const user = userEvent.setup();

  render(
    <AudioPlayerProvider>
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Add to up next" }));

  expect(screen.getByTestId("up-next-count").textContent).toBe("1");
  expect(screen.getByTestId("current-track-id").textContent).toBe("");
  expect(screen.getByTestId("player-visible").textContent).toBe("true");
  expect(screen.getByTestId("has-queued-playback").textContent).toBe("true");
  expect(screen.getByTestId("wants-autoplay").textContent).toBe("false");
});

test("startQueuePlayback plays the first Up Next track when idle", async () => {
  const user = userEvent.setup();

  render(
    <AudioPlayerProvider>
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Add to up next" }));
  await user.click(screen.getByRole("button", { name: "Start queue playback" }));

  expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  expect(screen.getByTestId("up-next-count").textContent).toBe("0");
});

test("playTrack loads queue spine and hydrates playback for the clicked track", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tracks: [spineTrack, { ...spineTrack, id: "track-2", title: "Other" }],
        total: 2,
      }),
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tracks: [playableTrack] }),
    } as Response);

  render(
    <AudioPlayerProvider>
      <PlayTrackProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play library track" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalled();
  });

  const spineRequestUrl = String(fetchMock.mock.calls[0]?.[0]);
  expect(spineRequestUrl).toContain("/api/queue-spine");
  expect(spineRequestUrl).toContain("context=library");
  expect(spineRequestUrl).toContain("hasAudio=1");

  const hydrationRequestUrl = String(fetchMock.mock.calls[1]?.[0]);
  expect(hydrationRequestUrl).toContain("/api/tracks/playback");
});

test("playLibrary requests queue spine and hydrates the first track", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tracks: [spineTrack],
        total: 1,
      }),
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tracks: [playableTrack] }),
    } as Response);

  render(
    <AudioPlayerProvider>
      <PlayLibraryProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play library" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalled();
  });

  const spineRequestUrl = String(fetchMock.mock.calls[0]?.[0]);
  expect(spineRequestUrl).toContain("/api/queue-spine");
  expect(spineRequestUrl).toContain("hasAudio=1");
});

test("playTrack requests artist queue spine and hydrates playback", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tracks: [spineTrack],
        total: 1,
      }),
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tracks: [playableTrack] }),
    } as Response);

  render(
    <AudioPlayerProvider>
      <PlayArtistTrackProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play artist track" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalled();
  });

  const spineRequestUrl = String(fetchMock.mock.calls[0]?.[0]);
  expect(spineRequestUrl).toContain("/api/queue-spine");
  expect(spineRequestUrl).toContain("context=artist");
  expect(spineRequestUrl).toContain("artistId=artist-1");
});

test("playTrack requests album queue spine and hydrates playback", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tracks: [spineTrack],
        total: 1,
      }),
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tracks: [playableTrack] }),
    } as Response);

  render(
    <AudioPlayerProvider>
      <PlayAlbumTrackProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play album track" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalled();
  });

  const spineRequestUrl = String(fetchMock.mock.calls[0]?.[0]);
  expect(spineRequestUrl).toContain("/api/queue-spine");
  expect(spineRequestUrl).toContain("context=album");
  expect(spineRequestUrl).toContain("albumId=album-1");
});

test("playTrack requests one-track spine and hydrates playback", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tracks: [spineTrack],
        total: 1,
      }),
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tracks: [playableTrack] }),
    } as Response);

  render(
    <AudioPlayerProvider>
      <PlaySingleTrackProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play single track" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalled();
  });

  const spineRequestUrl = String(fetchMock.mock.calls[0]?.[0]);
  expect(spineRequestUrl).toContain("/api/queue-spine");
  expect(spineRequestUrl).toContain("context=track");
  expect(spineRequestUrl).toContain("trackId=track-1");
});

test("playUserPlaylist requests playlist queue spine and hydrates playback", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tracks: [spineTrack],
        total: 1,
      }),
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tracks: [playableTrack] }),
    } as Response);

  render(
    <AudioPlayerProvider>
      <PlayUserPlaylistProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play user playlist" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalled();
  });

  const spineRequestUrl = String(fetchMock.mock.calls[0]?.[0]);
  expect(spineRequestUrl).toContain("/api/queue-spine");
  expect(spineRequestUrl).toContain("context=playlist");
  expect(spineRequestUrl).toContain("playlistId=playlist-1");
});

test("playTrack falls back to offline downloads when online spine fetch fails", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("navigator", { onLine: false });

  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 503,
    statusText: "Service Unavailable",
  } as Response);

  render(
    <AudioPlayerProvider>
      <PlayTrackProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play library track" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalled();
    expect(screen.getByTestId("playlist-length").textContent).toBe("1");
  });

  consoleError.mockRestore();
  vi.unstubAllGlobals();
});

test("restores the saved queue on mount, paused, without autoplay", async () => {
  const fetchMock = vi.mocked(fetch);

  // 1. GET /resources/player-state — a saved library queue with an Up Next
  //    addition and shuffle enabled.
  fetchMock
    .mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({
        playContext: { type: "library" },
        currentTrackId: "track-1",
        upNextIds: ["track-2"],
        shuffleSeed: 42,
        loopMode: "off",
      }),
    } as Response)
    // 2. GET /api/tracks/playback — resolve current track + Up Next ids.
    .mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({
        tracks: [playableTrack, { ...playableTrack, id: "track-2", title: "Up Next Song" }],
      }),
    } as Response)
    // 3. GET /api/queue-spine — re-derived library spine.
    .mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ tracks: [spineTrack], total: 1 }),
    } as Response);

  render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  // Restore-and-wait: the player is visible, the current track is restored,
  // and no autoplay was requested.
  expect(screen.getByTestId("player-visible").textContent).toBe("true");
  expect(screen.getByTestId("up-next-count").textContent).toBe("1");
  expect(screen.getByTestId("wants-autoplay").textContent).toBe("false");
});
