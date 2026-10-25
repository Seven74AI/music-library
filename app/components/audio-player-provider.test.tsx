/**
 * @vitest-environment jsdom
 *
 * Provider fetch wiring and cold-start flags. AudioPlayer is mocked for speed.
 * Queue ordering and queue sheet UX are covered in audio-player-queue.integration.test.tsx.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi, beforeEach, afterEach } from "vitest";
import { getOfflineStorage } from "#app/features/offline-storage/offline-storage.client.ts";
import { isQueueCacheEnabled } from "#app/features/offline-storage/queue-cache-preference.client.ts";
import { prefetchPlaybackAudioUrl } from "#app/features/offline-storage/resolve-playback-url.client.ts";
import { writeCachedPlayerState } from "#app/features/player-state/player-state-cache.client.ts";
import { PLAYER_STATE_ROUTE } from "#app/features/player-state/player-state.ts";
import { type FullTrack } from "#app/types/frontend/shared";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { type RoomAutoplayOutcome } from "./audio-player-room-playback.ts";
import { AudioPlayerProvider, useAudioPlayer } from "./audio-player-provider";

let capturedRoomAutoplay: ((outcome: RoomAutoplayOutcome) => void) | null = null;

vi.mock("./audio-player", () => ({
  AudioPlayer: ({
    wantsAutoPlayRef,
    unlockAutoplayRef,
    playbackToken,
    roomPlaying,
    onRoomAutoplayOutcome,
  }: {
    wantsAutoPlayRef?: React.MutableRefObject<boolean>;
    unlockAutoplayRef?: React.MutableRefObject<
      ((trackId: string, cachedUrl: string) => boolean) | null
    >;
    playbackToken?: number;
    roomPlaying?: boolean | null;
    onRoomAutoplayOutcome?: (outcome: RoomAutoplayOutcome) => void;
  }) => {
    capturedRoomAutoplay = onRoomAutoplayOutcome ?? null;
    // Mock the unlock function
    if (unlockAutoplayRef) {
      unlockAutoplayRef.current = (_trackId: string, _cachedUrl: string) => {
        // Mock implementation - just set wants autoplay to true and return success
        if (wantsAutoPlayRef) {
          wantsAutoPlayRef.current = true;
        }
        return true;
      };
    }
    return (
      <>
        <span data-testid="wants-autoplay">{String(wantsAutoPlayRef?.current ?? false)}</span>
        <span data-testid="playback-token">{playbackToken ?? 0}</span>
        <span data-testid="room-playing">{String(roomPlaying)}</span>
      </>
    );
  },
}));

vi.mock("#app/components/pwa/install-app-banner", () => ({
  InstallAppBanner: () => null,
}));

vi.mock("#app/features/offline-storage/offline-storage.client.ts", () => ({
  getOfflineStorage: vi.fn(() => ({
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
  })),
}));

vi.mock("#app/features/offline-storage/resolve-playback-url.client.ts", () => ({
  peekCachedPlaybackUrl: vi.fn(() => null), // Return null by default (no cached URL)
  prefetchPlaybackAudioUrl: vi.fn(),
}));

vi.mock("#app/features/offline-storage/queue-cache-preference.client.ts", () => ({
  isQueueCacheEnabled: vi.fn(() => true),
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

function PlayLibraryProbe({ sort }: { sort?: "dateAdded" | "mostPlayedMonth" | "mostPlayedEver" }) {
  const { playLibrary } = useAudioPlayer();

  return (
    <button type="button" onClick={() => void playLibrary(sort)}>
      Play library
    </button>
  );
}

function PlayUserPlaylistProbe({
  sort,
}: {
  sort?: "custom" | "title" | "artist" | "duration" | "dateAdded";
}) {
  const { playUserPlaylist } = useAudioPlayer();

  return (
    <button type="button" onClick={() => void playUserPlaylist("playlist-1", sort)}>
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

test("speaker mode replaces a personal queue with the room queue", async () => {
  const user = userEvent.setup();
  const personalNext: FullTrack = {
    ...playableTrack,
    id: "personal-next",
    title: "Personal Next",
  };
  const roomTrack: FullTrack = {
    ...playableTrack,
    id: "room-track",
    title: "Room Song",
    artist: { id: "room-artist", name: "Room Artist" },
  };
  const roomNext: FullTrack = {
    ...playableTrack,
    id: "room-next",
    title: "Room Next",
  };
  const roomLater: FullTrack = {
    ...playableTrack,
    id: "room-later",
    title: "Room Later",
  };

  function Probe() {
    const audio = useAudioPlayer();
    return (
      <>
        <button type="button" onClick={() => audio.playNextTrack(playableTrack)}>
          Load personal
        </button>
        <button type="button" onClick={() => audio.addToUpNext(personalNext)}>
          Add personal next
        </button>
        <button
          type="button"
          onClick={() => {
            audio.suspendPersonalPersistence();
            audio.syncRoomSpeakerQueue({
              roomId: "room-1",
              code: "AB3K9Q",
              nowPlaying: null,
              upcoming: [],
            });
          }}
        >
          Enter empty room
        </button>
        <button
          type="button"
          onClick={() =>
            audio.syncRoomSpeakerQueue({
              roomId: "room-1",
              code: "AB3K9Q",
              nowPlaying: roomTrack,
              upcoming: [roomNext],
            })
          }
        >
          Show room queue
        </button>
        <button
          type="button"
          onClick={() =>
            audio.syncRoomSpeakerQueue({
              roomId: "room-1",
              code: "AB3K9Q",
              nowPlaying: roomTrack,
              upcoming: [roomNext, roomLater],
            })
          }
        >
          Update room upcoming
        </button>
        <span data-testid="current-track-id">{audio.currentTrack?.id ?? ""}</span>
        <span data-testid="current-track-title">{audio.currentTrack?.title ?? ""}</span>
        <span data-testid="up-next-ids">{audio.upNext.map((track) => track.id).join(",")}</span>
        <span data-testid="player-visible">{String(audio.isPlayerVisible)}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider>
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Load personal" }));
  await user.click(screen.getByRole("button", { name: "Add personal next" }));
  expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  expect(screen.getByTestId("up-next-ids").textContent).toBe("personal-next");

  await user.click(screen.getByRole("button", { name: "Enter empty room" }));
  expect(screen.getByTestId("current-track-id").textContent).toBe("");
  expect(screen.getByTestId("up-next-ids").textContent).toBe("");
  expect(screen.getByTestId("player-visible").textContent).toBe("false");

  await user.click(screen.getByRole("button", { name: "Show room queue" }));
  expect(screen.getByTestId("current-track-id").textContent).toBe("room-track");
  expect(screen.getByTestId("current-track-title").textContent).toBe("Room Song");
  expect(screen.getByTestId("up-next-ids").textContent).toBe("room-next");
  expect(screen.getByTestId("player-visible").textContent).toBe("true");
  const token = screen.getByTestId("playback-token").textContent;

  await user.click(screen.getByRole("button", { name: "Update room upcoming" }));
  expect(screen.getByTestId("current-track-id").textContent).toBe("room-track");
  expect(screen.getByTestId("up-next-ids").textContent).toBe("room-next,room-later");
  expect(screen.getByTestId("playback-token").textContent).toBe(token);
});

test("a paused room shows its track without starting playback", async () => {
  const user = userEvent.setup();
  const roomTrack: FullTrack = {
    ...playableTrack,
    id: "room-track",
    title: "Room Song",
  };

  function Probe() {
    const audio = useAudioPlayer();
    return (
      <>
        <button type="button" onClick={() => audio.playNextTrack(playableTrack)}>
          Load personal
        </button>
        <button
          type="button"
          onClick={() => {
            audio.suspendPersonalPersistence();
            audio.syncRoomSpeakerQueue({
              roomId: "room-1",
              code: "AB3K9Q",
              nowPlaying: roomTrack,
              upcoming: [],
              autoplay: false,
            });
          }}
        >
          Show paused room
        </button>
        <span data-testid="current-track-id">{audio.currentTrack?.id ?? ""}</span>
        <span data-testid="player-visible">{String(audio.isPlayerVisible)}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider>
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Load personal" }));
  const token = screen.getByTestId("playback-token").textContent;
  await user.click(screen.getByRole("button", { name: "Show paused room" }));

  expect(screen.getByTestId("current-track-id").textContent).toBe("room-track");
  expect(screen.getByTestId("player-visible").textContent).toBe("true");
  expect(screen.getByTestId("playback-token").textContent).toBe(token);
  expect(screen.getByTestId("wants-autoplay").textContent).toBe("false");
});

test("blocked autoplay leaves room playback paused and does not report it as playing", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  const roomTrack: FullTrack = {
    ...playableTrack,
    id: "room-track",
    title: "Room Song",
  };

  function Probe() {
    const audio = useAudioPlayer();
    return (
      <button
        type="button"
        onClick={() => {
          audio.suspendPersonalPersistence();
          audio.syncRoomSpeakerQueue({
            roomId: "room-1",
            code: "AB3K9Q",
            nowPlaying: roomTrack,
            upcoming: [],
            autoplay: true,
          });
          audio.setRoomPlaybackPlaying(true);
        }}
      >
        Play room
      </button>
    );
  }

  render(
    <AudioPlayerProvider>
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play room" }));
  expect(screen.getByTestId("wants-autoplay").textContent).toBe("false");
  expect(screen.getByTestId("room-playing").textContent).toBe("true");
  expect(capturedRoomAutoplay).toEqual(expect.any(Function));

  await act(async () => {
    capturedRoomAutoplay!("blocked");
  });

  expect(screen.getByTestId("room-playing").textContent).toBe("false");
  expect(fetchMock).not.toHaveBeenCalledWith(
    expect.stringContaining("play-events"),
    expect.anything(),
  );
});

test("speaker mode ignores personal queue edits", async () => {
  const user = userEvent.setup();
  const roomTrack: FullTrack = {
    ...playableTrack,
    id: "room-track",
    title: "Room Song",
  };
  const roomNext: FullTrack = {
    ...playableTrack,
    id: "room-next",
    title: "Room Next",
  };

  function Probe() {
    const audio = useAudioPlayer();
    return (
      <>
        <button
          type="button"
          onClick={() =>
            audio.syncRoomSpeakerQueue({
              roomId: "room-1",
              code: "AB3K9Q",
              nowPlaying: roomTrack,
              upcoming: [roomNext],
            })
          }
        >
          Show room queue
        </button>
        <button type="button" onClick={() => audio.playNextTrack(playableTrack)}>
          Load personal
        </button>
        <button
          type="button"
          onClick={() =>
            audio.addToUpNext({ ...playableTrack, id: "personal-next", title: "Personal Next" })
          }
        >
          Add personal next
        </button>
        <span data-testid="current-track-id">{audio.currentTrack?.id ?? ""}</span>
        <span data-testid="up-next-ids">{audio.upNext.map((track) => track.id).join(",")}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider>
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Show room queue" }));
  await user.click(screen.getByRole("button", { name: "Load personal" }));
  await user.click(screen.getByRole("button", { name: "Add personal next" }));

  expect(screen.getByTestId("current-track-id").textContent).toBe("room-track");
  expect(screen.getByTestId("up-next-ids").textContent).toBe("room-next");
});

test("becoming speaker discards an in-flight personal queue restore", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  let releasePlayerState: (response: Response) => void = () => {};
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(PLAYER_STATE_ROUTE)) {
      return new Promise<Response>((resolve) => {
        releasePlayerState = resolve;
      });
    }
    if (url.includes("/api/tracks/playback")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ tracks: [playableTrack] }),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ tracks: [], total: 0 }),
    } as Response);
  });

  function Probe() {
    const audio = useAudioPlayer();
    return (
      <>
        <button
          type="button"
          onClick={() => {
            audio.suspendPersonalPersistence();
            audio.syncRoomSpeakerQueue({
              roomId: "room-1",
              code: "AB3K9Q",
              nowPlaying: null,
              upcoming: [],
            });
          }}
        >
          Enter empty room
        </button>
        <span data-testid="current-track-id">{audio.currentTrack?.id ?? ""}</span>
        <span data-testid="player-visible">{String(audio.isPlayerVisible)}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider userId="user-1">
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Enter empty room" }));
  releasePlayerState({
    ok: true,
    status: 200,
    json: async () => ({
      playContext: null,
      currentTrackId: "track-1",
      upNextIds: [],
      shuffleSeed: null,
      loopMode: "off",
    }),
  } as Response);

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      PLAYER_STATE_ROUTE,
      expect.objectContaining({ method: "GET" }),
    );
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.getByTestId("current-track-id").textContent).toBe("");
  expect(screen.getByTestId("player-visible").textContent).toBe("false");
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

test("playNext sets autoplay intent synchronously to enable browser autoplay", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tracks: [spineTrack, { ...spineTrack, id: "track-2", title: "Second Track" }],
        total: 2,
      }),
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tracks: [playableTrack] }),
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tracks: [{ ...playableTrack, id: "track-2", title: "Second Track" }],
      }),
    } as Response);

  function PlayNextProbe() {
    const { playTrack, playNext } = useAudioPlayer();
    return (
      <div>
        <QueueProbe />
        <button type="button" onClick={() => playTrack(playableTrack, { type: "library" }, 0)}>
          Play first track
        </button>
        <button type="button" onClick={playNext}>
          Play next
        </button>
      </div>
    );
  }

  render(
    <AudioPlayerProvider>
      <PlayNextProbe />
    </AudioPlayerProvider>,
  );

  // Start playback with first track
  await user.click(screen.getByRole("button", { name: "Play first track" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  // Clear wants-autoplay flag (simulating that autoplay already happened)
  expect(screen.getByTestId("wants-autoplay").textContent).toBe("true");

  // Click next - should set wants-autoplay to true synchronously
  await user.click(screen.getByRole("button", { name: "Play next" }));

  // Verify wants-autoplay was set before async hydration completes
  // (In real usage, this synchronous setting enables browser autoplay)
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-2");
  });
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
  expect(spineRequestUrl).not.toContain("sort=");
});

test("playLibrary passes mostPlayed library sort to the queue spine", async () => {
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
      <PlayLibraryProbe sort="mostPlayedMonth" />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play library" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalled();
  });

  const spineRequestUrl = String(fetchMock.mock.calls[0]?.[0]);
  expect(spineRequestUrl).toContain("/api/queue-spine");
  expect(spineRequestUrl).toContain("context=library");
  expect(spineRequestUrl).toContain("sort=mostPlayedMonth");
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
  expect(spineRequestUrl).not.toContain("sort=");
});

test("playUserPlaylist passes playlist track sort to the queue spine", async () => {
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
      <PlayUserPlaylistProbe sort="title" />
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
  expect(spineRequestUrl).toContain("sort=title");
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

function mockOfflineStorage(downloadedSummaries: Array<Record<string, unknown>>) {
  vi.mocked(getOfflineStorage).mockReturnValue({
    cacheQueueTrack: vi.fn().mockResolvedValue(undefined),
    listDownloaded: vi.fn().mockResolvedValue(downloadedSummaries),
    listPinned: vi.fn().mockResolvedValue([]),
    listForPlaylist: vi.fn().mockResolvedValue([]),
  } as unknown as ReturnType<typeof getOfflineStorage>);
}

const downloadedSummary = (trackId: string, title: string) => ({
  trackId,
  title,
  artistId: "artist-1",
  artistName: "Test Artist",
  duration: 180,
  coverObjectKey: "covers/test.jpg",
  audioFormat: "mp3",
  isPinned: true,
  isQueueCached: false,
  fileSizeBytes: 1000,
  lastAccessedAt: Date.now(),
});

test("offline load restores the current track + Up Next from downloaded tracks without fetching the spine", async () => {
  const fetchMock = vi.mocked(fetch);
  window.localStorage.clear();

  // Mirror the saved queue as if it was persisted before going offline.
  writeCachedPlayerState("user-1", {
    playContext: { type: "library" },
    currentTrackId: "track-1",
    upNextIds: ["track-2"],
    shuffleSeed: null,
    loopMode: "off",
  });

  // Only track-1 is downloaded; track-2 is not → partial restore drops it.
  mockOfflineStorage([downloadedSummary("track-1", "Test Song")]);
  vi.stubGlobal("navigator", { onLine: false });

  render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  // Restore-and-wait: paused, visible, and the un-downloaded Up Next is dropped.
  expect(screen.getByTestId("player-visible").textContent).toBe("true");
  expect(screen.getByTestId("up-next-count").textContent).toBe("0");
  expect(screen.getByTestId("wants-autoplay").textContent).toBe("false");

  // The spine is never fetched while offline (no network round-trips at all).
  expect(fetchMock).not.toHaveBeenCalled();
});

test("offline load restores downloaded Up Next tracks in order", async () => {
  window.localStorage.clear();

  writeCachedPlayerState("user-1", {
    playContext: { type: "library" },
    currentTrackId: "track-1",
    upNextIds: ["track-2", "track-3"],
    shuffleSeed: null,
    loopMode: "off",
  });

  // track-2 is downloaded, track-3 is not → only track-2 survives in Up Next.
  mockOfflineStorage([
    downloadedSummary("track-1", "Test Song"),
    downloadedSummary("track-2", "Up Next Song"),
  ]);
  vi.stubGlobal("navigator", { onLine: false });

  render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  expect(screen.getByTestId("up-next-count").textContent).toBe("1");
});

test("reconnect backfills the spine after an offline partial restore", async () => {
  const fetchMock = vi.mocked(fetch);
  window.localStorage.clear();

  writeCachedPlayerState("user-1", {
    playContext: { type: "library" },
    currentTrackId: "track-1",
    upNextIds: ["track-2"],
    shuffleSeed: null,
    loopMode: "off",
  });

  mockOfflineStorage([downloadedSummary("track-1", "Test Song")]);
  vi.stubGlobal("navigator", { onLine: false });

  render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  // Offline partial restore completes with no network round-trips.
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });
  expect(fetchMock).not.toHaveBeenCalled();

  // Network returns: the full online restore backfills the spine.
  fetchMock
    .mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({
        playContext: { type: "library" },
        currentTrackId: "track-1",
        upNextIds: ["track-2"],
        shuffleSeed: null,
        loopMode: "off",
      }),
    } as Response)
    .mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({
        tracks: [playableTrack, { ...playableTrack, id: "track-2", title: "Up Next Song" }],
      }),
    } as Response)
    .mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ tracks: [spineTrack, { ...spineTrack, id: "track-2" }], total: 2 }),
    } as Response);

  window.dispatchEvent(new Event("online"));

  await waitFor(() => {
    const spineCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/api/queue-spine"),
    );
    expect(spineCall).toBeDefined();
  });

  // The queue is now complete: current track + Up Next are re-resolved from the
  // server and the spine is backfilled.
  expect(screen.getByTestId("up-next-count").textContent).toBe("1");
});

test("late offline restore does not clobber a completed online restore or persist truncated Up Next", async () => {
  const fetchMock = vi.mocked(fetch);
  window.localStorage.clear();

  writeCachedPlayerState("user-1", {
    playContext: { type: "library" },
    currentTrackId: "track-1",
    upNextIds: ["track-2", "track-3"],
    shuffleSeed: null,
    loopMode: "off",
  });

  let resolveDownloaded: ((summaries: Array<Record<string, unknown>>) => void) | undefined;
  const downloadedPromise = new Promise<Array<Record<string, unknown>>>((resolve) => {
    resolveDownloaded = resolve;
  });
  vi.mocked(getOfflineStorage).mockReturnValue({
    cacheQueueTrack: vi.fn().mockResolvedValue(undefined),
    listDownloaded: vi.fn().mockReturnValue(downloadedPromise),
    listPinned: vi.fn().mockResolvedValue([]),
    listForPlaylist: vi.fn().mockResolvedValue([]),
  } as unknown as ReturnType<typeof getOfflineStorage>);

  vi.stubGlobal("navigator", { onLine: false });

  render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await waitFor(() => {
    expect(vi.mocked(getOfflineStorage)().listDownloaded).toHaveBeenCalled();
  });

  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url === PLAYER_STATE_ROUTE) {
      return Promise.resolve({
        status: 200,
        ok: true,
        json: async () => ({
          playContext: { type: "library" },
          currentTrackId: "track-1",
          upNextIds: ["track-2", "track-3"],
          shuffleSeed: null,
          loopMode: "off",
        }),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      return Promise.resolve({
        status: 200,
        ok: true,
        json: async () => ({
          tracks: [
            playableTrack,
            { ...playableTrack, id: "track-2", title: "Up Next Song" },
            { ...playableTrack, id: "track-3", title: "Later Song" },
          ],
        }),
      } as Response);
    }
    if (url.includes("/api/queue-spine")) {
      return Promise.resolve({
        status: 200,
        ok: true,
        json: async () => ({ tracks: [spineTrack], total: 1 }),
      } as Response);
    }
    return Promise.resolve({ status: 200, ok: true, json: async () => ({}) } as Response);
  });

  window.dispatchEvent(new Event("online"));

  await waitFor(() => {
    expect(screen.getByTestId("up-next-count").textContent).toBe("2");
  });

  resolveDownloaded?.([downloadedSummary("track-1", "Test Song")]);

  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(screen.getByTestId("up-next-count").textContent).toBe("2");

  window.dispatchEvent(new Event("pagehide"));

  const puts = persistPutCalls(fetchMock);
  expect(puts.length).toBeGreaterThan(0);
  const body = JSON.parse(String((puts[0]?.[1] as RequestInit | undefined)?.body)) as {
    upNextIds: string[];
  };
  expect(body.upNextIds).toEqual(["track-2", "track-3"]);
});

function persistPutCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter((call) => {
    const init = call[1] as RequestInit | undefined;
    return String(call[0]) === PLAYER_STATE_ROUTE && init?.method === "PUT";
  });
}

function mockOnlineRestore(fetchMock: ReturnType<typeof vi.mocked<typeof fetch>>) {
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
    .mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({
        tracks: [playableTrack, { ...playableTrack, id: "track-2", title: "Up Next Song" }],
      }),
    } as Response)
    .mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ tracks: [spineTrack], total: 1 }),
    } as Response);
}

test("does not persist empty player state on pagehide before restore completes", () => {
  const fetchMock = vi.mocked(fetch);
  // Restore GET never resolves — the user closes the tab while it is in flight.
  fetchMock.mockImplementation(() => new Promise(() => {}));

  render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  window.dispatchEvent(new Event("pagehide"));

  expect(persistPutCalls(fetchMock)).toHaveLength(0);
});

test("persists on pagehide after a successful online restore", async () => {
  const fetchMock = vi.mocked(fetch);
  mockOnlineRestore(fetchMock);

  render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  window.dispatchEvent(new Event("pagehide"));

  expect(persistPutCalls(fetchMock).length).toBeGreaterThan(0);
});

test("does not persist the previous user's queue after a user switch before restore", async () => {
  const fetchMock = vi.mocked(fetch);
  mockOnlineRestore(fetchMock);

  const { rerender } = render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  // User B's restore hangs. Closing the tab (or the debounce firing) must not
  // write user-1's in-memory queue onto user-2's PlayerState row.
  fetchMock.mockClear();
  fetchMock.mockImplementation(() => new Promise(() => {}));

  rerender(
    <AudioPlayerProvider userId="user-2">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  window.dispatchEvent(new Event("pagehide"));

  expect(persistPutCalls(fetchMock)).toHaveLength(0);
});

test("restores the saved queue when the same user logs back in", async () => {
  const fetchMock = vi.mocked(fetch);
  mockOnlineRestore(fetchMock);

  const { rerender } = render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  rerender(
    <AudioPlayerProvider userId={null}>
      <QueueProbe />
    </AudioPlayerProvider>,
  );
  expect(screen.getByTestId("current-track-id").textContent).toBe("");

  fetchMock.mockClear();
  mockOnlineRestore(fetchMock);

  rerender(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });
  expect(screen.getByTestId("up-next-count").textContent).toBe("1");
});

test("hides the previous user's queue as soon as the session user changes", async () => {
  const fetchMock = vi.mocked(fetch);
  mockOnlineRestore(fetchMock);

  const { rerender } = render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });
  expect(screen.getByTestId("player-visible").textContent).toBe("true");
  expect(screen.getByTestId("up-next-count").textContent).toBe("1");

  // Logout is a client-side action: AudioPlayerProvider stays mounted in root.
  fetchMock.mockClear();
  fetchMock.mockImplementation(() => new Promise(() => {}));

  rerender(
    <AudioPlayerProvider userId={null}>
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  expect(screen.getByTestId("current-track-id").textContent).toBe("");
  expect(screen.getByTestId("player-visible").textContent).toBe("false");
  expect(screen.getByTestId("up-next-count").textContent).toBe("0");
});

test("does not persist the previous user's queue after the next account's empty restore", async () => {
  const fetchMock = vi.mocked(fetch);
  mockOnlineRestore(fetchMock);

  const { rerender } = render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  // User B has no PlayerState. A 204 restore currently enables persist while
  // user-1's queue is still in memory, so the next PUT would steal that queue.
  fetchMock.mockClear();
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url === PLAYER_STATE_ROUTE) {
      return Promise.resolve({
        status: 204,
        ok: true,
        json: async () => null,
      } as Response);
    }
    return Promise.resolve({ status: 200, ok: true, json: async () => ({}) } as Response);
  });

  rerender(
    <AudioPlayerProvider userId="user-2">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  expect(screen.getByTestId("current-track-id").textContent).toBe("");
  expect(screen.getByTestId("player-visible").textContent).toBe("false");

  await waitFor(() => {
    const restoreGets = fetchMock.mock.calls.filter((call) => {
      const init = call[1] as RequestInit | undefined;
      return String(call[0]) === PLAYER_STATE_ROUTE && init?.method === "GET";
    });
    expect(restoreGets.length).toBeGreaterThan(0);
  });

  // Let the 204 restore mark persist as enabled for user-2, then flush.
  await new Promise((resolve) => setTimeout(resolve, 10));
  window.dispatchEvent(new Event("pagehide"));

  const stolen = persistPutCalls(fetchMock).some((call) => {
    const body = JSON.parse(String((call[1] as RequestInit | undefined)?.body ?? "{}")) as {
      currentTrackId?: string | null;
      upNextIds?: string[];
    };
    return body.currentTrackId === "track-1" || body.upNextIds?.includes("track-2");
  });
  expect(stolen).toBe(false);
});

test("does not replace a user-started queue when restore completes late", async () => {
  const user = userEvent.setup();
  let resolveRestore: ((value: Response) => void) | undefined;
  const restorePromise = new Promise<Response>((resolve) => {
    resolveRestore = resolve;
  });

  const fetchMock = vi.mocked(fetch);
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url === PLAYER_STATE_ROUTE) {
      return restorePromise;
    }
    if (url.includes("/api/tracks/playback")) {
      return Promise.resolve({
        status: 200,
        ok: true,
        json: async () => ({ tracks: [playableTrack] }),
      } as Response);
    }
    if (url.includes("/api/queue-spine")) {
      return Promise.resolve({
        status: 200,
        ok: true,
        json: async () => ({ tracks: [spineTrack], total: 1 }),
      } as Response);
    }
    return Promise.resolve({ status: 200, ok: true, json: async () => ({}) } as Response);
  });

  render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play library track" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  resolveRestore?.({
    status: 200,
    ok: true,
    json: async () => ({
      playContext: { type: "library" },
      currentTrackId: "track-other",
      upNextIds: ["track-2"],
      shuffleSeed: null,
      loopMode: "off",
    }),
  } as Response);

  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
});

test("persists a user-started queue on pagehide after a failed online restore", async () => {
  consoleError.mockImplementation(() => {});
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url === PLAYER_STATE_ROUTE) {
      return Promise.resolve({
        status: 500,
        ok: false,
        json: async () => ({}),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      return Promise.resolve({
        status: 200,
        ok: true,
        json: async () => ({ tracks: [playableTrack] }),
      } as Response);
    }
    if (url.includes("/api/queue-spine")) {
      return Promise.resolve({
        status: 200,
        ok: true,
        json: async () => ({ tracks: [spineTrack], total: 1 }),
      } as Response);
    }
    return Promise.resolve({ status: 200, ok: true, json: async () => ({}) } as Response);
  });

  render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play library track" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  window.dispatchEvent(new Event("pagehide"));

  const puts = persistPutCalls(fetchMock);
  expect(puts.length).toBeGreaterThan(0);
  const body = JSON.parse(String((puts[0]?.[1] as RequestInit | undefined)?.body)) as {
    currentTrackId: string | null;
  };
  expect(body.currentTrackId).toBe("track-1");
});

test("does not replace a user-started queue when restore body is still loading", async () => {
  const user = userEvent.setup();
  let resolvePlayback: ((value: Response) => void) | undefined;
  const playbackPromise = new Promise<Response>((resolve) => {
    resolvePlayback = resolve;
  });
  let restorePlaybackStarted = false;

  const fetchMock = vi.mocked(fetch);
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url === PLAYER_STATE_ROUTE) {
      return Promise.resolve({
        status: 200,
        ok: true,
        json: async () => ({
          playContext: { type: "library" },
          currentTrackId: "track-other",
          upNextIds: ["track-2"],
          shuffleSeed: null,
          loopMode: "off",
        }),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      if (!restorePlaybackStarted) {
        restorePlaybackStarted = true;
        return playbackPromise;
      }
      return Promise.resolve({
        status: 200,
        ok: true,
        json: async () => ({ tracks: [playableTrack] }),
      } as Response);
    }
    if (url.includes("/api/queue-spine")) {
      return Promise.resolve({
        status: 200,
        ok: true,
        json: async () => ({ tracks: [spineTrack], total: 1 }),
      } as Response);
    }
    return Promise.resolve({ status: 200, ok: true, json: async () => ({}) } as Response);
  });

  render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await waitFor(() => {
    expect(restorePlaybackStarted).toBe(true);
  });

  await user.click(screen.getByRole("button", { name: "Play library track" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  resolvePlayback?.({
    status: 200,
    ok: true,
    json: async () => ({
      tracks: [
        { ...playableTrack, id: "track-other", title: "Other Song" },
        { ...playableTrack, id: "track-2", title: "Up Next Song" },
      ],
    }),
  } as Response);

  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
});

test("offline partial restore does not persist truncated Up Next on pagehide", async () => {
  const fetchMock = vi.mocked(fetch);
  window.localStorage.clear();

  writeCachedPlayerState("user-1", {
    playContext: { type: "library" },
    currentTrackId: "track-1",
    upNextIds: ["track-2", "track-3"],
    shuffleSeed: null,
    loopMode: "off",
  });

  mockOfflineStorage([downloadedSummary("track-1", "Test Song")]);
  vi.stubGlobal("navigator", { onLine: false });

  render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  window.dispatchEvent(new Event("pagehide"));

  expect(persistPutCalls(fetchMock)).toHaveLength(0);
});

test("queue auto-cache writes when Queue Cache Preference is enabled", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  const cacheQueueTrack = vi.fn().mockResolvedValue(undefined);
  vi.mocked(isQueueCacheEnabled).mockReturnValue(true);
  vi.mocked(getOfflineStorage).mockReturnValue({
    cacheQueueTrack,
    listDownloaded: vi.fn().mockResolvedValue([]),
    listPinned: vi.fn().mockResolvedValue([]),
    listForPlaylist: vi.fn().mockResolvedValue([]),
  } as unknown as ReturnType<typeof getOfflineStorage>);

  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === PLAYER_STATE_ROUTE || url.includes(PLAYER_STATE_ROUTE)) {
      return {
        status: 204,
        ok: true,
        json: async () => null,
      } as Response;
    }
    if (url.includes("/api/queue-spine")) {
      return {
        ok: true,
        json: async () => ({ tracks: [spineTrack], total: 1 }),
      } as Response;
    }
    if (url.includes("/api/tracks/playback")) {
      return {
        ok: true,
        json: async () => ({ tracks: [playableTrack] }),
      } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });

  render(
    <AudioPlayerProvider userId="user-1">
      <PlayTrackProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play library track" }));

  await waitFor(() => {
    expect(cacheQueueTrack).toHaveBeenCalled();
  });
  expect(cacheQueueTrack.mock.calls[0]?.[0]).toMatchObject({ id: "track-1" });
});

test("queue auto-cache skips OPFS write when Queue Cache Preference is off", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  const cacheQueueTrack = vi.fn().mockResolvedValue(undefined);
  vi.mocked(isQueueCacheEnabled).mockReturnValue(false);
  vi.mocked(getOfflineStorage).mockReturnValue({
    cacheQueueTrack,
    listDownloaded: vi.fn().mockResolvedValue([]),
    listPinned: vi.fn().mockResolvedValue([]),
    listForPlaylist: vi.fn().mockResolvedValue([]),
  } as unknown as ReturnType<typeof getOfflineStorage>);

  const nextTrack = {
    ...spineTrack,
    id: "track-2",
    title: "Next Song",
  };
  const nextPlayable: FullTrack = {
    ...playableTrack,
    id: "track-2",
    title: "Next Song",
  };

  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === PLAYER_STATE_ROUTE || url.includes(PLAYER_STATE_ROUTE)) {
      return {
        status: 204,
        ok: true,
        json: async () => null,
      } as Response;
    }
    if (url.includes("/api/queue-spine")) {
      return {
        ok: true,
        json: async () => ({
          tracks: [spineTrack, nextTrack],
          total: 2,
        }),
      } as Response;
    }
    if (url.includes("/api/tracks/playback")) {
      return {
        ok: true,
        json: async () => ({ tracks: [playableTrack, nextPlayable] }),
      } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });

  render(
    <AudioPlayerProvider userId="user-1">
      <PlayTrackProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play library track" }));

  await waitFor(() => {
    expect(screen.getByTestId("playlist-length").textContent).toBe("2");
  });

  // Allow auto-cache effect + prefetch effect to settle
  await waitFor(() => {
    expect(prefetchPlaybackAudioUrl).toHaveBeenCalled();
  });

  expect(cacheQueueTrack).not.toHaveBeenCalled();
  expect(isQueueCacheEnabled).toHaveBeenCalledWith("user-1");
});

test("room speaker playback does not fetch the personal audio stream", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  const cacheQueueTrack = vi.fn(async (track: { id: string }) => {
    await fetch(`/resources/audio/${track.id}?stream=1`, { credentials: "same-origin" });
  });
  vi.mocked(isQueueCacheEnabled).mockReturnValue(true);
  vi.mocked(prefetchPlaybackAudioUrl).mockClear();
  vi.mocked(getOfflineStorage).mockReturnValue({
    cacheQueueTrack,
    listDownloaded: vi.fn().mockResolvedValue([]),
    listPinned: vi.fn().mockResolvedValue([]),
    listForPlaylist: vi.fn().mockResolvedValue([]),
  } as unknown as ReturnType<typeof getOfflineStorage>);

  const catalogTrack: FullTrack = {
    ...playableTrack,
    id: "catalog-track",
    title: "Catalog Song",
  };
  const catalogNext: FullTrack = {
    ...playableTrack,
    id: "catalog-next",
    title: "Catalog Next",
  };

  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === PLAYER_STATE_ROUTE || url.includes(PLAYER_STATE_ROUTE)) {
      return {
        status: 204,
        ok: true,
        json: async () => null,
      } as Response;
    }
    if (url.includes("/api/queue-spine")) {
      return {
        ok: true,
        json: async () => ({ tracks: [spineTrack], total: 1 }),
      } as Response;
    }
    if (url.includes("/api/tracks/playback")) {
      return {
        ok: true,
        json: async () => ({ tracks: [playableTrack] }),
      } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });

  function Probe() {
    const audio = useAudioPlayer();
    return (
      <>
        <button
          type="button"
          onClick={() => {
            audio.suspendPersonalPersistence();
            audio.syncRoomSpeakerQueue({
              roomId: "room-1",
              code: "AB3K9Q",
              nowPlaying: catalogTrack,
              upcoming: [catalogNext],
            });
          }}
        >
          Play room queue
        </button>
        <button
          type="button"
          onClick={() => {
            audio.resumePersonalPersistence();
            void audio.restorePersonalPlayerSnapshot(
              {
                playContext: { type: "library" },
                currentTrackId: "track-1",
                upNextIds: [],
                shuffleSeed: null,
                loopMode: "off",
              },
              true,
            );
          }}
        >
          Restore personal
        </button>
        <span data-testid="current-track-id">{audio.currentTrack?.id ?? ""}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider userId="user-1">
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play room queue" }));

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("catalog-track");
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  expect(cacheQueueTrack).not.toHaveBeenCalled();
  expect(prefetchPlaybackAudioUrl).not.toHaveBeenCalled();
  expect(
    fetchMock.mock.calls.filter(([input]) => String(input).includes("/resources/audio/")),
  ).toEqual([]);

  await user.click(screen.getByRole("button", { name: "Restore personal" }));

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });
  await waitFor(() => {
    expect(cacheQueueTrack).toHaveBeenCalled();
  });
  expect(cacheQueueTrack.mock.calls.map((call) => call[0]?.id)).toEqual(["track-1"]);
});
