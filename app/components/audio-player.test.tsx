/**
 * @vitest-environment jsdom
 *
 * AudioPlayer chrome tests (transport, volume, loading states).
 * Queue sheet behavior with real provider state is in audio-player-queue.integration.test.tsx.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useAudioPlayer } from "#app/components/audio-player-provider";
import { type FullTrack } from "#app/types/frontend/shared";
import { toast } from "#app/components/ui/use-toast";
import { reportPlayEvent } from "#app/features/usage-analytics/report-play-event.client.ts";
import type { UseSwipeGestureOptions } from "#app/hooks/use-swipe-gesture";
import { AudioPlayer } from "./audio-player";

type AudioPlayerTestProps = ComponentProps<typeof AudioPlayer>;

const mockRemoveTrackFromPlaylist = vi.fn();

// Expose captured swipe callbacks so tests can simulate swipe gestures.
const swipeMocks: { onSwipeLeft: (() => void) | null; onSwipeRight: (() => void) | null } = {
  onSwipeLeft: null,
  onSwipeRight: null,
};

function createAudioPlayerMock(overrides: Record<string, unknown> = {}) {
  return {
    playlist: [],
    upNext: [],
    spine: [],
    spineTotal: 0,
    spinePosition: 0,
    currentTrack: null,
    currentIndex: -1,
    playContext: null,
    removeTrackFromPlaylist: mockRemoveTrackFromPlaylist,
    removeCurrentFromQueue: vi.fn(),
    startQueuePlayback: vi.fn(),
    hasQueuedPlayback: false,
    playNextTrack: vi.fn(),
    addToUpNext: vi.fn(),
    addToQueue: vi.fn(),
    ...overrides,
  };
}

vi.mock("#app/components/ui/use-toast.ts", async () => ({
  toast: vi.fn(),
}));

vi.mock("#app/components/track-details-dialog", () => ({
  TrackDetailsDialog: vi.fn(() => null),
}));

vi.mock("#app/features/offline-storage/resolve-playback-url.client.ts", () => ({
  resolveTrackPlaybackSource: vi.fn().mockResolvedValue("https://cdn.example/track-1.mp3"),
  resolvePlaybackAudioUrl: vi.fn().mockResolvedValue(null),
  revokePlaybackAudioUrl: vi.fn(),
  clearBlobUrlCache: vi.fn(),
  invalidateRemotePlaybackUrl: vi.fn(),
  peekCachedPlaybackUrl: vi.fn().mockReturnValue(null),
}));

vi.mock("#app/features/offline-storage/cover-cache.client.ts", () => ({
  resolveCachedCoverUrl: vi.fn().mockResolvedValue(null),
}));

vi.mock("#app/components/audio-player-provider", () => ({
  useAudioPlayer: vi.fn(() => createAudioPlayerMock()),
  AudioPlayerProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("#app/hooks/use-swipe-gesture", () => ({
  useSwipeGesture: vi.fn((_ref: unknown, options: UseSwipeGestureOptions) => {
    swipeMocks.onSwipeLeft = options.onSwipeLeft ?? null;
    swipeMocks.onSwipeRight = options.onSwipeRight ?? null;
    return { offsetX: 0, isSwiping: false };
  }),
}));

// Without this the player POSTs to /resources/play-event, which MSW reports as an
// unhandled request — and the test setup turns that warning into a thrown error.
vi.mock("#app/features/usage-analytics/report-play-event.client.ts", () => ({
  reportPlayEvent: vi.fn(),
}));

vi.mock("#app/components/add-to-playlist-menu", () => ({
  AddToPlaylistMenu: ({
    constrainHeight,
    trackTitle,
  }: {
    constrainHeight?: boolean;
    trackTitle: string;
  }) => (
    <div
      data-testid="add-to-playlist-menu"
      data-constrain-height={String(Boolean(constrainHeight))}
    >
      <button type="button">New playlist</button>
      <span>{trackTitle}</span>
    </div>
  ),
}));

const mockTrack: FullTrack = {
  id: "track-1",
  title: "Test Song",
  artist: { id: "artist-1", name: "Test Artist" },
  duration: 180,
  coverImage: { objectKey: "covers/test.jpg" },
  audioFiles: [{ id: "af-1", format: "mp3", objectKey: "audio/test.mp3" }],
};

const defaultProps: AudioPlayerTestProps = {
  track: mockTrack,
  isVisible: true,
  onClose: vi.fn(),
  onNext: vi.fn(),
  onPrevious: vi.fn(),
  onToggleLoop: vi.fn(),
  onToggleShuffle: vi.fn(),
  hasNext: false,
  hasPrevious: false,
  loopMode: "off",
  isShuffleEnabled: false,
  playbackToken: 0,
  wantsAutoPlayRef: { current: false },
};

function playerUi(props: Partial<AudioPlayerTestProps> = {}) {
  return (
    <MemoryRouter>
      <AudioPlayer {...defaultProps} {...props} />
    </MemoryRouter>
  );
}

async function renderPlayer(props: Partial<AudioPlayerTestProps> = {}) {
  const view = render(playerUi(props));
  const audioEl = await waitFor(() => {
    const element = view.container.querySelector("audio");
    if (!element) throw new Error("Audio element not mounted yet");
    return element;
  });
  return { ...view, audioEl };
}

test("sleep timer menu stacks above toasts and cancel clears the countdown", async () => {
  const user = userEvent.setup();
  await renderPlayer();

  const playerBar = screen.getByTestId("player-desktop-bar");
  await user.click(within(playerBar).getByRole("button", { name: "Sleep timer" }));

  const preset = await screen.findByRole("button", { name: "15 min" });
  const popover = preset.closest("[data-side]");
  expect(popover).toHaveClass("z-[110]");
  expect(popover).not.toHaveClass("z-54");

  await user.click(preset);
  expect(within(playerBar).getByRole("button", { name: "Sleep timer" })).toHaveTextContent(
    /\d+:\d+/,
  );

  await user.click(screen.getByRole("button", { name: "Cancel timer" }));
  expect(within(playerBar).getByRole("button", { name: "Sleep timer" })).not.toHaveTextContent(
    /\d+:\d+/,
  );
});

test("publishes player clearance so toasts can sit above the bar", async () => {
  const rectSpy = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === "player-chrome") {
        return {
          x: 0,
          y: 700,
          top: 700,
          bottom: 800,
          left: 0,
          right: 400,
          width: 400,
          height: 100,
          toJSON() {
            return {};
          },
        } as DOMRect;
      }
      return {
        x: 0,
        y: 0,
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        toJSON() {
          return {};
        },
      } as DOMRect;
    });
  const heightSpy = vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);

  const view = await renderPlayer();

  await waitFor(() => {
    expect(document.body.style.getPropertyValue("--toast-bottom-offset")).toBe("100px");
  });

  view.unmount();
  expect(document.body.style.getPropertyValue("--toast-bottom-offset")).toBe("");

  rectSpy.mockRestore();
  heightSpy.mockRestore();
});

test("reserves page space for the playback error so the list can scroll past the player", async () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const heightSpy = vi
    .spyOn(HTMLElement.prototype, "offsetHeight", "get")
    .mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === "player-playback-error" ? 48 : 0;
    });

  const { audioEl } = await renderPlayer();
  Object.defineProperty(audioEl, "error", {
    configurable: true,
    value: { code: 1, message: "aborted" },
  });
  audioEl.dispatchEvent(new Event("error"));

  await waitFor(() => {
    expect(document.body.style.getPropertyValue("--player-error-height")).toBe("48px");
  });

  heightSpy.mockRestore();
  consoleSpy.mockRestore();
});

test("shows playback error with user-friendly message for MEDIA_ERR_ABORTED (code 1)", async () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  const { audioEl } = await renderPlayer();

  Object.defineProperty(audioEl, "error", {
    configurable: true,
    value: { code: 1, message: "The fetching was aborted by the user" },
  });

  audioEl.dispatchEvent(new Event("error"));

  // console.error still logged for debugging
  expect(consoleSpy).toHaveBeenCalledWith(
    "Audio load error: The fetching was aborted by the user (code: 1)",
  );

  await waitFor(() => {
    expect(screen.getByTestId("player-playback-error")).toBeInTheDocument();
    expect(screen.getByTestId("player-playback-error")).toHaveTextContent(
      "Playback was interrupted.",
    );
  });

  consoleSpy.mockRestore();
});

test("shows playback error with user-friendly message for MEDIA_ERR_NETWORK (code 2)", async () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  const { audioEl } = await renderPlayer();

  Object.defineProperty(audioEl, "error", {
    configurable: true,
    value: { code: 2, message: "A network error caused the audio download to fail" },
  });

  audioEl.dispatchEvent(new Event("error"));

  await waitFor(() => {
    expect(screen.getByTestId("player-playback-error")).toHaveTextContent(
      "A network error prevented the audio from loading. Check your connection.",
    );
  });

  consoleSpy.mockRestore();
});

test("recovers from MEDIA_ERR_NETWORK with cached blob and resumes even when element is paused", async () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const { resolvePlaybackAudioUrl } =
    await import("#app/features/offline-storage/resolve-playback-url.client.ts");
  vi.mocked(resolvePlaybackAudioUrl).mockResolvedValue("blob:cached-track-1");

  const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
    return Promise.resolve();
  });

  const { audioEl } = await renderPlayer();

  // User was playing; network failure pauses the element before error recovery runs.
  audioEl.dispatchEvent(new Event("play"));
  Object.defineProperty(audioEl, "paused", { configurable: true, value: true });
  Object.defineProperty(audioEl, "currentTime", {
    configurable: true,
    value: 42,
    writable: true,
  });
  Object.defineProperty(audioEl, "error", {
    configurable: true,
    value: { code: 2, message: "A network error caused the audio download to fail" },
  });

  playSpy.mockClear();
  audioEl.dispatchEvent(new Event("error"));

  await waitFor(() => {
    expect(playSpy).toHaveBeenCalled();
  });
  expect(screen.queryByTestId("player-playback-error")).not.toBeInTheDocument();

  consoleSpy.mockRestore();
});

test("swaps to cached blob and resumes when going offline while playing", async () => {
  const { resolvePlaybackAudioUrl } =
    await import("#app/features/offline-storage/resolve-playback-url.client.ts");

  let resolveOfflineUrl: ((url: string | null) => void) | undefined;
  vi.mocked(resolvePlaybackAudioUrl).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveOfflineUrl = resolve;
      }),
  );

  const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
    return Promise.resolve();
  });

  // Ensure a true online → offline transition.
  window.dispatchEvent(new Event("online"));

  const { audioEl } = await renderPlayer();

  await waitFor(() => {
    expect(audioEl).toHaveAttribute("src", "https://cdn.example/track-1.mp3");
  });

  let currentTime = 42;
  Object.defineProperty(audioEl, "currentTime", {
    configurable: true,
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value;
    },
  });

  audioEl.dispatchEvent(new Event("play"));
  Object.defineProperty(audioEl, "paused", { configurable: true, value: false });

  playSpy.mockClear();
  window.dispatchEvent(new Event("offline"));

  // Wait for the offline effect to start resolving the cached blob.
  await waitFor(() => {
    expect(resolveOfflineUrl).toBeTypeOf("function");
  });

  // Network drain pauses the element while the blob resolve is in flight.
  Object.defineProperty(audioEl, "paused", { configurable: true, value: true });
  resolveOfflineUrl?.("blob:cached-track-1");

  await waitFor(() => {
    expect(playSpy).toHaveBeenCalled();
  });
  expect(audioEl).toHaveAttribute("src", "blob:cached-track-1");
  expect(currentTime).toBe(42);
});

test("does not re-swap source when already playing from a blob URL", async () => {
  const { resolveTrackPlaybackSource, resolvePlaybackAudioUrl } =
    await import("#app/features/offline-storage/resolve-playback-url.client.ts");
  vi.mocked(resolveTrackPlaybackSource).mockResolvedValue("blob:already-cached");

  // Ensure we observe a true online → offline transition (prior tests may leave offline).
  window.dispatchEvent(new Event("online"));

  const { audioEl } = await renderPlayer();

  await waitFor(() => {
    expect(audioEl).toHaveAttribute("src", "blob:already-cached");
  });

  audioEl.dispatchEvent(new Event("play"));
  Object.defineProperty(audioEl, "paused", { configurable: true, value: false });

  const resolveOffline = vi.mocked(resolvePlaybackAudioUrl);
  resolveOffline.mockClear();
  const srcBefore = audioEl.getAttribute("src");

  window.dispatchEvent(new Event("offline"));

  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(resolveOffline).not.toHaveBeenCalled();
  expect(audioEl).toHaveAttribute("src", srcBefore);
});

test("shows playback error with user-friendly message for MEDIA_ERR_DECODE (code 3)", async () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  const { audioEl } = await renderPlayer();

  Object.defineProperty(audioEl, "error", {
    configurable: true,
    value: { code: 3, message: "The media is corrupted" },
  });

  audioEl.dispatchEvent(new Event("error"));

  await waitFor(() => {
    expect(screen.getByTestId("player-playback-error")).toHaveTextContent(
      "This audio format is not supported by your browser.",
    );
  });

  consoleSpy.mockRestore();
});

test("shows playback error with user-friendly message for MEDIA_ERR_SRC_NOT_SUPPORTED (code 4)", async () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const { resolveTrackPlaybackSource, resolvePlaybackAudioUrl } =
    await import("#app/features/offline-storage/resolve-playback-url.client.ts");
  // Same URL after invalidate → recovery skips; no offline blob → show error.
  vi.mocked(resolveTrackPlaybackSource).mockResolvedValue("https://cdn.example/track-1.mp3");
  vi.mocked(resolvePlaybackAudioUrl).mockResolvedValue(null);

  const { audioEl } = await renderPlayer();

  Object.defineProperty(audioEl, "error", {
    configurable: true,
    value: { code: 4, message: "The media resource is not supported" },
  });

  audioEl.dispatchEvent(new Event("error"));

  await waitFor(() => {
    expect(screen.getByTestId("player-playback-error")).toHaveTextContent(
      "The audio source could not be found or is not supported.",
    );
  });

  consoleSpy.mockRestore();
});

test("recovers from MEDIA_ERR_SRC_NOT_SUPPORTED by re-resolving a fresh remote URL", async () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const { resolveTrackPlaybackSource, invalidateRemotePlaybackUrl } =
    await import("#app/features/offline-storage/resolve-playback-url.client.ts");

  vi.mocked(resolveTrackPlaybackSource)
    .mockResolvedValueOnce("https://cdn.example/track-1.mp3")
    .mockResolvedValueOnce("https://cdn.example/track-1-fresh.mp3");

  const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
    return Promise.resolve();
  });

  const { audioEl } = await renderPlayer();

  await waitFor(() => {
    expect(audioEl).toHaveAttribute("src", "https://cdn.example/track-1.mp3");
  });

  audioEl.dispatchEvent(new Event("play"));
  Object.defineProperty(audioEl, "paused", { configurable: true, value: true });
  Object.defineProperty(audioEl, "currentTime", {
    configurable: true,
    value: 12,
    writable: true,
  });
  Object.defineProperty(audioEl, "error", {
    configurable: true,
    value: { code: 4, message: "The media resource is not supported" },
  });

  playSpy.mockClear();
  audioEl.dispatchEvent(new Event("error"));

  await waitFor(() => {
    expect(invalidateRemotePlaybackUrl).toHaveBeenCalledWith("track-1");
    expect(audioEl).toHaveAttribute("src", "https://cdn.example/track-1-fresh.mp3");
    expect(playSpy).toHaveBeenCalled();
  });
  expect(screen.queryByTestId("player-playback-error")).not.toBeInTheDocument();

  consoleSpy.mockRestore();
});

test("shows generic fallback message for unknown MediaError code", async () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  const { audioEl } = await renderPlayer();

  Object.defineProperty(audioEl, "error", {
    configurable: true,
    value: { code: 99, message: "Unknown error" },
  });

  audioEl.dispatchEvent(new Event("error"));

  await waitFor(() => {
    expect(screen.getByTestId("player-playback-error")).toHaveTextContent(
      "An unexpected playback error occurred. Please try again.",
    );
  });

  consoleSpy.mockRestore();
});

test("does not show playback error when audio error is null (no MediaError)", async () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  const { audioEl } = await renderPlayer();

  // No error property set — error event without MediaError should not show anything
  audioEl.dispatchEvent(new Event("error"));

  expect(consoleSpy).not.toHaveBeenCalled();

  await waitFor(() => {
    expect(screen.queryByTestId("player-playback-error")).not.toBeInTheDocument();
  });

  consoleSpy.mockRestore();
});

test("calls onNext when audio ends and loopMode is off", async () => {
  const onNext = vi.fn();

  const { audioEl } = await renderPlayer({ onNext, loopMode: "off", hasNext: true });

  audioEl.dispatchEvent(new Event("ended"));

  expect(onNext).toHaveBeenCalledOnce();
});

test("keeps isPlaying through pause-before-ended during auto-advance", async () => {
  const onNext = vi.fn();
  const { audioEl } = await renderPlayer({ onNext, loopMode: "off", hasNext: true });

  // Playing state arms keepPlayingRef (same as a real play() success).
  audioEl.dispatchEvent(new Event("play"));
  await waitFor(() => {
    expect(within(screen.getByTestId("player-desktop-bar")).getByLabelText("Pause")).toBeTruthy();
  });

  // HTML fires pause immediately before ended at natural completion.
  audioEl.dispatchEvent(new Event("pause"));
  audioEl.dispatchEvent(new Event("ended"));

  expect(onNext).toHaveBeenCalledOnce();
  // Flush React updates from the pause handler, then confirm continuity.
  await waitFor(() => {
    expect(onNext).toHaveBeenCalledOnce();
  });
  expect(within(screen.getByTestId("player-desktop-bar")).queryByLabelText("Play")).toBeNull();
  expect(within(screen.getByTestId("player-desktop-bar")).getByLabelText("Pause")).toBeTruthy();
});

test("user pause still clears isPlaying when keepPlaying was armed", async () => {
  const user = userEvent.setup();
  const { audioEl } = await renderPlayer({ loopMode: "off", hasNext: true });

  audioEl.dispatchEvent(new Event("play"));
  Object.defineProperty(audioEl, "paused", { configurable: true, value: false });
  await waitFor(() => {
    expect(within(screen.getByTestId("player-desktop-bar")).getByLabelText("Pause")).toBeTruthy();
  });

  // togglePlayPause clears keepPlayingRef before calling pause().
  await user.click(within(screen.getByTestId("player-desktop-bar")).getByLabelText("Pause"));
  // jsdom's pause() does not reliably emit the pause event.
  audioEl.dispatchEvent(new Event("pause"));

  await waitFor(() => {
    expect(within(screen.getByTestId("player-desktop-bar")).getByLabelText("Play")).toBeTruthy();
  });
});

test("does NOT call onNext when audio ends and loopMode is one", async () => {
  const onNext = vi.fn();

  const { audioEl } = await renderPlayer({ onNext, loopMode: "one", hasNext: true });

  audioEl.dispatchEvent(new Event("ended"));

  expect(onNext).not.toHaveBeenCalled();
});

test("does NOT call onNext when audio ends with no next track", async () => {
  const onNext = vi.fn();

  const { audioEl } = await renderPlayer({ onNext, loopMode: "off", hasNext: false });

  audioEl.dispatchEvent(new Event("ended"));

  expect(onNext).not.toHaveBeenCalled();
});

test("persists volume changes to localStorage", async () => {
  await renderPlayer();

  const volumeSlider = document.querySelector('[aria-label="Volume"]');
  expect(volumeSlider).not.toBeNull();
  if (!(volumeSlider instanceof HTMLInputElement)) {
    throw new TypeError("Expected volume control to be an HTMLInputElement");
  }

  fireEvent.change(volumeSlider, { target: { value: "0.4" } });

  await waitFor(() => {
    expect(window.localStorage.getItem("music-library:player-volume")).toBe("0.4");
  });
});

test("calls onNext when next button is clicked", async () => {
  const onNext = vi.fn();

  await renderPlayer({ onNext, hasNext: true });

  const nextButton = document.querySelector('[aria-label="Next track"]');
  expect(nextButton).not.toBeNull();

  nextButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  expect(onNext).toHaveBeenCalledOnce();
});

test("calls onPrevious when previous button is clicked", async () => {
  const onPrevious = vi.fn();

  await renderPlayer({ onPrevious, hasPrevious: true });

  const prevButton = document.querySelector('[aria-label="Previous track"]');
  expect(prevButton).not.toBeNull();

  prevButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  expect(onPrevious).toHaveBeenCalledOnce();
});

const mockTrack2: FullTrack = {
  ...mockTrack,
  id: "track-2",
  title: "Second Song",
  audioFiles: [{ id: "af-2", format: "mp3", objectKey: "audio/test2.mp3" }],
};

afterEach(() => {
  vi.restoreAllMocks();
  mockRemoveTrackFromPlaylist.mockReset();
  window.localStorage.clear();
});

beforeEach(async () => {
  vi.mocked(useAudioPlayer).mockReturnValue(
    createAudioPlayerMock() as unknown as ReturnType<typeof useAudioPlayer>,
  );
  vi.mocked(toast).mockClear();
  const { resolveTrackPlaybackSource, resolvePlaybackAudioUrl } =
    await import("#app/features/offline-storage/resolve-playback-url.client.ts");
  vi.mocked(resolveTrackPlaybackSource).mockResolvedValue("https://cdn.example/track-1.mp3");
  vi.mocked(resolvePlaybackAudioUrl).mockResolvedValue(null);
});

test("auto-plays after track change once the new audio URL has loaded", async () => {
  const wantsAutoPlayRef = { current: true };
  const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
    return Promise.resolve();
  });

  const { rerender } = render(playerUi({ playbackToken: 1, wantsAutoPlayRef }));

  await waitFor(() => {
    expect(playSpy).toHaveBeenCalled();
  });

  playSpy.mockClear();

  rerender(playerUi({ track: mockTrack2, playbackToken: 2, wantsAutoPlayRef }));

  await waitFor(() => {
    expect(playSpy).toHaveBeenCalled();
    expect(wantsAutoPlayRef.current).toBe(false);
  });
});

test("applies a prefetched URL synchronously on track change without blanking src", async () => {
  const { peekCachedPlaybackUrl, resolveTrackPlaybackSource } =
    await import("#app/features/offline-storage/resolve-playback-url.client.ts");

  vi.mocked(peekCachedPlaybackUrl).mockImplementation((id: string) =>
    id === "track-2" ? "https://cdn.example/track-2-prefetched.mp3" : null,
  );
  vi.mocked(resolveTrackPlaybackSource).mockImplementation(async (id: string) =>
    id === "track-2"
      ? "https://cdn.example/track-2-prefetched.mp3"
      : "https://cdn.example/track-1.mp3",
  );

  const { audioEl, rerender } = await renderPlayer({
    playbackToken: 1,
    wantsAutoPlayRef: { current: true },
  });

  await waitFor(() => {
    expect(audioEl).toHaveAttribute("src", "https://cdn.example/track-1.mp3");
  });

  vi.mocked(resolveTrackPlaybackSource).mockClear();

  rerender(
    playerUi({
      track: mockTrack2,
      playbackToken: 2,
      wantsAutoPlayRef: { current: true },
    }),
  );

  // Prefetched handoff must not wait on async resolve (no blank → gap → play).
  expect(audioEl).toHaveAttribute("src", "https://cdn.example/track-2-prefetched.mp3");
  expect(resolveTrackPlaybackSource).not.toHaveBeenCalled();
});

test("unlock tolerates jsdom play() returning undefined", async () => {
  const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(() => {
    return undefined as unknown as Promise<void>;
  });

  await renderPlayer();
  playSpy.mockClear();

  expect(() => window.dispatchEvent(new Event("pointerdown"))).not.toThrow();
  expect(playSpy).toHaveBeenCalledOnce();
});

test("unlocks the audio element on the first pointer gesture", async () => {
  const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    return Promise.resolve();
  });

  await renderPlayer();
  playSpy.mockClear();

  window.dispatchEvent(new Event("pointerdown"));

  expect(playSpy).toHaveBeenCalledOnce();
});

test("unlocks the audio element on the first keydown", async () => {
  const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    return Promise.resolve();
  });

  await renderPlayer();
  playSpy.mockClear();

  window.dispatchEvent(new Event("keydown"));

  expect(playSpy).toHaveBeenCalledOnce();
});

test("unlock is one-shot — later gestures of either type do not reload", async () => {
  const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    return Promise.resolve();
  });

  await renderPlayer();
  playSpy.mockClear();

  window.dispatchEvent(new Event("pointerdown"));
  window.dispatchEvent(new Event("pointerdown"));
  window.dispatchEvent(new Event("keydown"));

  expect(playSpy).toHaveBeenCalledOnce();
});

test("keeps the audio element mounted when hidden or trackless", async () => {
  const hidden = render(playerUi({ isVisible: false }));
  expect(hidden.container.querySelector("audio")).not.toBeNull();

  const trackless = render(playerUi({ track: null }));
  expect(trackless.container.querySelector("audio")).not.toBeNull();
});

test("keeps player chrome visible while the next track audio URL is loading", async () => {
  const { resolveTrackPlaybackSource } =
    await import("#app/features/offline-storage/resolve-playback-url.client.ts");
  const resolveMock = vi.mocked(resolveTrackPlaybackSource);
  let resolveSecondTrack: ((url: string) => void) | undefined;

  resolveMock.mockImplementation((trackId: string) => {
    if (trackId === "track-2") {
      return new Promise((resolve) => {
        resolveSecondTrack = resolve;
      });
    }
    return Promise.resolve("https://cdn.example/track-1.mp3");
  });

  const { rerender } = await renderPlayer();

  rerender(
    playerUi({
      track: mockTrack2,
      playbackToken: 2,
      wantsAutoPlayRef: { current: true },
    }),
  );

  expect(screen.getByTestId("player-desktop-bar")).toBeTruthy();

  resolveSecondTrack?.("https://cdn.example/track-2.mp3");

  await waitFor(() => {
    expect(screen.getByTestId("player-desktop-bar")).toBeTruthy();
  });
});

test("renders mobile mini bar with play and close controls", async () => {
  await renderPlayer();

  const miniBar = screen.getByTestId("player-mini-bar");
  expect(within(miniBar).getByLabelText("Play")).toBeTruthy();
  expect(within(miniBar).getByLabelText("Close player")).toBeTruthy();
  expect(within(miniBar).getByLabelText("Open queue")).toBeTruthy();
});

test("shows controls in the now playing sheet", async () => {
  const user = userEvent.setup();
  await renderPlayer();

  await user.click(screen.getByLabelText("Open now playing"));

  const sheet = await screen.findByTestId("player-now-playing-sheet");
  expect(within(sheet).getByLabelText("Shuffle: off")).toBeTruthy();
  expect(within(sheet).getByLabelText("Loop: off")).toBeTruthy();
  expect(within(sheet).getByLabelText("Add to playlist")).toBeTruthy();
  expect(within(sheet).getByLabelText("Sleep timer")).toBeTruthy();
  expect(within(sheet).getByLabelText("More actions")).toBeTruthy();
});

test("keeps the now-playing cover warm while the player is mounted", async () => {
  const user = userEvent.setup();
  await renderPlayer();

  const warmCover = screen.getByTestId("player-warm-cover");
  expect(warmCover).toHaveAttribute(
    "src",
    "/resources/images?src=covers%2Ftest.jpg&w=320&h=320&fit=cover&format=webp",
  );
  expect(warmCover).toHaveAttribute("loading", "eager");

  await user.click(screen.getByLabelText("Open now playing"));
  const sheet = await screen.findByTestId("player-now-playing-sheet");
  const sheetCover = within(sheet).getByRole("img", { name: "Test Song" });
  expect(sheetCover).toHaveAttribute("src", warmCover.getAttribute("src"));
  expect(sheetCover).toHaveAttribute("loading", "eager");

  // Closing the sheet unmounts the sheet cover, but the warm preload stays mounted
  // so the browser memory/HTTP cache is still hot on reopen.
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => {
    expect(screen.queryByTestId("player-now-playing-sheet")).toBeNull();
  });
  expect(screen.getByTestId("player-warm-cover")).toBeTruthy();
});

test("now playing add-to-playlist sheet constrains the menu so New playlist stays inside", async () => {
  const user = userEvent.setup();
  await renderPlayer();

  await user.click(screen.getByLabelText("Open now playing"));
  const nowPlaying = await screen.findByTestId("player-now-playing-sheet");
  expect(nowPlaying.className).toContain("max-h-[85vh]");
  expect(nowPlaying.className).not.toContain("overflow-y-auto");

  await user.click(within(nowPlaying).getByLabelText("Add to playlist"));

  const sheet = await screen.findByTestId("player-add-to-playlist-sheet");
  expect(sheet.className).toContain("flex");
  expect(sheet.className).toContain("flex-col");
  expect(sheet.className).toContain("max-h-[60vh]");
  expect(sheet.className).toContain("overflow-y-auto");
  expect(within(sheet).getByTestId("add-to-playlist-menu")).toHaveAttribute(
    "data-constrain-height",
    "true",
  );
  expect(within(sheet).getByRole("button", { name: "New playlist" })).toBeTruthy();
});

test("overflow sheet opens with all action buttons", async () => {
  const user = userEvent.setup();
  await renderPlayer();

  await user.click(screen.getByLabelText("Open now playing"));
  const sheet = await screen.findByTestId("player-now-playing-sheet");

  await user.click(within(sheet).getByLabelText("More actions"));

  // Verify all overflow actions are present
  expect(screen.getByText("Download")).toBeTruthy();
  expect(screen.getByText("Play Next")).toBeTruthy();
  expect(screen.getByText("Add to Up Next")).toBeTruthy();
  expect(screen.getByText("Add to Queue")).toBeTruthy();
  expect(screen.getByText("Track Details")).toBeTruthy();
});

test("overflow sheet Play Next calls playNextTrack with toast", async () => {
  const { playNextTrack } = useAudioPlayer();
  const user = userEvent.setup();
  await renderPlayer();

  await user.click(screen.getByLabelText("Open now playing"));
  const sheet = await screen.findByTestId("player-now-playing-sheet");

  await user.click(within(sheet).getByLabelText("More actions"));
  await user.click(screen.getByText("Play Next"));

  expect(playNextTrack).toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Success",
      description: expect.stringContaining("will play next"),
    }),
  );
});

test("overflow sheet Add to Up Next calls addToUpNext with toast", async () => {
  const { addToUpNext } = useAudioPlayer();
  const user = userEvent.setup();
  await renderPlayer();

  await user.click(screen.getByLabelText("Open now playing"));
  const sheet = await screen.findByTestId("player-now-playing-sheet");

  await user.click(within(sheet).getByLabelText("More actions"));
  await user.click(screen.getByText("Add to Up Next"));

  expect(addToUpNext).toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Success",
      description: expect.stringContaining("added to up next"),
    }),
  );
});

test("overflow sheet Add to Queue calls addToQueue with toast", async () => {
  const { addToQueue } = useAudioPlayer();
  const user = userEvent.setup();
  await renderPlayer();

  await user.click(screen.getByLabelText("Open now playing"));
  const sheet = await screen.findByTestId("player-now-playing-sheet");

  await user.click(within(sheet).getByLabelText("More actions"));
  await user.click(screen.getByText("Add to Queue"));

  expect(addToQueue).toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Success",
      description: expect.stringContaining("added to queue"),
    }),
  );
});

test("renders desktop bar with volume and transport controls", async () => {
  await renderPlayer();

  const desktopBar = screen.getByTestId("player-desktop-bar");
  expect(within(desktopBar).getByLabelText("Volume")).toBeTruthy();
  expect(within(desktopBar).getByLabelText("Next track")).toBeTruthy();
  expect(within(desktopBar).getByLabelText("Shuffle: off")).toBeTruthy();
});

test("links the track title and artist from the desktop player", async () => {
  await renderPlayer();

  const desktopBar = screen.getByTestId("player-desktop-bar");
  expect(within(desktopBar).getByRole("link", { name: "Test Song" })).toHaveAttribute(
    "href",
    "/library/track-1",
  );
  expect(within(desktopBar).getByRole("link", { name: "Test Artist" })).toHaveAttribute(
    "href",
    "/artists/artist-1",
  );
});

test("keeps the mobile mini bar title and artist as plain text", async () => {
  await renderPlayer();

  const miniBar = screen.getByTestId("player-mini-bar");
  expect(within(miniBar).queryByRole("link", { name: "Test Song" })).toBeNull();
  expect(within(miniBar).queryByRole("link", { name: "Test Artist" })).toBeNull();
  expect(within(miniBar).getByText("Test Song")).toBeTruthy();
  expect(within(miniBar).getByText("Test Artist")).toBeTruthy();
});

test("links the track title and artist in the now playing sheet and closes it", async () => {
  const user = userEvent.setup();
  await renderPlayer();

  await user.click(screen.getByLabelText("Open now playing"));
  const sheet = await screen.findByTestId("player-now-playing-sheet");

  expect(within(sheet).getByRole("link", { name: "Test Song" })).toHaveAttribute(
    "href",
    "/library/track-1",
  );
  const artistLink = within(sheet).getByRole("link", { name: "Test Artist" });
  expect(artistLink).toHaveAttribute("href", "/artists/artist-1");

  await user.click(artistLink);
  await waitFor(() => {
    expect(screen.queryByTestId("player-now-playing-sheet")).toBeNull();
  });
});

test("leaves the artist name unlinked when playback has no artist page", async () => {
  await renderPlayer({
    track: { ...mockTrack, artist: { id: "room-artist", name: "Room Artist" } },
  });

  const desktopBar = screen.getByTestId("player-desktop-bar");
  expect(within(desktopBar).getByRole("link", { name: "Test Song" })).toHaveAttribute(
    "href",
    "/library/track-1",
  );
  expect(within(desktopBar).queryByRole("link", { name: "Room Artist" })).toBeNull();
  expect(within(desktopBar).getByText("Room Artist")).toBeTruthy();
});

test("swipe left on mini-bar triggers onNext", async () => {
  const onNext = vi.fn();
  await renderPlayer({ onNext, hasNext: true });

  expect(swipeMocks.onSwipeLeft).not.toBeNull();
  swipeMocks.onSwipeLeft!();

  expect(onNext).toHaveBeenCalledOnce();
});

test("swipe right on mini-bar triggers onPrevious", async () => {
  const onPrevious = vi.fn();
  await renderPlayer({ onPrevious, hasPrevious: true });

  expect(swipeMocks.onSwipeRight).not.toBeNull();
  swipeMocks.onSwipeRight!();

  expect(onPrevious).toHaveBeenCalledOnce();
});

test("swipe callbacks are not wired when hasNext and hasPrevious are both false", async () => {
  await renderPlayer({ hasNext: false, hasPrevious: false });

  expect(swipeMocks.onSwipeLeft).toBeNull();
  expect(swipeMocks.onSwipeRight).toBeNull();
});

function setPaused(audioEl: HTMLAudioElement, paused: boolean) {
  Object.defineProperty(audioEl, "paused", { configurable: true, value: paused });
}

function setProgress(audioEl: HTMLAudioElement, currentTime: number, duration: number) {
  Object.defineProperty(audioEl, "currentTime", { configurable: true, value: currentTime });
  Object.defineProperty(audioEl, "duration", { configurable: true, value: duration });
}

function mockPlay() {
  return vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    setPaused(this, false);
    return Promise.resolve();
  });
}

/**
 * The transport button swaps its label between Play and Pause, but the handler
 * branches on `audio.paused`, which these tests drive directly via setPaused.
 */
function clickTransport(user: ReturnType<typeof userEvent.setup>) {
  const miniBar = screen.getByTestId("player-mini-bar");
  return user.click(within(miniBar).getByRole("button", { name: /^(Play|Pause)$/ }));
}

test("reports play_started once per track, and again once the track changes", async () => {
  const user = userEvent.setup();
  mockPlay();
  vi.mocked(reportPlayEvent).mockClear();

  const { audioEl, rerender } = await renderPlayer();

  await clickTransport(user);
  await waitFor(() => {
    expect(reportPlayEvent).toHaveBeenCalledWith("play_started", "track-1", expect.any(String));
  });
  expect(reportPlayEvent).toHaveBeenCalledTimes(1);

  // Pausing and resuming the same track must not count as a second play.
  setPaused(audioEl, true);
  await clickTransport(user);
  expect(reportPlayEvent).toHaveBeenCalledTimes(1);

  const nextTrack: FullTrack = { ...mockTrack, id: "track-2", title: "Second Song" };
  rerender(playerUi({ track: nextTrack }));
  setPaused(audioEl, true);

  await clickTransport(user);
  await waitFor(() => {
    expect(reportPlayEvent).toHaveBeenCalledWith("play_started", "track-2", expect.any(String));
  });
});

test("reports play_completed once playback passes the halfway mark", async () => {
  vi.mocked(reportPlayEvent).mockClear();
  const { audioEl } = await renderPlayer();

  setProgress(audioEl, 40, 100);
  fireEvent.timeUpdate(audioEl);
  expect(reportPlayEvent).not.toHaveBeenCalledWith("play_completed", "track-1");

  setProgress(audioEl, 50, 100);
  fireEvent.timeUpdate(audioEl);
  expect(reportPlayEvent).toHaveBeenCalledWith("play_completed", "track-1", null);

  // Further progress on the same track must not report again.
  setProgress(audioEl, 90, 100);
  fireEvent.timeUpdate(audioEl);
  expect(
    vi.mocked(reportPlayEvent).mock.calls.filter(([type]) => type === "play_completed"),
  ).toHaveLength(1);
});

test("reports play_completed when a short track ends without passing the halfway check", async () => {
  vi.mocked(reportPlayEvent).mockClear();
  const { audioEl } = await renderPlayer();

  fireEvent.ended(audioEl);

  expect(reportPlayEvent).toHaveBeenCalledWith("play_completed", "track-1", null);
});

test("does not report play_completed twice when a track ends after passing halfway", async () => {
  vi.mocked(reportPlayEvent).mockClear();
  const { audioEl } = await renderPlayer();

  setProgress(audioEl, 60, 100);
  fireEvent.timeUpdate(audioEl);
  fireEvent.ended(audioEl);

  expect(
    vi.mocked(reportPlayEvent).mock.calls.filter(([type]) => type === "play_completed"),
  ).toHaveLength(1);
});

test("correlates a track's play_started and play_completed with the same playId", async () => {
  const user = userEvent.setup();
  mockPlay();
  vi.mocked(reportPlayEvent).mockClear();

  const { audioEl } = await renderPlayer();

  await clickTransport(user);
  await waitFor(() => {
    expect(reportPlayEvent).toHaveBeenCalledWith("play_started", "track-1", expect.any(String));
  });

  const startedPlayId = vi
    .mocked(reportPlayEvent)
    .mock.calls.find(([type]) => type === "play_started")?.[2];
  expect(startedPlayId).toBeTypeOf("string");

  setProgress(audioEl, 60, 100);
  fireEvent.timeUpdate(audioEl);

  await waitFor(() => {
    expect(reportPlayEvent).toHaveBeenCalledWith("play_completed", "track-1", startedPlayId);
  });
});
