/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { type FullTrack } from "#app/types/frontend/shared.ts";
import { HomeRecentTrackCard } from "./home-recent-track-card.tsx";

const mockPauseTrack = vi.fn();
const mockResumeTrack = vi.fn();
const mockPlayPlaylist = vi.fn();

const mockPlayerState: {
  currentTrack: FullTrack | null;
  isPlaying: boolean;
} = {
  currentTrack: null,
  isPlaying: false,
};

vi.mock("#app/components/audio-player-provider.tsx", () => ({
  useAudioPlayer: () => ({
    currentTrack: mockPlayerState.currentTrack,
    isPlaying: mockPlayerState.isPlaying,
    pauseTrack: mockPauseTrack,
    resumeTrack: mockResumeTrack,
    playPlaylist: mockPlayPlaylist,
  }),
}));

const track: FullTrack = {
  id: "track-1",
  title: "Midnight City",
  duration: 245,
  artist: { id: "artist-1", name: "M83" },
  coverImage: { objectKey: "covers/midnight-city.jpg" },
  audioFiles: [{ id: "af-1", format: "mp3", objectKey: "audio/midnight.mp3" }],
};

beforeEach(() => {
  mockPauseTrack.mockClear();
  mockResumeTrack.mockClear();
  mockPlayPlaylist.mockClear();
  mockPlayerState.currentTrack = null;
  mockPlayerState.isPlaying = false;
});

test("pauses when the card is the playing track", async () => {
  const user = userEvent.setup();
  mockPlayerState.currentTrack = track;
  mockPlayerState.isPlaying = true;

  render(<HomeRecentTrackCard track={track} index={0} playableTracks={[track]} />);

  await user.click(screen.getByRole("button", { name: /midnight city/i }));

  expect(mockPauseTrack).toHaveBeenCalledTimes(1);
  expect(mockPlayPlaylist).not.toHaveBeenCalled();
});

test("resumes when the card is the paused current track", async () => {
  const user = userEvent.setup();
  mockPlayerState.currentTrack = track;
  mockPlayerState.isPlaying = false;

  render(<HomeRecentTrackCard track={track} index={0} playableTracks={[track]} />);

  await user.click(screen.getByRole("button", { name: /midnight city/i }));

  expect(mockResumeTrack).toHaveBeenCalledTimes(1);
  expect(mockPlayPlaylist).not.toHaveBeenCalled();
});
