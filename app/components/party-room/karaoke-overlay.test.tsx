/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KaraokeOverlay } from "#app/components/party-room/karaoke-overlay.tsx";

const LINES = [
  [
    { word: "Hello", start: 1, end: 2 },
    { word: "world", start: 2, end: 3 },
  ],
  [{ word: "second", start: 4, end: 5 }],
  [{ word: "third", start: 6, end: 7 }],
  [{ word: "fourth", start: 8, end: 9 }],
];

let rafCallbacks: Map<number, FrameRequestCallback>;
let rafId: number;
let audio: { currentTime: number; paused: boolean };
let fetchMock: ReturnType<typeof vi.fn>;

function tick() {
  const pending = [...rafCallbacks.entries()];
  rafCallbacks.clear();
  act(() => {
    for (const [, cb] of pending) cb(performance.now());
  });
}

beforeEach(() => {
  rafCallbacks = new Map();
  rafId = 0;
  audio = { currentTime: 0, paused: false };
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafId += 1;
    rafCallbacks.set(rafId, cb);
    return rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafCallbacks.delete(id);
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  fetchMock = vi.fn(async () => Response.json({ versionId: "v1", lines: LINES }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderOverlay(props: Partial<{ trackId: string; startKey: string; hasReady: boolean }> = {}) {
  return render(
    <KaraokeOverlay
      trackId={props.trackId ?? "t1"}
      startKey={props.startKey ?? "room:t1:0"}
      hasReady={props.hasReady ?? true}
      getAudioElement={() => audio as unknown as HTMLAudioElement}
    />,
  );
}

describe("KaraokeOverlay", () => {
  it("renders nothing and fetches nothing for a track without ready karaoke", () => {
    const { container } = renderOverlay({ hasReady: false });
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders a muted video from the room video route plus lyrics for a ready track", async () => {
    renderOverlay();
    await waitFor(() => expect(screen.getByTestId("karaoke-overlay")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/resources/rooms/karaoke/t1", expect.anything());
    const video = screen.getByTestId("karaoke-video") as HTMLVideoElement;
    expect(video.muted).toBe(true);
    // Pinned to the version the lyrics came from.
    expect(video.getAttribute("src")).toBe("/resources/rooms/video/t1?v=v1");
    expect(video.playsInline).toBe(true);
  });

  it("does not refetch or hide when hasReady toggles mid-song", async () => {
    const getAudio = () => audio as unknown as HTMLAudioElement;
    const { rerender } = render(
      <KaraokeOverlay trackId="t1" startKey="k" hasReady getAudioElement={getAudio} />,
    );
    await waitFor(() => expect(screen.getByTestId("karaoke-overlay")).toBeInTheDocument());
    rerender(
      <KaraokeOverlay trackId="t1" startKey="k" hasReady={false} getAudioElement={getAudio} />,
    );
    expect(screen.getByTestId("karaoke-overlay")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hide-lyrics button dismisses the overlay; a new track start brings it back", async () => {
    const getAudio = () => audio as unknown as HTMLAudioElement;
    const { rerender } = render(
      <KaraokeOverlay trackId="t1" startKey="k1" hasReady getAudioElement={getAudio} />,
    );
    await waitFor(() => expect(screen.getByTestId("karaoke-overlay")).toBeInTheDocument());
    act(() => screen.getByTestId("karaoke-hide").click());
    expect(screen.queryByTestId("karaoke-overlay")).toBeNull();
    rerender(<KaraokeOverlay trackId="t2" startKey="k2" hasReady getAudioElement={getAudio} />);
    await waitFor(() => expect(screen.getByTestId("karaoke-overlay")).toBeInTheDocument());
  });

  it("stops seeking and calling play() once the video has ended", async () => {
    renderOverlay();
    await waitFor(() => expect(screen.getByTestId("karaoke-overlay")).toBeInTheDocument());
    const video = screen.getByTestId("karaoke-video") as HTMLVideoElement;
    Object.defineProperty(video, "ended", { value: true, configurable: true });
    Object.defineProperty(video, "paused", { value: true, configurable: true });
    const playSpy = vi.mocked(HTMLMediaElement.prototype.play);
    playSpy.mockClear();
    audio.currentTime = 30;
    tick();
    expect(playSpy).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(0);
  });

  it("shows current + next two lines and advances the word highlight with the audio clock", async () => {
    renderOverlay();
    await waitFor(() => expect(screen.getByTestId("karaoke-overlay")).toBeInTheDocument());

    audio.currentTime = 1.2;
    tick();
    expect(screen.getAllByTestId("karaoke-line")).toHaveLength(3);
    expect(screen.getByText("Hello")).toHaveAttribute("data-word-state", "active");
    expect(screen.getByText("world")).toHaveAttribute("data-word-state", "upcoming");
    expect(screen.queryByText("fourth")).toBeNull();

    audio.currentTime = 2.4;
    tick();
    expect(screen.getByText("Hello")).toHaveAttribute("data-word-state", "sung");
    expect(screen.getByText("world")).toHaveAttribute("data-word-state", "active");

    // instrumental gap: upcoming lines only, no active word
    audio.currentTime = 3.5;
    tick();
    expect(screen.queryByText("Hello")).toBeNull();
    expect(screen.getByText("second")).toHaveAttribute("data-word-state", "upcoming");
    expect(screen.getByTestId("karaoke-overlay").querySelector('[data-word-state="active"]')).toBeNull();
  });

  it("fetches lyrics once per track start, not on every frame", async () => {
    renderOverlay();
    await waitFor(() => expect(screen.getByTestId("karaoke-overlay")).toBeInTheDocument());
    for (let i = 0; i < 5; i++) tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when the lyrics fetch fails (audio-only fallback)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    const { container } = renderOverlay();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });
});
