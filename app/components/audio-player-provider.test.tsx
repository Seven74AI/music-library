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

const { unlockCalls } = vi.hoisted(() => ({
  unlockCalls: [] as Array<{ trackId: string; url: string }>,
}));

let capturedRoomAutoplay: ((outcome: RoomAutoplayOutcome) => void) | null = null;
let capturedPlayingChange: ((isPlaying: boolean) => void) | null = null;

vi.mock("./audio-player", () => ({
  AudioPlayer: ({
    wantsAutoPlayRef,
    unlockAutoplayRef,
    pausePlaybackRef,
    resumePlaybackRef,
    playbackToken,
    roomPlaying,
    onRoomAutoplayOutcome,
    onPlayingChange,
  }: {
    wantsAutoPlayRef?: React.MutableRefObject<boolean>;
    unlockAutoplayRef?: React.MutableRefObject<
      ((trackId: string, cachedUrl: string) => boolean) | null
    >;
    pausePlaybackRef?: React.MutableRefObject<(() => void) | null>;
    resumePlaybackRef?: React.MutableRefObject<(() => void) | null>;
    playbackToken?: number;
    roomPlaying?: boolean | null;
    onRoomAutoplayOutcome?: (outcome: RoomAutoplayOutcome) => void;
    onPlayingChange?: (isPlaying: boolean) => void;
  }) => {
    capturedRoomAutoplay = onRoomAutoplayOutcome ?? null;
    capturedPlayingChange = onPlayingChange ?? null;
    // Mock the unlock function
    if (unlockAutoplayRef) {
      unlockAutoplayRef.current = (trackId: string, cachedUrl: string) => {
        unlockCalls.push({ trackId, url: cachedUrl });
        // Mock implementation - just set wants autoplay to true and return success
        if (wantsAutoPlayRef) {
          wantsAutoPlayRef.current = true;
        }
        return true;
      };
    }
    if (pausePlaybackRef) {
      pausePlaybackRef.current = () => {
        onPlayingChange?.(false);
      };
    }
    if (resumePlaybackRef) {
      resumePlaybackRef.current = () => {
        onPlayingChange?.(true);
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

vi.mock("#app/components/pwa/install-app-banner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#app/components/pwa/install-app-banner")>();
  return {
    ...actual,
    InstallAppBanner: () => null,
  };
});

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
  unlockCalls.length = 0;
  capturedPlayingChange = null;
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("exposes isPlaying and updates it when the audio player reports playback", async () => {
  function Probe() {
    const { isPlaying } = useAudioPlayer();
    return <span data-testid="hook-is-playing">{String(isPlaying)}</span>;
  }

  render(
    <AudioPlayerProvider>
      <Probe />
    </AudioPlayerProvider>,
  );

  expect(screen.getByTestId("hook-is-playing").textContent).toBe("false");
  expect(capturedPlayingChange).toEqual(expect.any(Function));

  await act(async () => {
    capturedPlayingChange!(true);
  });
  expect(screen.getByTestId("hook-is-playing").textContent).toBe("true");

  await act(async () => {
    capturedPlayingChange!(false);
  });
  expect(screen.getByTestId("hook-is-playing").textContent).toBe("false");
});

test("playPlaylist starts at the next playable track when startIndex is not playable", async () => {
  const user = userEvent.setup();

  const unplayable: FullTrack = {
    ...playableTrack,
    id: "track-missing-audio",
    title: "No Audio",
    audioFiles: [],
  };
  const secondPlayable: FullTrack = {
    ...playableTrack,
    id: "track-2",
    title: "Playable Second",
  };

  function Probe() {
    const { playPlaylist, currentTrack } = useAudioPlayer();
    return (
      <>
        <button
          type="button"
          onClick={() => playPlaylist([unplayable, secondPlayable], { type: "library" }, 0)}
        >
          Play list from blocked start
        </button>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider>
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: /play list from blocked start/i }));
  expect(screen.getByTestId("current-track-id").textContent).toBe("track-2");
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

test("leaving speaker after a refresh restores the saved personal queue instead of wiping it", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  const savedPlayerState = {
    playContext: { type: "library" as const },
    currentTrackId: "track-1",
    upNextIds: [],
    shuffleSeed: null,
    loopMode: "off" as const,
  };
  let releasePlayerState: (response: Response) => void = () => {};
  let playerStateReleased = false;
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes(PLAYER_STATE_ROUTE) && (!init?.method || init.method === "GET")) {
      if (playerStateReleased) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => savedPlayerState,
        } as Response);
      }
      return new Promise<Response>((resolve) => {
        releasePlayerState = (response) => {
          playerStateReleased = true;
          resolve(response);
        };
      });
    }
    if (url.includes(PLAYER_STATE_ROUTE) && init?.method === "PUT") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response);
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
              nowPlaying: {
                ...playableTrack,
                id: "room-track",
                title: "Room Song",
              },
              upcoming: [],
            });
          }}
        >
          Enter speaker
        </button>
        <button
          type="button"
          onClick={() => {
            audio.resumePersonalPersistence();
            void audio.restorePersonalPlayerSnapshot(
              {
                playContext: null,
                currentTrackId: null,
                upNextIds: [],
                shuffleSeed: null,
                loopMode: "off",
              },
              false,
            );
          }}
        >
          Leave speaker
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

  await user.click(screen.getByRole("button", { name: "Enter speaker" }));
  releasePlayerState({
    ok: true,
    status: 200,
    json: async () => savedPlayerState,
  } as Response);

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      PLAYER_STATE_ROUTE,
      expect.objectContaining({ method: "GET" }),
    );
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.getByTestId("current-track-id").textContent).toBe("room-track");

  await user.click(screen.getByRole("button", { name: "Leave speaker" }));

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });
  expect(screen.getByTestId("player-visible").textContent).toBe("true");

  await new Promise((resolve) => setTimeout(resolve, 1100));
  const emptyPersists = fetchMock.mock.calls.filter((call) => {
    const init = call[1] as RequestInit | undefined;
    if (!String(call[0]).includes(PLAYER_STATE_ROUTE) || init?.method !== "PUT") return false;
    const body = JSON.parse(String(init.body)) as { currentTrackId: string | null };
    return body.currentTrackId === null;
  });
  expect(emptyPersists).toEqual([]);
});

test("leaving speaker before the delayed restore fetch still reloads the saved queue", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  const savedPlayerState = {
    playContext: { type: "library" as const },
    currentTrackId: "track-1",
    upNextIds: [],
    shuffleSeed: null,
    loopMode: "off" as const,
  };
  let initialPlayerStateGets = 0;
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes(PLAYER_STATE_ROUTE) && (!init?.method || init.method === "GET")) {
      initialPlayerStateGets += 1;
      if (initialPlayerStateGets === 1) {
        return new Promise<Response>(() => {});
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => savedPlayerState,
      } as Response);
    }
    if (url.includes(PLAYER_STATE_ROUTE) && init?.method === "PUT") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response);
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
              nowPlaying: {
                ...playableTrack,
                id: "room-track",
                title: "Room Song",
              },
              upcoming: [],
            });
          }}
        >
          Enter speaker
        </button>
        <button
          type="button"
          onClick={() => {
            audio.resumePersonalPersistence();
            void audio.restorePersonalPlayerSnapshot(
              {
                playContext: null,
                currentTrackId: null,
                upNextIds: [],
                shuffleSeed: null,
                loopMode: "off",
              },
              false,
            );
          }}
        >
          Leave speaker
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

  await user.click(screen.getByRole("button", { name: "Enter speaker" }));
  expect(screen.getByTestId("current-track-id").textContent).toBe("room-track");
  await user.click(screen.getByRole("button", { name: "Leave speaker" }));

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });
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

test("playPrevious applies the cached source for the track you return to", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  const { peekCachedPlaybackUrl } =
    await import("#app/features/offline-storage/resolve-playback-url.client.ts");
  vi.mocked(peekCachedPlaybackUrl).mockImplementation(
    (id: string) => `https://cdn.example/${id}.mp3`,
  );

  const track2: FullTrack = {
    ...playableTrack,
    id: "track-2",
    title: "Second Track",
    audioFiles: [{ id: "af-2", format: "mp3", objectKey: "audio/test2.mp3" }],
  };

  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/queue-spine")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          tracks: [spineTrack, { ...spineTrack, id: "track-2", title: "Second Track" }],
          total: 2,
        }),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      const tracks = [playableTrack, track2].filter((track) => ids.includes(track.id));
      return Promise.resolve({
        ok: true,
        json: async () => ({ tracks }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  function Probe() {
    const { playTrack, playNext, playPrevious, currentTrack } = useAudioPlayer();
    return (
      <div>
        <button type="button" onClick={() => playTrack(playableTrack, { type: "library" }, 0)}>
          Play first track
        </button>
        <button type="button" onClick={playNext}>
          Play next
        </button>
        <button type="button" onClick={playPrevious}>
          Play previous
        </button>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
      </div>
    );
  }

  render(
    <AudioPlayerProvider>
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play first track" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  await user.click(screen.getByRole("button", { name: "Play next" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-2");
  });

  unlockCalls.length = 0;
  await user.click(screen.getByRole("button", { name: "Play previous" }));

  expect(unlockCalls).toContainEqual({
    trackId: "track-1",
    url: "https://cdn.example/track-1.mp3",
  });
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });
});

test("slow playNext completion does not overwrite a newer playPrevious", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);

  const track2: FullTrack = {
    ...playableTrack,
    id: "track-2",
    title: "Second Track",
    audioFiles: [{ id: "af-2", format: "mp3", objectKey: "audio/test2.mp3" }],
  };
  const track3: FullTrack = {
    ...playableTrack,
    id: "track-3",
    title: "Third Track",
    audioFiles: [{ id: "af-3", format: "mp3", objectKey: "audio/test3.mp3" }],
  };

  let releaseTrack3Playback!: () => void;
  let track3Released = false;
  const track3PlaybackGate = new Promise<void>((resolve) => {
    releaseTrack3Playback = () => {
      track3Released = true;
      resolve();
    };
  });
  let deferTrack3Playback = false;

  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/queue-spine")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          tracks: [
            spineTrack,
            { ...spineTrack, id: "track-2", title: "Second Track" },
            { ...spineTrack, id: "track-3", title: "Third Track" },
          ],
          total: 3,
        }),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      if (deferTrack3Playback && ids.includes("track-3") && !track3Released) {
        return track3PlaybackGate.then(
          () =>
            ({
              ok: true,
              json: async () => ({
                tracks: [playableTrack, track2, track3].filter((track) => ids.includes(track.id)),
              }),
            }) as Response,
        );
      }
      const tracks = [playableTrack, track2, track3]
        .filter((track) => ids.includes(track.id))
        .filter((track) => track.id !== "track-3" || track3Released);
      return Promise.resolve({
        ok: true,
        json: async () => ({ tracks }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  function Probe() {
    const { playTrack, playNext, playPrevious, currentTrack } = useAudioPlayer();
    return (
      <div>
        <button type="button" onClick={() => playTrack(playableTrack, { type: "library" }, 0)}>
          Play first track
        </button>
        <button type="button" onClick={playNext}>
          Play next
        </button>
        <button type="button" onClick={playPrevious}>
          Play previous
        </button>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
      </div>
    );
  }

  render(
    <AudioPlayerProvider>
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play first track" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  await user.click(screen.getByRole("button", { name: "Play next" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-2");
  });

  deferTrack3Playback = true;
  void user.click(screen.getByRole("button", { name: "Play next" }));
  await user.click(screen.getByRole("button", { name: "Play previous" }));

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  releaseTrack3Playback();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
});

test("playNext advances to a queue-cached track while offline", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  const { peekCachedPlaybackUrl } =
    await import("#app/features/offline-storage/resolve-playback-url.client.ts");
  vi.mocked(peekCachedPlaybackUrl).mockImplementation(
    (id: string) => `https://cdn.example/${id}.mp3`,
  );

  const spineTrack = { ...playableTrack, id: "track-1" };
  const track2: FullTrack = {
    ...playableTrack,
    id: "track-2",
    title: "Second Track",
    audioFiles: [{ id: "af-2", format: "mp3", objectKey: "audio/test2.mp3" }],
  };

  let playbackFetchCount = 0;
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/queue-spine")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          tracks: [spineTrack, { ...spineTrack, id: "track-2", title: "Second Track" }],
          total: 2,
        }),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      playbackFetchCount += 1;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return Promise.reject(new Error("offline"));
      }
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      const tracks = [spineTrack, track2].filter((track) => ids.includes(track.id));
      return Promise.resolve({
        ok: true,
        json: async () => ({ tracks }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  vi.stubGlobal("navigator", { ...(navigator as Navigator), onLine: true });

  function Probe() {
    const { playTrack, playNext, currentTrack } = useAudioPlayer();
    return (
      <div>
        <button type="button" onClick={() => playTrack(playableTrack, { type: "library" }, 0)}>
          Play first track
        </button>
        <button type="button" onClick={playNext}>
          Play next
        </button>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
      </div>
    );
  }

  render(
    <AudioPlayerProvider>
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play first track" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  const playbackFetchesBeforeOffline = playbackFetchCount;

  await act(async () => {
    vi.stubGlobal("navigator", { ...(navigator as Navigator), onLine: false });
    window.dispatchEvent(new Event("offline"));
  });

  await user.click(screen.getByRole("button", { name: "Play next" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-2");
  });

  expect(playbackFetchCount).toBe(playbackFetchesBeforeOffline);
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

test("playTrack uses pinned downloads when offline without calling queue spine", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  vi.stubGlobal("navigator", { onLine: false });
  await act(async () => {
    window.dispatchEvent(new Event("offline"));
  });

  render(
    <AudioPlayerProvider>
      <PlayTrackProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play library track" }));

  await waitFor(() => {
    expect(screen.getByTestId("playlist-length").textContent).toBe("1");
  });
  expect(fetchMock).not.toHaveBeenCalled();

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
  const navigatorState = { onLine: false };
  vi.stubGlobal("navigator", navigatorState);

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

  navigatorState.onLine = true;
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

  const navigatorState = { onLine: false };
  vi.stubGlobal("navigator", navigatorState);

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

  navigatorState.onLine = true;
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

test("resumeTrack resumes without bumping playback token or clearing Up Next", async () => {
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

  const queued: FullTrack = {
    ...playableTrack,
    id: "queued-track",
    title: "Queued",
    audioFiles: [{ id: "af-q", format: "mp3", objectKey: "audio/queued.mp3" }],
  };

  function ResumeProbe() {
    const { playTrack, pauseTrack, resumeTrack, isPlaying, upNext, addToUpNext } = useAudioPlayer();
    return (
      <>
        <button type="button" onClick={() => playTrack(playableTrack, { type: "library" }, 0)}>
          Play library track
        </button>
        <button type="button" onClick={() => addToUpNext(queued)}>
          Add queued track
        </button>
        <button type="button" onClick={() => pauseTrack()}>
          Pause track
        </button>
        <button type="button" onClick={() => resumeTrack()}>
          Resume track
        </button>
        <span data-testid="hook-is-playing">{String(isPlaying)}</span>
        <span data-testid="up-next-count">{upNext.length}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider>
      <ResumeProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play library track" }));
  await waitFor(() => {
    expect(screen.getByTestId("playback-token").textContent).not.toBe("0");
  });
  const tokenAfterPlay = screen.getByTestId("playback-token").textContent;

  await user.click(screen.getByRole("button", { name: "Add queued track" }));
  expect(screen.getByTestId("up-next-count").textContent).toBe("1");

  await user.click(screen.getByRole("button", { name: "Pause track" }));
  expect(screen.getByTestId("hook-is-playing").textContent).toBe("false");
  expect(screen.getByTestId("up-next-count").textContent).toBe("1");

  await user.click(screen.getByRole("button", { name: "Resume track" }));
  expect(screen.getByTestId("playback-token").textContent).toBe(tokenAfterPlay);
  expect(screen.getByTestId("hook-is-playing").textContent).toBe("true");
  expect(screen.getByTestId("up-next-count").textContent).toBe("1");
});

test("pauseTrack pauses without bumping playback token", async () => {
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

  function PauseProbe() {
    const { playTrack, pauseTrack, isPlaying } = useAudioPlayer();
    return (
      <>
        <button type="button" onClick={() => playTrack(playableTrack, { type: "library" }, 0)}>
          Play library track
        </button>
        <button type="button" onClick={() => pauseTrack()}>
          Pause track
        </button>
        <span data-testid="hook-is-playing">{String(isPlaying)}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider>
      <PauseProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play library track" }));
  await waitFor(() => {
    expect(screen.getByTestId("playback-token").textContent).not.toBe("0");
  });
  const tokenAfterPlay = screen.getByTestId("playback-token").textContent;

  await user.click(screen.getByRole("button", { name: "Pause track" }));
  expect(screen.getByTestId("playback-token").textContent).toBe(tokenAfterPlay);
  expect(screen.getByTestId("hook-is-playing").textContent).toBe("false");
});

test("clicking a catalog row absent from the ownership-filtered spine does not start playback", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);

  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      tracks: [{ ...spineTrack, id: "track-owned-only", title: "Owned" }],
      total: 1,
    }),
  } as Response);

  function AbsentSpineProbe() {
    const { playTrack, isPlayerVisible, currentTrack } = useAudioPlayer();
    return (
      <>
        <button
          type="button"
          onClick={() => playTrack(playableTrack, { type: "artist", artistId: "artist-1" }, 0)}
        >
          Play artist track
        </button>
        <span data-testid="player-visible">{String(isPlayerVisible)}</span>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider>
      <AbsentSpineProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play artist track" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalled();
  });

  expect(screen.getByTestId("player-visible").textContent).toBe("false");
  expect(screen.getByTestId("current-track-id").textContent).toBe("");
});

test("playLibrary with empty ownership spine does not clear Up Next", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);

  const queued: FullTrack = {
    ...playableTrack,
    id: "queued-track",
    title: "Queued",
    audioFiles: [{ id: "af-q", format: "mp3", objectKey: "audio/queued.mp3" }],
  };

  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(PLAYER_STATE_ROUTE)) {
      return Promise.resolve({
        status: 204,
        ok: true,
        json: async () => null,
      } as Response);
    }
    if (url.includes("/resources/audio/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ url: "https://cdn.example/stream.mp3" }),
      } as Response);
    }
    if (url.includes("/api/queue-spine")) {
      if (url.includes("context=artist")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ tracks: [spineTrack], total: 1 }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ tracks: [], total: 0 }),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      const tracks = [playableTrack, queued].filter((track) => ids.includes(track.id));
      return Promise.resolve({
        ok: true,
        json: async () => ({ tracks }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  function Probe() {
    const { playTrack, playLibrary, addToUpNext, currentTrack, upNext } = useAudioPlayer();
    return (
      <>
        <button
          type="button"
          onClick={() => playTrack(playableTrack, { type: "artist", artistId: "artist-1" }, 0)}
        >
          Play artist track
        </button>
        <button type="button" onClick={() => addToUpNext(queued)}>
          Add queued track
        </button>
        <button type="button" onClick={() => void playLibrary()}>
          Play library all
        </button>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
        <span data-testid="up-next-count">{upNext.length}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider userId="user-1">
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play artist track" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  await user.click(screen.getByRole("button", { name: "Add queued track" }));
  expect(screen.getByTestId("up-next-count").textContent).toBe("1");

  await user.click(screen.getByRole("button", { name: "Play library all" }));
  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("context=library"))).toBe(
      true,
    );
  });

  expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  expect(screen.getByTestId("up-next-count").textContent).toBe("1");
});

test("clicking an unowned catalog row while another context plays does not clear Up Next", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);

  const queued: FullTrack = {
    ...playableTrack,
    id: "queued-track",
    title: "Queued",
    audioFiles: [{ id: "af-q", format: "mp3", objectKey: "audio/queued.mp3" }],
  };

  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(PLAYER_STATE_ROUTE)) {
      return Promise.resolve({
        status: 204,
        ok: true,
        json: async () => null,
      } as Response);
    }
    if (url.includes("/resources/audio/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ url: "https://cdn.example/stream.mp3" }),
      } as Response);
    }
    if (url.includes("/api/queue-spine")) {
      if (url.includes("context=artist")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            tracks: [{ ...spineTrack, id: "track-owned-only", title: "Owned" }],
            total: 1,
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ tracks: [spineTrack], total: 1 }),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      const tracks = [playableTrack, queued].filter((track) => ids.includes(track.id));
      return Promise.resolve({
        ok: true,
        json: async () => ({ tracks }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  function Probe() {
    const { playTrack, addToUpNext, currentTrack, upNext } = useAudioPlayer();
    return (
      <>
        <button type="button" onClick={() => playTrack(playableTrack, { type: "library" }, 0)}>
          Play library track
        </button>
        <button type="button" onClick={() => addToUpNext(queued)}>
          Add queued track
        </button>
        <button
          type="button"
          onClick={() => playTrack(playableTrack, { type: "artist", artistId: "artist-1" }, 0)}
        >
          Play artist track
        </button>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
        <span data-testid="up-next-count">{upNext.length}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider userId="user-1">
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play library track" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  await user.click(screen.getByRole("button", { name: "Add queued track" }));
  expect(screen.getByTestId("up-next-count").textContent).toBe("1");

  await user.click(screen.getByRole("button", { name: "Play artist track" }));
  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("context=artist"))).toBe(
      true,
    );
  });

  expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  expect(screen.getByTestId("up-next-count").textContent).toBe("1");
});

test("playTrack skips queue spine when navigator is offline before React isOnline updates", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  const offlineTrack: FullTrack = {
    ...playableTrack,
    id: "offline-pin",
    title: "Pinned Offline",
  };

  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/queue-spine")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          tracks: [{ ...spineTrack, id: "other-owned", title: "Other" }],
          total: 1,
        }),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      const tracks = [offlineTrack].filter((track) => ids.includes(track.id));
      return Promise.resolve({
        ok: true,
        json: async () => ({ tracks }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  vi.mocked(getOfflineStorage).mockReturnValue({
    cacheQueueTrack: vi.fn().mockResolvedValue(undefined),
    listDownloaded: vi.fn().mockResolvedValue([]),
    listPinned: vi.fn().mockResolvedValue([downloadedSummary("offline-pin", "Pinned Offline")]),
    listForPlaylist: vi.fn().mockResolvedValue([]),
  } as unknown as ReturnType<typeof getOfflineStorage>);

  // Simulate Playwright setOffline: navigator offline, no offline event yet (stale isOnline).
  vi.stubGlobal("navigator", { ...(navigator as Navigator), onLine: false });

  function OfflinePlayProbe() {
    const { playTrack, currentTrack } = useAudioPlayer();
    return (
      <>
        <button type="button" onClick={() => playTrack(offlineTrack, { type: "library" })}>
          Play pinned offline
        </button>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider>
      <OfflinePlayProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play pinned offline" }));

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("offline-pin");
  });
  expect(fetchMock).not.toHaveBeenCalled();

  vi.unstubAllGlobals();
});

test("playTrack starts downloaded track when offline spine is empty but hasTrack is true", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  const offlineTrack: FullTrack = {
    ...playableTrack,
    id: "offline-has",
    title: "Downloaded Only",
  };

  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/tracks/playback")) {
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      const tracks = [offlineTrack].filter((track) => ids.includes(track.id));
      return Promise.resolve({
        ok: true,
        json: async () => ({ tracks }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  vi.mocked(getOfflineStorage).mockReturnValue({
    cacheQueueTrack: vi.fn().mockResolvedValue(undefined),
    listDownloaded: vi.fn().mockResolvedValue([]),
    listPinned: vi.fn().mockResolvedValue([]),
    listForPlaylist: vi.fn().mockResolvedValue([]),
    hasTrack: vi.fn().mockResolvedValue(true),
  } as unknown as ReturnType<typeof getOfflineStorage>);

  vi.stubGlobal("navigator", { ...(navigator as Navigator), onLine: false });
  await act(async () => {
    window.dispatchEvent(new Event("offline"));
  });

  function Probe() {
    const { playTrack, isPlayerVisible, currentTrack } = useAudioPlayer();
    return (
      <>
        <button type="button" onClick={() => playTrack(offlineTrack, { type: "library" })}>
          Play downloaded
        </button>
        <span data-testid="player-visible">{String(isPlayerVisible)}</span>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider>
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play downloaded" }));

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("offline-has");
  });
  expect(screen.getByTestId("player-visible").textContent).toBe("true");
});

test("playTrack while offline builds spine from pinned downloads instead of queue spine fetch", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  const offlineTrack: FullTrack = {
    ...playableTrack,
    id: "offline-pin",
    title: "Pinned Offline",
  };

  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/queue-spine")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          tracks: [{ ...spineTrack, id: "other-owned", title: "Other" }],
          total: 1,
        }),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      const tracks = [offlineTrack].filter((track) => ids.includes(track.id));
      return Promise.resolve({
        ok: true,
        json: async () => ({ tracks }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  vi.mocked(getOfflineStorage).mockReturnValue({
    cacheQueueTrack: vi.fn().mockResolvedValue(undefined),
    listDownloaded: vi.fn().mockResolvedValue([]),
    listPinned: vi.fn().mockResolvedValue([downloadedSummary("offline-pin", "Pinned Offline")]),
    listForPlaylist: vi.fn().mockResolvedValue([]),
  } as unknown as ReturnType<typeof getOfflineStorage>);

  vi.stubGlobal("navigator", { ...(navigator as Navigator), onLine: false });
  await act(async () => {
    window.dispatchEvent(new Event("offline"));
  });

  function OfflinePlayProbe() {
    const { playTrack, isPlayerVisible, currentTrack } = useAudioPlayer();
    return (
      <>
        <button type="button" onClick={() => playTrack(offlineTrack, { type: "library" })}>
          Play pinned offline
        </button>
        <span data-testid="player-visible">{String(isPlayerVisible)}</span>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider>
      <OfflinePlayProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play pinned offline" }));

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("offline-pin");
  });
  expect(screen.getByTestId("player-visible").textContent).toBe("true");
  expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/queue-spine"))).toBe(
    false,
  );
});

test("failed offline restore is retried on the next mount", async () => {
  consoleError.mockImplementation(() => {});
  window.localStorage.clear();

  writeCachedPlayerState("user-1", {
    playContext: { type: "library" },
    currentTrackId: "track-1",
    upNextIds: [],
    shuffleSeed: null,
    loopMode: "off",
  });

  const listDownloaded = vi
    .fn()
    .mockRejectedValueOnce(new Error("idb read failed"))
    .mockResolvedValueOnce([downloadedSummary("track-1", "Test Song")]);

  vi.mocked(getOfflineStorage).mockReturnValue({
    cacheQueueTrack: vi.fn().mockResolvedValue(undefined),
    listDownloaded,
    listPinned: vi.fn().mockResolvedValue([]),
    listForPlaylist: vi.fn().mockResolvedValue([]),
  } as unknown as ReturnType<typeof getOfflineStorage>);
  vi.stubGlobal("navigator", { onLine: false });

  const { unmount } = render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await waitFor(() => {
    expect(listDownloaded).toHaveBeenCalledTimes(1);
  });
  expect(screen.getByTestId("current-track-id").textContent).toBe("");

  unmount();

  render(
    <AudioPlayerProvider userId="user-1">
      <QueueProbe />
    </AudioPlayerProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });
  expect(listDownloaded).toHaveBeenCalledTimes(2);
});

test("a slow jump completing after a newer jump does not overwrite the newer choice", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  const track2 = { ...playableTrack, id: "track-2", title: "Second Track" };
  const track3 = { ...playableTrack, id: "track-3", title: "Third Track" };

  let releaseSlow: () => void = () => {};
  const slowGate = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });

  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/queue-spine")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          tracks: [spineTrack, { ...spineTrack, id: "track-2" }, { ...spineTrack, id: "track-3" }],
          total: 3,
        }),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      const respond = () => {
        const tracks = [playableTrack, track2, track3].filter((track) => ids.includes(track.id));
        return Promise.resolve({
          ok: true,
          json: async () => ({ tracks }),
        } as Response);
      };
      if (ids.includes("track-2") && !ids.includes("track-3")) {
        return slowGate.then(respond);
      }
      return respond();
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  function DoubleJumpProbe() {
    const { playTrack, playQueueTrack, currentTrack } = useAudioPlayer();
    return (
      <>
        <button type="button" onClick={() => playTrack(playableTrack, { type: "library" }, 0)}>
          Play first
        </button>
        <button type="button" onClick={() => playQueueTrack({ zone: "spine", index: 1 })}>
          Jump to second
        </button>
        <button type="button" onClick={() => playQueueTrack({ zone: "spine", index: 2 })}>
          Jump to third
        </button>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider>
      <DoubleJumpProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play first" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  await user.click(screen.getByRole("button", { name: "Jump to second" }));
  await user.click(screen.getByRole("button", { name: "Jump to third" }));

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-3");
  });

  releaseSlow();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  expect(screen.getByTestId("current-track-id").textContent).toBe("track-3");
});

test("jump onto a play-next row discards the prefix using ref-backed play-next count", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  const playNextA = { ...playableTrack, id: "track-pna", title: "Play Next A" };
  const playNextB = { ...playableTrack, id: "track-pnb", title: "Play Next B" };

  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/queue-spine")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          tracks: [spineTrack, { ...spineTrack, id: "track-2", title: "Second" }],
          total: 2,
        }),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      const all = [playableTrack, playNextA, playNextB];
      return Promise.resolve({
        ok: true,
        json: async () => ({ tracks: all.filter((track) => ids.includes(track.id)) }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  function PlayNextJumpProbe() {
    const { playTrack, playNextTrack, playQueueTrack, upNextPlayNextCount, currentTrack } =
      useAudioPlayer();
    return (
      <>
        <button type="button" onClick={() => playTrack(playableTrack, { type: "library" }, 0)}>
          Play first
        </button>
        <button type="button" onClick={() => playNextTrack(playNextA)}>
          Play next A
        </button>
        <button type="button" onClick={() => playNextTrack(playNextB)}>
          Play next B
        </button>
        <button type="button" onClick={() => playQueueTrack({ zone: "upNext", index: 1 })}>
          Jump to A
        </button>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
        <span data-testid="play-next-count">{upNextPlayNextCount}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider>
      <PlayNextJumpProbe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play first" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  await user.click(screen.getByRole("button", { name: "Play next A" }));
  await user.click(screen.getByRole("button", { name: "Play next B" }));
  expect(screen.getByTestId("play-next-count").textContent).toBe("2");

  await user.click(screen.getByRole("button", { name: "Jump to A" }));

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-pna");
  });
  expect(screen.getByTestId("play-next-count").textContent).toBe("0");
});

test("slow startSpinePlayback after a context switch does not clear Up Next when a newer Next wins", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);

  const queuedA: FullTrack = {
    ...playableTrack,
    id: "queued-a",
    title: "Queued A",
    audioFiles: [{ id: "af-qa", format: "mp3", objectKey: "audio/queued-a.mp3" }],
  };
  const queuedB: FullTrack = {
    ...playableTrack,
    id: "queued-b",
    title: "Queued B",
    audioFiles: [{ id: "af-qb", format: "mp3", objectKey: "audio/queued-b.mp3" }],
  };
  const track2: FullTrack = {
    ...playableTrack,
    id: "track-2",
    title: "Second Track",
    audioFiles: [{ id: "af-2", format: "mp3", objectKey: "audio/test2.mp3" }],
  };

  let releaseArtistSpine!: () => void;
  let artistSpineReleased = false;
  const artistSpineGate = new Promise<void>((resolve) => {
    releaseArtistSpine = () => {
      artistSpineReleased = true;
      resolve();
    };
  });
  let deferArtistSpine = false;

  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(PLAYER_STATE_ROUTE)) {
      return Promise.resolve({
        status: 204,
        ok: true,
        json: async () => null,
      } as Response);
    }
    if (url.includes("/resources/audio/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ url: "https://cdn.example/stream.mp3" }),
      } as Response);
    }
    if (url.includes("/api/queue-spine")) {
      if (deferArtistSpine && url.includes("context=artist") && !artistSpineReleased) {
        return artistSpineGate.then(
          () =>
            ({
              ok: true,
              json: async () => ({
                tracks: [{ ...spineTrack, id: "artist-owned", title: "Artist Owned" }],
                total: 1,
              }),
            }) as Response,
        );
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          tracks: [spineTrack, { ...spineTrack, id: "track-2", title: "Second Track" }],
          total: 2,
        }),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      const tracks = [playableTrack, track2, queuedA, queuedB].filter((track) =>
        ids.includes(track.id),
      );
      return Promise.resolve({
        ok: true,
        json: async () => ({ tracks }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  function Probe() {
    const { playTrack, playNext, addToUpNext, currentTrack, upNext } = useAudioPlayer();
    return (
      <>
        <button type="button" onClick={() => playTrack(playableTrack, { type: "library" }, 0)}>
          Play library track
        </button>
        <button type="button" onClick={() => addToUpNext(queuedA)}>
          Add queued A
        </button>
        <button type="button" onClick={() => addToUpNext(queuedB)}>
          Add queued B
        </button>
        <button
          type="button"
          onClick={() => playTrack(playableTrack, { type: "artist", artistId: "artist-1" }, 0)}
        >
          Play artist track
        </button>
        <button type="button" onClick={playNext}>
          Play next
        </button>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
        <span data-testid="up-next-count">{upNext.length}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider userId="user-1">
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play library track" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  await user.click(screen.getByRole("button", { name: "Add queued A" }));
  await user.click(screen.getByRole("button", { name: "Add queued B" }));
  expect(screen.getByTestId("up-next-count").textContent).toBe("2");

  deferArtistSpine = true;
  void user.click(screen.getByRole("button", { name: "Play artist track" }));
  await user.click(screen.getByRole("button", { name: "Play next" }));

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("queued-a");
  });
  expect(screen.getByTestId("up-next-count").textContent).toBe("1");

  releaseArtistSpine();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  expect(screen.getByTestId("current-track-id").textContent).toBe("queued-a");
  expect(screen.getByTestId("up-next-count").textContent).toBe("1");
});

test("playContextSpine does not reopen the player after closePlayer while the spine fetch is in flight", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);

  let releaseLibrarySpine!: () => void;
  let librarySpineReleased = false;
  const librarySpineGate = new Promise<void>((resolve) => {
    releaseLibrarySpine = () => {
      librarySpineReleased = true;
      resolve();
    };
  });
  let deferLibrarySpine = false;

  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(PLAYER_STATE_ROUTE)) {
      return Promise.resolve({
        status: 204,
        ok: true,
        json: async () => null,
      } as Response);
    }
    if (url.includes("/resources/audio/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ url: "https://cdn.example/stream.mp3" }),
      } as Response);
    }
    if (url.includes("/api/queue-spine")) {
      if (deferLibrarySpine && url.includes("context=library") && !librarySpineReleased) {
        return librarySpineGate.then(
          () =>
            ({
              ok: true,
              json: async () => ({ tracks: [spineTrack], total: 1 }),
            }) as Response,
        );
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ tracks: [spineTrack], total: 1 }),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      const tracks = [playableTrack].filter((track) => ids.includes(track.id));
      return Promise.resolve({
        ok: true,
        json: async () => ({ tracks }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  function Probe() {
    const { playLibrary, closePlayer, isPlayerVisible, currentTrack } = useAudioPlayer();
    return (
      <>
        <button type="button" onClick={() => void playLibrary()}>
          Play library
        </button>
        <button type="button" onClick={closePlayer}>
          Close player
        </button>
        <span data-testid="player-visible">{String(isPlayerVisible)}</span>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider userId="user-1">
      <Probe />
    </AudioPlayerProvider>,
  );

  deferLibrarySpine = true;
  void user.click(screen.getByRole("button", { name: "Play library" }));
  await user.click(screen.getByRole("button", { name: "Close player" }));

  expect(screen.getByTestId("player-visible").textContent).toBe("false");
  expect(screen.getByTestId("current-track-id").textContent).toBe("");

  releaseLibrarySpine();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  expect(screen.getByTestId("player-visible").textContent).toBe("false");
  expect(screen.getByTestId("current-track-id").textContent).toBe("");
});

test("addToQueue during a slow jump is not overwritten when the jump completes", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  const track2 = { ...playableTrack, id: "track-2", title: "Second Track" };
  const queuedExtra: FullTrack = {
    ...playableTrack,
    id: "track-queued",
    title: "Queued On Spine",
    audioFiles: [{ id: "af-q", format: "mp3", objectKey: "audio/queued.mp3" }],
  };

  let releaseSlow: () => void = () => {};
  const slowGate = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });

  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/queue-spine")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          tracks: [spineTrack, { ...spineTrack, id: "track-2" }],
          total: 2,
        }),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      if (ids.includes("track-2") && !ids.includes("track-1")) {
        return slowGate.then(() =>
          Promise.resolve({
            ok: true,
            json: async () => ({ tracks: [track2] }),
          } as Response),
        );
      }
      const all = [playableTrack, track2, queuedExtra];
      return Promise.resolve({
        ok: true,
        json: async () => ({
          tracks: all.filter((track) => ids.includes(track.id) && track.id !== "track-2"),
        }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  function Probe() {
    const { playTrack, playQueueTrack, addToQueue, spineTotal, playlist, currentTrack } =
      useAudioPlayer();
    return (
      <>
        <button type="button" onClick={() => playTrack(playableTrack, { type: "library" }, 0)}>
          Play first
        </button>
        <button type="button" onClick={() => playQueueTrack({ zone: "spine", index: 1 })}>
          Jump to second
        </button>
        <button type="button" onClick={() => addToQueue(queuedExtra)}>
          Add to queue
        </button>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
        <span data-testid="spine-total">{spineTotal}</span>
        <span data-testid="spine-has-queued">
          {String(playlist.some((track) => track.id === "track-queued"))}
        </span>
      </>
    );
  }

  render(
    <AudioPlayerProvider>
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play first" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  void user.click(screen.getByRole("button", { name: "Jump to second" }));
  await user.click(screen.getByRole("button", { name: "Add to queue" }));
  await waitFor(() => {
    expect(screen.getByTestId("spine-total").textContent).toBe("3");
  });

  releaseSlow();
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-2");
  });
  expect(screen.getByTestId("spine-total").textContent).toBe("3");
  expect(screen.getByTestId("spine-has-queued").textContent).toBe("true");
});

test("close during an in-flight jumpToQueueTrack keeps the player closed", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  const track2 = { ...playableTrack, id: "track-2", title: "Second Track" };

  let releaseSlow: () => void = () => {};
  const slowGate = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });

  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(PLAYER_STATE_ROUTE)) {
      return Promise.resolve({ status: 204, ok: true, json: async () => null } as Response);
    }
    if (url.includes("/api/queue-spine")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          tracks: [spineTrack, { ...spineTrack, id: "track-2" }],
          total: 2,
        }),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      if (ids.includes("track-2") && ids.length === 1) {
        return slowGate.then(() =>
          Promise.resolve({
            ok: true,
            json: async () => ({ tracks: [track2] }),
          } as Response),
        );
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          tracks: [playableTrack, track2].filter((track) => ids.includes(track.id)),
        }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  function Probe() {
    const { playTrack, playQueueTrack, closePlayer, isPlayerVisible, currentTrack } =
      useAudioPlayer();
    return (
      <>
        <button type="button" onClick={() => playTrack(playableTrack, { type: "library" }, 0)}>
          Play first
        </button>
        <button type="button" onClick={() => playQueueTrack({ zone: "spine", index: 1 })}>
          Jump to second
        </button>
        <button type="button" onClick={closePlayer}>
          Close player
        </button>
        <span data-testid="player-visible">{String(isPlayerVisible)}</span>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider userId="user-1">
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play first" }));
  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-1");
  });

  void user.click(screen.getByRole("button", { name: "Jump to second" }));
  await user.click(screen.getByRole("button", { name: "Close player" }));

  expect(screen.getByTestId("player-visible").textContent).toBe("false");
  expect(screen.getByTestId("current-track-id").textContent).toBe("");

  releaseSlow();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  expect(screen.getByTestId("player-visible").textContent).toBe("false");
  expect(screen.getByTestId("current-track-id").textContent).toBe("");
});

test("close during in-flight startSpinePlayback keeps the player closed", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);

  let releaseLibrarySpine!: () => void;
  let librarySpineReleased = false;
  const librarySpineGate = new Promise<void>((resolve) => {
    releaseLibrarySpine = () => {
      librarySpineReleased = true;
      resolve();
    };
  });
  let deferLibrarySpine = false;

  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(PLAYER_STATE_ROUTE)) {
      return Promise.resolve({ status: 204, ok: true, json: async () => null } as Response);
    }
    if (url.includes("/api/queue-spine")) {
      if (deferLibrarySpine && url.includes("context=library") && !librarySpineReleased) {
        return librarySpineGate.then(() =>
          Promise.resolve({
            ok: true,
            json: async () => ({ tracks: [spineTrack], total: 1 }),
          } as Response),
        );
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ tracks: [spineTrack], total: 1 }),
      } as Response);
    }
    if (url.includes("/api/tracks/playback")) {
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      return Promise.resolve({
        ok: true,
        json: async () => ({
          tracks: [playableTrack].filter((track) => ids.includes(track.id)),
        }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  function Probe() {
    const { playTrack, closePlayer, isPlayerVisible, currentTrack } = useAudioPlayer();
    return (
      <>
        <button type="button" onClick={() => void playTrack(playableTrack, { type: "library" }, 0)}>
          Play library track
        </button>
        <button type="button" onClick={closePlayer}>
          Close player
        </button>
        <span data-testid="player-visible">{String(isPlayerVisible)}</span>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider userId="user-1">
      <Probe />
    </AudioPlayerProvider>,
  );

  deferLibrarySpine = true;
  void user.click(screen.getByRole("button", { name: "Play library track" }));
  await user.click(screen.getByRole("button", { name: "Close player" }));

  expect(screen.getByTestId("player-visible").textContent).toBe("false");

  releaseLibrarySpine();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  expect(screen.getByTestId("player-visible").textContent).toBe("false");
  expect(screen.getByTestId("current-track-id").textContent).toBe("");
});

test("a rejected catalog click during startup does not skip restore", async () => {
  const user = userEvent.setup();
  let resolveRestore: ((value: Response) => void) | undefined;
  const restorePromise = new Promise<Response>((resolve) => {
    resolveRestore = resolve;
  });

  const fetchMock = vi.mocked(fetch);
  const restoredTrack = { ...playableTrack, id: "track-restored", title: "Restored Track" };

  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url === PLAYER_STATE_ROUTE) {
      return restorePromise;
    }
    if (url.includes("/api/tracks/playback")) {
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      const tracks = [restoredTrack, playableTrack].filter((track) => ids.includes(track.id));
      return Promise.resolve({
        status: 200,
        ok: true,
        json: async () => ({ tracks }),
      } as Response);
    }
    if (url.includes("/api/queue-spine")) {
      if (url.includes("context=artist")) {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: async () => ({
            tracks: [{ ...spineTrack, id: "artist-only", title: "Artist Only" }],
            total: 1,
          }),
        } as Response);
      }
      return Promise.resolve({
        status: 200,
        ok: true,
        json: async () => ({ tracks: [restoredTrack], total: 1 }),
      } as Response);
    }
    return Promise.resolve({ status: 200, ok: true, json: async () => ({}) } as Response);
  });

  function Probe() {
    const { playTrack, currentTrack } = useAudioPlayer();
    return (
      <>
        <button
          type="button"
          onClick={() => playTrack(playableTrack, { type: "artist", artistId: "artist-1" }, 0)}
        >
          Play artist track
        </button>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider userId="user-1">
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play artist track" }));

  resolveRestore?.({
    status: 200,
    ok: true,
    json: async () => ({
      playContext: { type: "library" },
      currentTrackId: "track-restored",
      upNextIds: [],
      shuffleSeed: null,
      loopMode: "off",
    }),
  } as Response);

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("track-restored");
  });
});

test("an owned-but-not-downloaded library track opens the player after online spine fetch failure", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.mocked(fetch);
  consoleError.mockImplementation(() => {});
  const libraryTrack: FullTrack = {
    ...playableTrack,
    id: "library-owned",
    title: "Library Owned",
    audioFiles: [{ id: "af-lo", format: "mp3", objectKey: "audio/library-owned.mp3" }],
  };

  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/queue-spine")) {
      return Promise.reject(new Error("network down"));
    }
    if (url.includes("/api/tracks/playback")) {
      const ids = new URL(url, "http://test").searchParams.get("ids")?.split(",") ?? [];
      return Promise.resolve({
        ok: true,
        json: async () => ({
          tracks: ids.includes("library-owned") ? [libraryTrack] : [],
        }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  vi.mocked(getOfflineStorage).mockReturnValue({
    cacheQueueTrack: vi.fn().mockResolvedValue(undefined),
    listDownloaded: vi.fn().mockResolvedValue([]),
    listPinned: vi.fn().mockResolvedValue([]),
    listForPlaylist: vi.fn().mockResolvedValue([]),
    hasTrack: vi.fn().mockResolvedValue(false),
  } as unknown as ReturnType<typeof getOfflineStorage>);

  function Probe() {
    const { playTrack, isPlayerVisible, currentTrack } = useAudioPlayer();
    return (
      <>
        <button type="button" onClick={() => playTrack(libraryTrack, { type: "library" })}>
          Play library owned
        </button>
        <span data-testid="player-visible">{String(isPlayerVisible)}</span>
        <span data-testid="current-track-id">{currentTrack?.id ?? ""}</span>
      </>
    );
  }

  render(
    <AudioPlayerProvider>
      <Probe />
    </AudioPlayerProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Play library owned" }));

  await waitFor(() => {
    expect(screen.getByTestId("current-track-id").textContent).toBe("library-owned");
  });
  expect(screen.getByTestId("player-visible").textContent).toBe("true");
});
